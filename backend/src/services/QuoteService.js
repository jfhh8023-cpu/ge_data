/**
 * QuoteService — 名句搭配业务逻辑（v3.3.0）
 *
 * 关键概念：
 *  - candidate_queue: 接下来即将被使用的句子 id 队列（默认长度 10）
 *  - used_history:    已使用的句子 id（按时间倒序，[最近, 次近, ...]）
 *  - no_repeat_count: 近 N 次内不重复，默认 20
 *
 * 选取算法：
 *  1. 从全部 quotes 中排除 used_history 最近 N 条
 *  2. 在剩余池中随机抽样组成候选队列
 *  3. 消费一条 = candidate_queue.shift()；同时 used_history.unshift(used)
 *  4. 候选队列空缺时从池中再补一条
 */
const { v4: uuidv4 } = require('uuid');
const { Quote, QuoteConfig } = require('../models');

const CANDIDATE_QUEUE_SIZE = 10;
const DEFAULT_NO_REPEAT = 20;

/** 通用 Fisher-Yates 打乱 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 从 JSON 字段安全解析数组。
 * 必须返回全新的数组（拷贝），以避免调用方 in-place mutate 后
 * Sequelize 检测不到 JSON 列变更而跳过 save。
 */
function parseArray(value) {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.slice() : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 获取或创建某规则的配置 */
async function ensureConfig(ruleId) {
  if (!ruleId) throw new Error('ruleId 不能为空');
  let config = await QuoteConfig.findOne({ where: { rule_id: ruleId } });
  if (!config) {
    config = await QuoteConfig.create({
      id: uuidv4(),
      rule_id: ruleId,
      enabled: false,
      no_repeat_count: DEFAULT_NO_REPEAT,
      candidate_queue: [],
      used_history: []
    });
  }
  return config;
}

/** 仅查询配置（不创建），用于只读接口；不存在返回 null */
async function findConfig(ruleId) {
  if (!ruleId) return null;
  return QuoteConfig.findOne({ where: { rule_id: ruleId } });
}

/** 合成默认配置对象（不写库） */
function buildDefaultConfigPayload(ruleId) {
  return {
    id: null,
    rule_id: ruleId,
    enabled: false,
    no_repeat_count: DEFAULT_NO_REPEAT,
    candidate_queue: [],
    used_history: []
  };
}

/**
 * 重新生成候选队列
 * @param {object} config QuoteConfig 实例
 * @returns {Promise<string[]>} 新的候选 id 队列
 */
async function refreshCandidateQueue(config) {
  const allQuotes = await Quote.findAll({ attributes: ['id'], order: [['sort_order', 'ASC'], ['created_at', 'ASC']] });
  const allIds = allQuotes.map(q => q.id);
  if (allIds.length === 0) return [];

  const noRepeat = Math.max(0, Number(config.no_repeat_count) || DEFAULT_NO_REPEAT);
  const usedHistory = parseArray(config.used_history);
  const recentUsed = new Set(usedHistory.slice(0, noRepeat));

  let pool = allIds.filter(id => !recentUsed.has(id));
  // 若可用池小于队列长度，放宽限制：先用未在最近 N 中的，再补未在更小范围中的
  if (pool.length < CANDIDATE_QUEUE_SIZE) {
    const fallback = allIds.filter(id => !pool.includes(id));
    pool = pool.concat(shuffle(fallback));
  }
  const shuffled = shuffle(pool);
  return shuffled.slice(0, Math.min(CANDIDATE_QUEUE_SIZE, allIds.length));
}

/**
 * 确保候选队列长度足够；不足则补充新句子
 */
async function ensureQueueFilled(config) {
  const queue = parseArray(config.candidate_queue);
  if (queue.length >= CANDIDATE_QUEUE_SIZE) return queue;

  const allQuotes = await Quote.findAll({ attributes: ['id'], order: [['sort_order', 'ASC'], ['created_at', 'ASC']] });
  if (allQuotes.length === 0) return queue;
  const allIds = allQuotes.map(q => q.id);

  const noRepeat = Math.max(0, Number(config.no_repeat_count) || DEFAULT_NO_REPEAT);
  const usedHistory = parseArray(config.used_history);
  const recentUsed = new Set(usedHistory.slice(0, noRepeat));
  const queueSet = new Set(queue);

  let pool = allIds.filter(id => !recentUsed.has(id) && !queueSet.has(id));
  if (pool.length === 0) {
    pool = allIds.filter(id => !queueSet.has(id));
  }
  const needed = CANDIDATE_QUEUE_SIZE - queue.length;
  const supplement = shuffle(pool).slice(0, needed);
  return queue.concat(supplement);
}

/** 获取配置 + 详细（含 content）的候选队列；只读，不存在则返回默认值不写库 */
async function getConfigWithDetails(ruleId) {
  const config = await findConfig(ruleId);
  if (!config) {
    // 规则尚未配置过名句：返回默认值（不写库，避免 FK 风险）
    return buildDefaultConfigPayload(ruleId);
  }

  // 自动补齐队列（仅在已有配置时）
  const filledQueue = await ensureQueueFilled(config);
  if (filledQueue.length !== parseArray(config.candidate_queue).length) {
    config.candidate_queue = filledQueue;
    config.changed('candidate_queue', true);
    config.updated_at = new Date();
    await config.save();
  }

  const usedHistory = parseArray(config.used_history);
  const allIds = [...new Set([...filledQueue, ...usedHistory])];
  const quotes = allIds.length
    ? await Quote.findAll({ where: { id: allIds } })
    : [];
  const quoteMap = new Map(quotes.map(q => [q.id, q.content]));

  return {
    id: config.id,
    rule_id: config.rule_id,
    enabled: !!config.enabled,
    no_repeat_count: config.no_repeat_count,
    candidate_queue: filledQueue.map(id => ({ id, content: quoteMap.get(id) || '' })),
    used_history: usedHistory.slice(0, 50).map(id => ({ id, content: quoteMap.get(id) || '' }))
  };
}

/** 手动更换一批候选队列 */
async function changeCandidateBatch(ruleId) {
  const config = await ensureConfig(ruleId);
  const newQueue = await refreshCandidateQueue(config);
  config.candidate_queue = newQueue;
  config.changed('candidate_queue', true);
  config.updated_at = new Date();
  await config.save();
  return getConfigWithDetails(ruleId);
}

/** 跳过当前句（弹出第 1 条，写入 history 但不发送） */
async function skipCurrent(ruleId) {
  const config = await ensureConfig(ruleId);
  const queue = parseArray(config.candidate_queue);
  if (queue.length === 0) {
    const newQueue = await refreshCandidateQueue(config);
    config.candidate_queue = newQueue;
    config.updated_at = new Date();
    await config.save();
    return getConfigWithDetails(ruleId);
  }
  const skipped = queue.shift();
  const usedHistory = parseArray(config.used_history);
  usedHistory.unshift(skipped);
  config.candidate_queue = queue;
  config.used_history = usedHistory.slice(0, 200);
  config.changed('candidate_queue', true);
  config.changed('used_history', true);
  config.updated_at = new Date();
  await config.save();
  return getConfigWithDetails(ruleId);
}

/**
 * 消费 N 条句子（用于发送值班通知时调用）
 * @param {string} ruleId 规则 id
 * @param {number} count  需要消费的数量（开始/结束模式 = 2，只开始 = 1）
 * @returns {Promise<string[]>} 取出的句子内容数组（顺序与消费顺序一致）
 */
async function consumeQuotes(ruleId, count = 1) {
  const config = await ensureConfig(ruleId);
  if (!config.enabled) return [];

  let queue = parseArray(config.candidate_queue);
  let usedHistory = parseArray(config.used_history);
  const consumedIds = [];

  for (let i = 0; i < count; i++) {
    if (queue.length === 0) {
      queue = await refreshCandidateQueue({
        ...config.toJSON(),
        candidate_queue: queue,
        used_history: usedHistory
      });
    }
    if (queue.length === 0) break;
    const used = queue.shift();
    if (used) {
      consumedIds.push(used);
      usedHistory.unshift(used);
    }
  }

  // 补齐队列
  const filled = await ensureQueueFilled({
    ...config.toJSON(),
    candidate_queue: queue,
    used_history: usedHistory
  });

  config.candidate_queue = filled;
  config.used_history = usedHistory.slice(0, 200);
  config.changed('candidate_queue', true);
  config.changed('used_history', true);
  config.updated_at = new Date();
  await config.save();

  if (consumedIds.length === 0) return [];
  const quotes = await Quote.findAll({ where: { id: consumedIds } });
  const map = new Map(quotes.map(q => [q.id, q.content]));
  return consumedIds.map(id => map.get(id) || '');
}

/** 更新基本配置（enabled / no_repeat_count） */
async function updateConfig(ruleId, patch) {
  const config = await ensureConfig(ruleId);
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (patch.no_repeat_count !== undefined) {
    const n = parseInt(patch.no_repeat_count, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 1000) config.no_repeat_count = n;
  }
  config.updated_at = new Date();
  await config.save();
  return getConfigWithDetails(ruleId);
}

module.exports = {
  CANDIDATE_QUEUE_SIZE,
  DEFAULT_NO_REPEAT,
  ensureConfig,
  findConfig,
  buildDefaultConfigPayload,
  getConfigWithDetails,
  changeCandidateBatch,
  skipCurrent,
  consumeQuotes,
  updateConfig,
  refreshCandidateQueue,
  ensureQueueFilled
};
