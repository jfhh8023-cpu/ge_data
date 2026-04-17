/**
 * DevTracker v1.0.0 — Express 入口
 * 端口: 3001 | 路由前缀: /api
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

/* ========== 中间件 ========== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== 路由注册 ========== */
app.use('/api/staff',       require('./routes/staff'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/records',     require('./routes/records'));
app.use('/api/report',      require('./routes/report'));
app.use('/api/fill',        require('./routes/fill'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/permissions', require('./routes/permissions'));

/* 健康检查 */
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'DevTracker API is running', version: '1.0.0' });
});

/* ========== 错误处理 ========== */
app.use(errorHandler);

/* ========== 启动 ========== */
async function start() {
  try {
    await sequelize.authenticate();
    console.log('[DB] MySQL 连接成功');
    app.listen(PORT, () => {
      console.log(`[API] DevTracker v1.1.0 运行在 http://localhost:${PORT}`);
      console.log('[API] 路由: /api/staff | /api/tasks | /api/records | /api/report | /api/fill | /api/stats | /api/permissions');
    });
  } catch (err) {
    console.error('[DB] 连接失败:', err.message);
    process.exit(1);
  }
}

start();
