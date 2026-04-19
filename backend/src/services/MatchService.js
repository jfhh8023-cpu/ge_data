/**
 * MatchService — 智能匹配引擎
 * 将各角色提交的原始工时记录，按需求维度归并为 MatchGroup
 *
 * v3.0.1 匹配规则：
 *   1. 版本号优先：双方都有版本号时，版本号不同则直接不合并
 *   2. 版本号相同 → 再看标题相似度(0.6) + 产品经理(0.4)
 *   3. 一方无版本号 → 纯标题相似度(0.7) + 产品经理(0.3)
 *   4. 同一员工的不同记录不合并
 */
const { v4: uuidv4 } = require('uuid');
const { safeParseJsonArray } = require('../utils/parseJson');

/* ========== 常量 ========== */
const THRESHOLD_AUTO = 0.7;
const THRESHOLD_PENDING = 0.5;

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

/** 版本号匹配 */
function versionMatch(a, b) {
  if (!a || !b) return 0;
  return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
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

/** 计算两条记录的综合置信度（版本号优先） */
function computeConfidence(recA, recB) {
  const verA = (recA.version || '').trim().toLowerCase();
  const verB = (recB.version || '').trim().toLowerCase();
  const bothHaveVersion = verA.length > 0 && verB.length > 0;

  // 规则 1: 双方都有版本号且不同 → 直接判定不匹配
  if (bothHaveVersion && verA !== verB) return 0;

  const tScore = titleSimilarity(recA.requirement_title, recB.requirement_title);
  const pScore = pmMatch(recA.product_managers, recB.product_managers);

  if (bothHaveVersion) {
    // 规则 2: 版本号相同 → 基础分 0.3 + 标题(0.4) + PM(0.3)
    return 0.3 + tScore * 0.4 + pScore * 0.3;
  }

  // 规则 3: 一方无版本号 → 纯标题(0.7) + PM(0.3)
  return tScore * 0.7 + pScore * 0.3;
}

/**
 * 执行智能匹配
 * @param {Array} records - 原始工时记录列表（含 staff 关联数据）
 * @returns {Array} matchGroups - 匹配组列表
 */
function matchRecords(records) {
  if (!records || records.length === 0) return [];

  const groups = [];
  const used = new Set();

  // 按版本号+标题初步聚类
  for (let i = 0; i < records.length; i++) {
    if (used.has(i)) continue;

    const anchor = records[i];
    const cluster = [i];
    let bestConfidence = 1;

    for (let j = i + 1; j < records.length; j++) {
      if (used.has(j)) continue;
      // 同一员工提交的不同需求不应合并（即使标题相似）
      const anchorStaff = anchor.staff_id || anchor.staff?.id;
      const candidateStaff = records[j].staff_id || records[j].staff?.id;
      if (anchorStaff && candidateStaff && anchorStaff === candidateStaff) continue;

      const conf = computeConfidence(anchor, records[j]);
      if (conf >= THRESHOLD_PENDING) {
        cluster.push(j);
        bestConfidence = Math.min(bestConfidence, conf);
      }
    }

    cluster.forEach(idx => used.add(idx));

    // 构建 MatchGroup
    const clusterRecords = cluster.map(idx => records[idx]);

    const frontend = [];
    const backend = [];
    const testRole = [];

    for (const r of clusterRecords) {
      const staffName = r.staff?.name || r.staffName || '未知';
      const role = r.staff?.role || r.role || 'frontend';
      const hours = parseFloat(r.hours);
      const entry = { staffName, hours };

      if (role === 'frontend') frontend.push(entry);
      else if (role === 'backend') backend.push(entry);
      else testRole.push(entry);
    }

    // 合并 PM 列表
    const allPMs = new Set();
    for (const r of clusterRecords) {
      const pms = safeParseJsonArray(r.product_managers);
      pms.forEach(pm => allPMs.add(pm));
    }

    const status = bestConfidence >= THRESHOLD_AUTO ? 'auto_merged'
      : bestConfidence >= THRESHOLD_PENDING ? 'pending_review'
      : 'auto_merged';

    groups.push({
      id: uuidv4(),
      merged_title: anchor.requirement_title,
      version: anchor.version,
      product_managers: [...allPMs],
      frontend: JSON.stringify(frontend),
      backend: JSON.stringify(backend),
      test_role: JSON.stringify(testRole),
      confidence: Math.round(bestConfidence * 100) / 100,
      status,
      remark: ''
    });
  }

  return groups;
}

module.exports = { matchRecords, titleSimilarity, computeConfidence };
