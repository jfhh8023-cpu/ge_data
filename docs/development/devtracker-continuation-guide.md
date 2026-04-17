# DevTracker 接续开发指南

> 用于换账号后快速恢复开发上下文

## 一、快速上手

### 本地开发
```bash
# 前端
cd frontend
npm install
npm run dev    # http://localhost:5173/devtracker/

# 后端（生产环境，无需本地运行）
# 后端部署在 jfzhu8023.cloud:3001
```

### 部署
```bash
cd deploy
python deploy.py              # 完整部署（含构建+DB）
python deploy.py --skip-db    # 跳过数据库
python deploy.py --skip-db --skip-build  # 仅上传已构建的文件
```

## 二、关键文件速查

| 功能 | 文件路径 |
|------|---------|
| 任务标题生成 | `frontend/src/components/CreateTaskModal.vue` L128-140 |
| 季度归属判定 | `frontend/src/views/TaskList.vue` getTaskQuarter() |
| 权限初始化 | `frontend/src/stores/auth.js` init() |
| 路由守卫 | `frontend/src/router/index.js` beforeEach |
| 周期统计合并 | `frontend/src/views/StatsPage.vue` flatTableData + pmSpanMethod |
| 填写页双栏 | `frontend/src/views/FillPage.vue` |
| 历史API | `backend/src/routes/fill.js` GET /:token/history |
| 全局样式 | `frontend/src/styles/main.css` |
| 部署脚本 | `deploy/deploy.py` |

## 三、常用命令

```bash
# 构建前端
cd frontend && npx vite build

# 部署（跳过DB和构建）
cd deploy && python deploy.py --skip-db --skip-build

# 修复数据（一次性脚本）
cd deploy && python fix_week_dates.py

# 查看生产日志
ssh root@jfzhu8023.cloud "pm2 logs devtracker --lines 50"

# 重启后端
ssh root@jfzhu8023.cloud "cd /opt/devtracker && pm2 restart devtracker"
```

## 四、设计约定

1. **周期计算**：周一（start）到周日（end），ISO周数
2. **季度归属**：统一用 `end_date` 月份判定（跨季度归后一季度）
3. **权限链接**：URL 使用 `/access?token=xxx`，由路由守卫统一分发
4. **URL域名**：统一使用 `jfzhu8023.cloud`，不使用IP
5. **版本号**：当前 v1.4.0，显示在页面底部 footer
6. **CSS命名**：BEM风格前缀 `dt-`，如 `.dt-page-header`

## 五、版本历史

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v1.0.0 | 2026-04 | 初版：任务CRUD + 填写 + 报表 |
| v1.1.0 | 2026-04 | 编辑状态 + 个人统计 + 权限系统 |
| v1.2.0 | 2026-04 | 文本识别引擎增强 |
| v1.3.0 | 2026-04 | 草稿暂存功能 |
| v1.4.0 | 2026-04-16 | 7项增强 + 双栏填写 + 域名 + 数据修正 |

## 六、下次开发待关注

1. 需求工时统计页面的周数计算是否符合预期（第16周=4月13日起）
2. 填写页右侧历史面板的实时更新效果确认
3. 权限链接打开是否已完全修复（建议测试新tab打开）
4. 服务器Node.js版本升级（当前v16，建议升至v18+）
