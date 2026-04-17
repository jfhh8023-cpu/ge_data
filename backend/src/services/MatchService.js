/**
 * MatchService — 智能匹配引擎
 * 将各角色提交的原始工时记录，按需求维度归并为 MatchGroup
 * 匹配规则：版本号(0.3) + 标题相似度(0.5) + 产品经理(0.2)
 */
const { v4: uuidv4 } = require('uuid');
const { safeParseJsonArray } = require('../utils/parseJson');

/* ========== 常量 ========== */
const WEIGHT_VERSION = 0.3;
const WEIGHT_TITLE = 0.5;
const WEIGHT_PM = 0.2;

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

/** 计算两条记录的综合置信度 */
function computeConfidence(recA, recB) {
  const vScore = versionMatch(recA.version, recB.version) * WEIGHT_VERSION;
  const tScore = titleSimilarity(recA.requirement_title, recB.requirement_title) * WEIGHT_TITLE;
  const pScore = pmMatch(recA.product_managers, recB.product_managers) * WEIGHT_PM;
  return vScore + tScore + pScore;
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
