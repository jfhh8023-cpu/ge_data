/**
 * Quotes routes — 名句库管理 + 配置（v3.3.0）
 *
 * GET    /api/quotes                          列表（分页可选）
 * POST   /api/quotes                          新增单条或批量（body: { content } 或 { contents: [] }）
 * PUT    /api/quotes/:id                      编辑
 * DELETE /api/quotes                          批量删除（body: { ids: [] }）
 *
 * GET    /api/quotes/config/:ruleId           获取规则的名句配置 + 候选队列
 * PUT    /api/quotes/config/:ruleId           更新基本配置（enabled / no_repeat_count）
 * POST   /api/quotes/config/:ruleId/refresh   重新生成候选队列
 * POST   /api/quotes/config/:ruleId/skip      跳过当前句（使用下一句）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Quote } = require('../models');
const {
  getConfigWithDetails,
  updateConfig,
  changeCandidateBatch,
  skipCurrent
} = require('../services/QuoteService');

function sanitizeContent(value) {
  return String(value || '').trim();
}

/* ========== 句子 CRUD ========== */

router.get('/', async (req, res, next) => {
  try {
    const includeUsage = String(req.query.with_usage || '').toLowerCase() === 'true';
    const ruleId = req.query.rule_id ? String(req.query.rule_id) : null;
    const quotes = await Quote.findAll({
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    let nextUsedId = null;
    if (includeUsage && ruleId) {
      const config = await getConfigWithDetails(ruleId);
      nextUsedId = config.candidate_queue?.[0]?.id || null;
    }
    res.json({
      code: 0,
      data: quotes.map((q, idx) => ({
        id: q.id,
        content: q.content,
        sort_order: q.sort_order,
        order_no: idx + 1,
        is_next: nextUsedId === q.id
      })),
      total: quotes.length
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    let contents = [];
    if (Array.isArray(body.contents)) {
      contents = body.contents.map(sanitizeContent).filter(Boolean);
    } else if (body.content) {
      const single = sanitizeContent(body.content);
      if (single) contents = [single];
    }
    if (contents.length === 0) {
      return res.status(400).json({ code: 400, message: '请输入句子内容' });
    }

    // 查询当前最大 sort_order
    const maxRecord = await Quote.findOne({ order: [['sort_order', 'DESC']] });
    let nextOrder = (maxRecord?.sort_order || 0) + 1;
    const rows = contents.map(content => ({
      id: uuidv4(),
      content,
      sort_order: nextOrder++,
      created_at: new Date(),
      updated_at: new Date()
    }));
    await Quote.bulkCreate(rows);
    res.json({ code: 0, data: rows, message: `已添加 ${rows.length} 条` });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const content = sanitizeContent(req.body?.content);
    if (!content) {
      return res.status(400).json({ code: 400, message: '请输入句子内容' });
    }
    const quote = await Quote.findByPk(id);
    if (!quote) {
      return res.status(404).json({ code: 404, message: '句子不存在' });
    }
    quote.content = content;
    quote.updated_at = new Date();
    await quote.save();
    res.json({ code: 0, data: { id: quote.id, content: quote.content } });
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要删除的句子' });
    }
    const deleted = await Quote.destroy({ where: { id: { [Op.in]: ids } } });
    res.json({ code: 0, data: { deleted }, message: `已删除 ${deleted} 条` });
  } catch (err) {
    next(err);
  }
});

/* ========== 规则的名句配置 ========== */

router.get('/config/:ruleId', async (req, res, next) => {
  try {
    const data = await getConfigWithDetails(String(req.params.ruleId));
    res.json({ code: 0, data });
  } catch (err) {
    next(err);
  }
});

router.put('/config/:ruleId', async (req, res, next) => {
  try {
    const data = await updateConfig(String(req.params.ruleId), req.body || {});
    res.json({ code: 0, data });
  } catch (err) {
    next(err);
  }
});

router.post('/config/:ruleId/refresh', async (req, res, next) => {
  try {
    const data = await changeCandidateBatch(String(req.params.ruleId));
    res.json({ code: 0, data });
  } catch (err) {
    next(err);
  }
});

router.post('/config/:ruleId/skip', async (req, res, next) => {
  try {
    const data = await skipCurrent(String(req.params.ruleId));
    res.json({ code: 0, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
