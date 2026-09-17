/**
 * MatchService — 智能匹配引擎
 * 将各角色提交的原始工时记录，按需求维度归并为 MatchGroup
 *
 * v3.0.2 匹配规则：
 *   1. 有版本号 → 版本号相同即为同一需求，直接合并，不看标题
 *      需求名称取最早提交的那条记录的标题
 *   2. 无版本号 → 用标题相似度 + 产品经理 模糊匹配
 *      同一员工的不同无版本号记录不合并
 */
const { v4: uuidv4 } = require('uuid');
const { safeParseJsonArray } = require('../utils/parseJson');
const { isFullCreditRecord } = require('./EffectiveHoursService');
const {
  ROLE_AI_DEV,
  ROLE_AI_QUALITY,
  ROLE_VOIP,
  normalizeStaffRole
} = require('./RoleService');

/* ========== 常量 ========== */
const THRESHOLD_NO_VER = 0.5;

/* ========== 工具函数 ========== */

/** Jaccard 相似度（字符级） */
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/** 编辑距离相似度 */
function editDistanceSimilarity(a, b) {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

/** 标题相似度 = max(Jaccard, EditDistance) */
function titleSimilarity(a, b) {
  return Math.max(jaccardSimilarity(a, b), editDistanceSimilarity(a, b));
}

/** 产品经理匹配 */
function pmMatch(pmA, pmB) {
  if (!pmA || !pmB) return 0;
  const arrA = safeParseJsonArray(pmA);
  const arrB = safeParseJsonArray(pmB);
  if (arrA.length === 0 || arrB.length === 0) return 0;
  const setA = new Set(arrA);
  const intersection = arrB.filter(x => setA.has(x));
  return intersection.length > 0 ? 1 : 0;
}

/** 无版本号时的模糊置信度 */
function computeNoVersionConfidence(recA, recB) {
  const tScore = titleSimilarity(recA.requirement_title, recB.requirement_title);
  const pScore = pmMatch(recA.product_managers, recB.product_managers);
  return tScore * 0.7 + pScore * 0.3;
}

/** 标准化版本号（trim + lowercase） */
function normalizeVersion(v) {
  return (v || '').trim().toLowerCase();
}

/**
 * 将记录列表构建为一个 MatchGroup
 * @param {Array} clusterRecords - 属于同一组的原始记录
 * @param {number} confidence - 置信度
 * @param {string} status - auto_merged / pending_review
 */
function buildGroup(clusterRecords, confidence, status) {
  // 按 created_at 升序排序，取最早一条的标题和版本号
  const sorted = [...clusterRecords].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return ta - tb;
  });
  const earliest = sorted[0];

  const frontend = [];
  const backend = [];
  const voip = [];
  const testRole = [];
  const roleBuckets = {};

  for (const r of clusterRecords) {
    const staffName = r.staff?.name || r.staffName || '未知';
    const role = normalizeStaffRole(r.staff?.role || r.role);
    const hours = parseFloat(r.hours);
    const entry = { staffName, hours };

    if (!roleBuckets[role]) roleBuckets[role] = [];
    roleBuckets[role].push(entry);
    if (role === ROLE_AI_DEV) frontend.push(entry);
    else if (role === ROLE_VOIP) voip.push(entry);
    else if (role === ROLE_AI_QUALITY) testRole.push(entry);
  }

  const allPMs = new Set();
  for (const r of clusterRecords) {
    const pms = safeParseJsonArray(r.product_managers);
    pms.forEach(pm => allPMs.add(pm));
  }

  return {
    id: uuidv4(),
    merged_title: earliest.requirement_title,
    version: earliest.version,
    product_managers: [...allPMs],
    frontend: JSON.stringify(frontend),
    backend: JSON.stringify(backend),
    voip: JSON.stringify(voip),
    test_role: JSON.stringify(testRole),
    role_buckets: roleBuckets,
    confidence: Math.round(confidence * 100) / 100,
    status,
    remark: ''
  };
}

/**
 * 执行智能匹配
 * @param {Array} records - 原始工时记录列表（含 staff 关联数据）
 * @returns {Array} matchGroups - 匹配组列表
 */
function matchRecords(records) {
  if (!records || records.length === 0) return [];

  const groups = [];

  // ========== Phase 1: 有版本号的记录，按版本号精确分组 ==========
  const versionMap = new Map();   // normalizedVersion → [record, ...]
  const noVersionRecords = [];

  for (const r of records) {
    const ver = normalizeVersion(r.version);
    if (ver || isFullCreditRecord(r)) {
      // A date version identifies a fill day, not a shared requirement.
      const key = isFullCreditRecord(r)
        ? JSON.stringify(['full_credit', r.staff_id || r.staff?.id || r.staff?.name || r.id, String(r.requirement_title).trim(), ver]) : ver;
      if (!versionMap.has(key)) versionMap.set(key, []);
      versionMap.get(key).push(r);
    } else {
      noVersionRecords.push(r);
    }
  }

  for (const [, cluster] of versionMap) {
    groups.push(buildGroup(cluster, 1, 'auto_merged'));
  }

  // ========== Phase 2: 无版本号的记录，用标题相似度模糊匹配 ==========
  const used = new Set();

  for (let i = 0; i < noVersionRecords.length; i++) {
    if (used.has(i)) continue;

    const anchor = noVersionRecords[i];
    const cluster = [i];
    let bestConfidence = 1;

    for (let j = i + 1; j < noVersionRecords.length; j++) {
      if (used.has(j)) continue;

      // 同一员工的不同无版本号记录不合并
      const anchorStaff = anchor.staff_id || anchor.staff?.id;
      const candidateStaff = noVersionRecords[j].staff_id || noVersionRecords[j].staff?.id;
      if (anchorStaff && candidateStaff && anchorStaff === candidateStaff) continue;

      const conf = computeNoVersionConfidence(anchor, noVersionRecords[j]);
      if (conf >= THRESHOLD_NO_VER) {
        cluster.push(j);
        bestConfidence = Math.min(bestConfidence, conf);
      }
    }

    cluster.forEach(idx => used.add(idx));
    const clusterRecords = cluster.map(idx => noVersionRecords[idx]);
    const status = bestConfidence >= 0.7 ? 'auto_merged' : 'pending_review';
    groups.push(buildGroup(clusterRecords, bestConfidence, status));
  }

  return groups;
}

module.exports = { matchRecords, titleSimilarity, computeNoVersionConfidence };
