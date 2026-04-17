/**
 * routes/dingtalk.js — 钉钉消息发送 API
 *
 * GET  /api/dingtalk/status        查询登录状态
 * POST /api/dingtalk/login/qrcode  获取二维码截图（headless，base64）
 * GET  /api/dingtalk/login/poll    轮询扫码是否完成
 * POST /api/dingtalk/send          发送私聊消息
 */

const express = require('express');
const router = express.Router();
const dingtalkService = require('../services/DingtalkService');

/* ===== GET /status ===== */
router.get('/status', (req, res) => {
  res.json({
    code: 0,
    data: {
      loggedIn: dingtalkService.isLoggedIn(),
      sessionAge: dingtalkService.getSessionAge(),
    },
  });
});

/* ===== POST /login/qrcode ===== */
router.post('/login/qrcode', async (req, res) => {
  if (dingtalkService.isLoggedIn()) {
    return res.json({ code: 4, message: '已登录，无需扫码' });
  }
  try {
    const qrcode = await dingtalkService.getQrcode();
    res.json({ code: 0, data: { qrcode } });
  } catch (err) {
    console.error('[dingtalk/qrcode]', err.message);
    res.status(500).json({ code: 1, message: err.message });
  }
});

/* ===== GET /login/poll ===== */
router.get('/login/poll', (req, res) => {
  const result = dingtalkService.pollLogin();
  if (result.error) {
    return res.json({ code: 1, message: result.error, data: { done: false } });
  }
  res.json({ code: 0, data: { done: result.done } });
});

/* ===== POST /send ===== */
router.post('/send', async (req, res) => {
  const { staffName, message } = req.body;
  if (!staffName) return res.status(400).json({ code: 1, message: '缺少 staffName' });
  if (!message) return res.status(400).json({ code: 1, message: '缺少 message' });

  try {
    const result = await dingtalkService.sendMessage(staffName, message);
    res.json({ code: 0, data: result });
  } catch (err) {
    const code = err.code || 1;
    const status = code === 2 ? 401 : code === 3 ? 404 : 500;
    res.status(status).json({ code, message: err.message });
  }
});

module.exports = router;
