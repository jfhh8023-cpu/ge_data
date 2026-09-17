/**
 * DevTracker v3.4.0 — Express 入口
 * 端口: 3001 | 路由前缀: /api
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');
const errorHandler = require('./middleware/errorHandler');
const { ensureAutoTaskTables, startAutoTaskScheduler } = require('./services/AutoTaskService');
const { ensurePersonStatusTables } = require('./services/PersonStatusService');
const { ensureStaffRoleSchema, ensureMatchGroupRoleSchema } = require('./services/RoleService');
const { ensureDemandSourceSchema } = require('./services/DemandSourceService');
const ProductManagerWorkRecord = require('./models/ProductManagerWorkRecord');
const { ensureDutyCalendarTables } = require('./services/DutyCalendarService');
const { startOfficialHolidaySyncScheduler } = require('./services/OfficialHolidaySyncService');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

/* ========== 中间件 ========== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== 路由注册 ========== */
app.use('/api/staff',       require('./routes/staff'));
app.use('/api/roles',       require('./routes/roles'));
app.use('/api/demand-sources', require('./routes/demandSources'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/records',     require('./routes/records'));
app.use('/api/report',      require('./routes/report'));
app.use('/api/fill',        require('./routes/fill'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/excel',       require('./routes/excel'));
app.use('/api/settings/duty-calendar', require('./routes/dutyCalendar'));
app.use('/api/settings',    require('./routes/settings'));
app.use('/api/pm',          require('./routes/pm'));
app.use('/api/quotes',      require('./routes/quotes'));
const workloadReportsRouter = require('./routes/workloadReports');
app.use('/local-reports/workload-analysis', workloadReportsRouter);
app.use('/api/local-reports/workload-analysis', workloadReportsRouter);
const localReportsStatic = express.static(path.join(__dirname, '..', '..', '.codex-local', 'reports'), {
  index: false,
  extensions: ['html']
});
app.use('/local-reports', localReportsStatic);
app.use('/api/local-reports', localReportsStatic);

/* 健康检查 */
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'DevTracker API is running', version: require('../package.json').version });
});

/* ========== 错误处理 ========== */
app.use(errorHandler);

/* ========== 启动 ========== */
async function start() {
  try {
    await sequelize.authenticate();
    console.log('[DB] MySQL 连接成功');
    await ensureStaffRoleSchema();
    await ensureDemandSourceSchema();
    await ProductManagerWorkRecord.sync();
    const productRecordColumns = await sequelize.getQueryInterface().describeTable('product_manager_work_records');
    if (!productRecordColumns.demand_source_weights) {
      await sequelize.getQueryInterface().addColumn('product_manager_work_records', 'demand_source_weights', {
        type: require('sequelize').DataTypes.JSON,
        allowNull: true
      });
    }
    if (!productRecordColumns.demand_source_ids) {
      await sequelize.getQueryInterface().addColumn('product_manager_work_records', 'demand_source_ids', {
        type: require('sequelize').DataTypes.JSON,
        allowNull: true
      });
    }
    const workRecordColumns = await sequelize.getQueryInterface().describeTable('work_records');
    if (!workRecordColumns.delivery_progress) {
      await sequelize.getQueryInterface().addColumn('work_records', 'delivery_progress', { type: require('sequelize').DataTypes.INTEGER, allowNull: true });
    }
    await ensureMatchGroupRoleSchema();
    await ensurePersonStatusTables();
    await ensureAutoTaskTables();
    await ensureDutyCalendarTables();
    app.listen(PORT, () => {
      console.log(`[API] DevTracker v${require('../package.json').version} 运行在 http://localhost:${PORT}`);
      console.log('[API] 路由: /api/staff | /api/roles | /api/tasks | /api/records | /api/report | /api/fill | /api/stats | /api/permissions | /api/excel | /api/settings');
      startAutoTaskScheduler();
      startOfficialHolidaySyncScheduler();
    });
  } catch (err) {
    console.error('[DB] 连接失败:', err.message);
    process.exit(1);
  }
}

start();
