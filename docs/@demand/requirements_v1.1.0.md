# DevTracker v1.1.0 — 需求规格文档

> **版本**：v1.1.0  
> **基线版本**：v1.0.0（M1~M3 全部完成）  
> **创建时间**：2026-04-15 23:14  
> **需求来源**：用户反馈 21 条改进项

---

## 一、需求总览

共 21 项需求，按功能模块分为 **8 组**：

| 组别 | 模块 | 涉及需求编号 | 优先级 |
|:---|:---|:---|:---:|
| A | 填写页（FillPage） | #1, #2 | P0 |
| B | 全局变更 | #3, #4 | P0 |
| C | 任务收集（TaskList + TaskDetail） | #5, #14, #16, #17, #18 | P0 |
| D | 需求工时统计（ReportPage） | #6, #7, #8, #9, #10 | P0 |
| E | 周期统计（StatsPage 部门全观） | #11, #12, #13, #19 | P1 |
| F | 个人聚焦（StatsPage Tab2） | #15 | P1 |
| G | 团队人员（PersonnelPage） | #20 | P2 |
| H | 权限控制（全新模块） | #21 | P2 |

---

## 二、需求详细描述

### A 组：填写页（FillPage）

#### REQ-01：一键识别改为内嵌输入框
- **现状**：点击「一键识别粘贴」按钮弹出 Dialog 弹窗
- **目标**：
  1. 移除弹窗，改为在表格**上方**直接显示一个多行文本输入框（textarea）
  2. 输入框右下角放置「识别并填入」按钮
  3. 用户粘贴文本后点击按钮，解析结果直接追加到下方表格
  4. 「+ 新增需求行」按钮移到**表格最后一行下方靠左**位置

#### REQ-02：填写页布局调整
- **现状**：`max-width: 960px; margin: 0 auto;`，两侧留白过大
- **目标**：
  1. 两侧留白各 **150px**（即 `padding: 0 150px;`，宽度铺满）
  2. 「需求标题」列 `min-width` 从 200px 增加到 **320px**

---

### B 组：全局变更

#### REQ-03：工时单位统一
- **现状**：全部页面工时显示为 `h`（如 `49.0 h`、`工时(h)`、`总计/h`）
- **目标**：全部替换为 `/小时`
  - 表头：`工时(h)` → `工时/小时`
  - 数值旁：`5.00 h` → `5.00 /小时`
  - 合计：`总计/h` → `总计/小时`
  - 总工时展示：`49.0 h` → `49.0 小时`

涉及文件：
| 文件 | 替换内容 |
|:---|:---|
| FillPage.vue | `工时(h)` → `工时/小时`、底栏 `h` → `小时` |
| ReportPage.vue | `总计/h` → `总计/小时`、右上角 `h` → `小时` |
| TaskDetail.vue | `工时(h)` → `工时/小时` |
| StatsPage.vue | 所有 `/h` → `/小时` |

#### REQ-04：全部页面添加刷新按钮
- **目标**：在每个**管理端页面**的页面标题区右侧添加刷新图标按钮（🔄）
- **点击后**：重新调用当前页面的数据加载函数，刷新当前页面数据（不刷新浏览器）
- **涉及页面**：
  1. TaskList — `taskStore.fetchAll()`
  2. TaskDetail — `loadTaskData()`
  3. ReportPage — `reportStore.fetchByTask(selectedTaskId)`
  4. StatsPage — `loadDeptStats()` 或 `fetchPersonal()`
  5. PersonnelPage — `staffStore.fetchAll()`

---

### C 组：任务收集（TaskList + TaskDetail）

#### REQ-05：名称与维度中文化
- **导航栏**：`任务清单` → `任务收集`
- **页面标题**：`任务清单` → `任务收集`
- **副标题**：`管理和查看所有收集任务` → `管理和查看所有收集任务`（保留）
- **路由 meta.title**：`任务清单` → `任务收集`
- **维度列中文映射**：

| 原值 | 中文 |
|:---|:---|
| day | 日 |
| week | 周 |
| half_month | 半月 |
| month | 月 |
| quarter | 季度 |
| half_year | 半年 |
| year | 年 |

#### REQ-14：新建任务弹窗改进 + 任务编辑/删除
1. **日期控件风格**：参照 Demo 样式（当前自定义日历已接近 Demo，保持不变，但检查是否需要微调）
2. **已创建的任务支持编辑**：
   - TaskList 行上增加「编辑」按钮 → 打开 CreateTaskModal 编辑模式
   - 预填已有数据（维度、起止日期、标题）
   - 提交走 `PUT /api/tasks/:id`
3. **已创建的任务支持删除**：
   - TaskList 行上增加「删除」按钮
   - 二次确认 → 调用 `DELETE /api/tasks/:id`

#### REQ-16：任务停止/开始收集
1. **数据库变更**：`collection_tasks.status` 已有 `active` / `closed` / `draft`，复用 `active` 和 `closed`
2. **TaskList 页面**：
   - 每行增加操作按钮：当 `active` 时显示「停止收集」，当 `closed` 时显示「开始收集」
   - 点击调用 `PUT /api/tasks/:id { status: 'closed' }` 或 `{ status: 'active' }`
3. **TaskDetail 提交数据页**：
   - 每条记录右侧增加「停止/开始」子任务操作（针对单条 WorkRecord 新增 `is_active` 字段）
4. **FillPage 保存时校验**：
   - 提交前调用后端检查任务状态
   - 若任务已停止 → 提示：**「该任务已停止收集，请联系管理员重新开启任务收集！」**
   - 后端 `/api/fill/:token/submit` 增加状态检查

#### REQ-17：实时编辑/提交状态通知 ⭐ 重要
> 此需求涉及 **长连接/轮询** 机制，需后端配合

1. **后端新增 API**：
   - `PUT /api/fill/:token/editing` — 标记「正在编辑」
   - 编辑状态写入内存（或数据库 `fill_links.editing_at` 时间戳字段）
2. **TaskList 主任务行**：
   - 轮询 `GET /api/tasks/:id/activity` 获取当前活动状态
   - 若有成员正在编辑 → 行右侧实时显示绿色标签 **「成员正在编辑任务」**
   - 若有成员提交 → 显示 **「成员提交任务」** 3 秒后消失
3. **TaskDetail 提交数据页右上角**：
   - 同样显示实时状态标签
   - 显示「成员正在编辑任务」/ 「成员提交任务」/ 「保存草稿」
4. **提交数据列表单条记录状态**：
   - 被修改中 → 显示 **「任务正在编辑中」**
   - 已提交 → 显示 **「任务已提交」**
5. **修改和提交次数统计**：
   - `work_records` 表新增字段：`edit_count INT DEFAULT 0`、`submit_count INT DEFAULT 0`
   - 每次编辑/提交时递增
6. **FillPage 触发通知**：
   - 用户输入框获得焦点 → 调用 `PUT /api/fill/:token/editing`
   - 提交成功 → 自动通知后端
   - 暂存草稿 → 自动通知后端
7. **轮询机制**：前端使用 `setInterval`（5 秒间隔）轮询活动状态，页面离开时清除

#### REQ-18：移除 TaskDetail 内的汇总报表 Tab
- **操作**：删除 TaskDetail.vue 中的 Tab 3（汇总报表），改为双 Tab 结构：
  - Tab 1: 提交数据
  - Tab 2: 链接管理

---

### D 组：需求工时统计（原汇总报表，ReportPage）

#### REQ-06：默认显示上一周期数据
- **现状**：默认选中 `taskStore.list[0]`（最新任务）
- **目标**：默认选中**上一个周期**的任务
  - 例如当前是第 16 周，默认显示第 15 周的数据
  - 逻辑：`taskStore.list[1]`（列表按 `start_date DESC` 排序，index=1 即上一个周期）
  - 若只有 1 条任务，则选中唯一的那条

#### REQ-07：工时突出显示 + 合计行修正
1. **所有工时数据加粗显示**：前端/后端/测试/总计列的数据全部 `font-weight: 700`
2. **合计行**：
   - 「合计」两个字从**纵向**改为**横向排列**（去除当前的换行/竖排显示）
   - 前端合计值放在**前端列**、后端合计值放在**后端列**、测试合计值放在**测试列**、总计合计值放在**总计列**
   - 确保列位置正确对应

#### REQ-08：改名 + 上下周期切换
1. **改名**：
   - 导航菜单：`汇总报表` → `需求工时统计`
   - 页面标题：`汇总报表` → `需求工时统计`
   - 路由 meta.title：同步修改
2. **移除「🔄 智能匹配」按钮**
3. **新增上下周期切换按钮**：
   - 在任务下拉框左右两侧放置 `◀ 上一周期` 和 `下一周期 ▶` 按钮
   - 点击后切换到 taskStore.list 中的上/下一条任务
   - 到达首尾时按钮置灰 disabled

#### REQ-09：新增行可删除 + 编辑模式
1. **编辑按钮**：在排序按钮群后面增加独立的「✏️ 编辑」按钮
2. **点击编辑**：
   - 表格最后出现**「操作」列**（含删除按钮）
   - **当前页面新增的行**（`status === 'manual_merged'`）可删除可编辑
   - **其他页面汇总来的行**（`status !== 'manual_merged'`）只显示「-」不可删除
   - 删除需**二次确认**
   - 新增行的版本号/需求名称/产品经理可内联编辑
3. **再次点击编辑**：
   - 退出编辑模式
   - 操作列隐藏
   - 所有行（除备注外）不可编辑

#### REQ-10：标题括号显示当前周期
- **现状**：`需求工时统计`
- **目标**：`需求工时统计（第15周）`
  - 括号内容根据选中的任务动态变化
  - 显示格式：第xx周 / 日 / 月 / 季度 等（取 `time_dimension` 字段映射）
  - 括号内文字**加粗**

---

### E 组：周期统计 — 部门全观（StatsPage）

#### REQ-11：改名 + 数据修正 + 图表清晰度
1. **导航菜单名**：`周期统计` → `周期统计（季度）`
2. **数据修正**：
   - 部门全观的概要卡片和柱状图的数据统计逻辑需要修正
   - 当前基于 `matchGroups` 可能获取不到正确的分角色统计
   - 改为直接基于 `WorkRecord` 按 `staff.role` 聚合计算
3. **图表文字模糊修正**：
   - Canvas 绘制时确保使用 `devicePixelRatio` 修正（已有但可能不完整）
   - 字体大小提高到不低于 13px
   - 图例和轴标签使用明确的字体渲染

#### REQ-12：筛选器布局调整
- **现状**：部门全观 Tab 内部有独立的任务下拉框
- **目标**：
  1. 把筛选下拉移到**季度下拉框右侧**（年度/季度/任务周期 三联排列）
  2. 默认选中「全部周期」
  3. 选中具体周期后：
     - 标题随之变化（如「部门工时分布 — Q2」变为「部门工时分布 — 第15周」）
     - 数据聚焦到该周期范围

#### REQ-13：柱状图改为按产品经理分布
1. **标题改名**：`部门工时分布` → `按产品经理工时分布`
2. **柱状图数据源**：
   - 每组柱状图对应一个产品经理
   - 每组 4 根柱：前端 / 后端 / 测试 / 总计
   - 柱顶数值显示格式：`前端：24` / `后端：66` / `测试：99` / `总计：1000`
3. **下方明细表改造**：
   - 第一列：序号
   - 第二列：产品经理（**合并单元格**）— 同一个 PM 名字占多行，右侧是多行需求数据
   - 所有数据来自当前筛选范围

#### REQ-19：新增角色分类工时卡片
- **现状**：4 张概要卡片（总工时/记录数/人员数/任务数）
- **目标**：在第一行卡片后追加 3 张：
  - 前端总工时（当前季度/选中范围）
  - 后端总工时（当前季度/选中范围）
  - 测试总工时（当前季度/选中范围）
- 标题随筛选范围动态变化

---

### F 组：个人聚焦

#### REQ-15：个人聚焦交互优化
1. **自动展开最近周期**：选中人员后，自动展开该人员最近（时间最晚）的那个任务周期手风琴面板
2. **间距优化**：选中人员后，个人概要卡片与上方人员选择器间距缩小（`margin-top: 8px`）

---

### G 组：团队人员

#### REQ-20：铺开显示
- **现状**：Element Plus 表格，列间距正常但整体感觉拥挤
- **目标**：
  1. 改为卡片式布局（每人一张卡片），水平排列自动换行
  2. 每张卡片显示：头像首字 + 姓名 + 角色 Tag + 状态徽章
  3. 卡片右上角有编辑/删除按钮
  4. 保留底部新增人员弹窗

---

### H 组：权限控制（全新模块）

#### REQ-21：权限控制页面
1. **新增路由**：`/permissions`
2. **导航入口**：Header 右侧「管理员」按钮旁新增「🔐 权限」入口
3. **功能**：
   - 可创建「访问链接」，每个链接绑定一组权限规则
   - 权限规则控制该链接能访问的 **页面** / **按钮** / **操作**
   - 权限粒度：**查看** / **新增** / **修改** / **删除**
4. **数据模型**（新增 2 张表）：

```sql
CREATE TABLE access_links (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '链接名称',
  token VARCHAR(200) UNIQUE NOT NULL COMMENT '访问令牌',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE link_permissions (
  id CHAR(36) PRIMARY KEY,
  link_id CHAR(36) NOT NULL COMMENT '关联 access_links.id',
  resource VARCHAR(100) NOT NULL COMMENT '资源标识（页面/按钮）',
  can_view TINYINT(1) DEFAULT 0,
  can_create TINYINT(1) DEFAULT 0,
  can_update TINYINT(1) DEFAULT 0,
  can_delete TINYINT(1) DEFAULT 0,
  FOREIGN KEY (link_id) REFERENCES access_links(id) ON DELETE CASCADE
);
```

5. **资源标识清单**（resource 字段值）：

| resource | 说明 |
|:---|:---|
| page:tasks | 任务收集页 |
| page:report | 需求工时统计页 |
| page:stats | 周期统计页 |
| page:personnel | 团队人员页 |
| page:permissions | 权限管理页 |
| btn:create_task | 新建收集按钮 |
| btn:edit_task | 编辑任务按钮 |
| btn:delete_task | 删除任务按钮 |
| btn:stop_task | 停止收集按钮 |

6. **前端校验**：通过 URL 中的 token 参数加载权限配置，动态隐藏无权限的页面和按钮

---

## 三、数据库变更汇总

| 表名 | 操作 | 字段 | 说明 |
|:---|:---|:---|:---|
| work_records | ADD COLUMN | `edit_count INT DEFAULT 0` | 编辑次数 (#17) |
| work_records | ADD COLUMN | `submit_count INT DEFAULT 0` | 提交次数 (#17) |
| work_records | ADD COLUMN | `is_active TINYINT(1) DEFAULT 1` | 子任务停止/开始 (#16) |
| fill_links | ADD COLUMN | `editing_at DATETIME NULL` | 最后编辑时间 (#17) |
| fill_links | ADD COLUMN | `last_action VARCHAR(20) NULL` | 最后动作 (#17) |
| fill_links | ADD COLUMN | `last_action_at DATETIME NULL` | 最后动作时间 (#17) |
| access_links | CREATE | — | 访问链接 (#21) |
| link_permissions | CREATE | — | 权限配置 (#21) |

---

## 四、API 变更汇总

| 方法 | 路径 | 说明 | 需求 |
|:---|:---|:---|:---:|
| PUT | `/api/tasks/:id` | 增加 status 切换 | #16 |
| PUT | `/api/fill/:token/editing` | 标记编辑状态 | #17 |
| GET | `/api/tasks/:id/activity` | 获取任务活动状态 | #17 |
| DELETE | `/api/report/:id` | 删除手动添加的匹配组 | #9 |
| PUT | `/api/report/:id` | 支持编辑版本号/标题/PM | #9 |
| CRUD | `/api/access-links` | 访问链接管理 | #21 |
| CRUD | `/api/permissions` | 权限配置管理 | #21 |
