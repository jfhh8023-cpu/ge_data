/**
 * Local workload analysis report generator.
 *
 * Read-only data source:
 *   work_records + staff + collection_tasks + product_managers
 *
 * Usage:
 *   cd backend
 *   node scripts/analyze_workload.js
 *   node scripts/analyze_workload.js --year=2026 --quarter=Q2
 *   node scripts/analyze_workload.js --year=2026 --quarter=Q2 --out=../.codex-local/reports/q2
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ROLE_KEYS = ['frontend', 'backend', 'test'];
const ROLE_TEXT = { frontend: '前端', backend: '后端', test: '测试' };
const ROLE_CLASS = { frontend: 'fe', backend: 'be', test: 'qa' };
const ROLE_COLORS = { frontend: '#2563eb', backend: '#16a34a', test: '#f97316' };
const DEFAULT_PM = '不在上述';

const KEYWORD_DEFS = [
  ['语音', /语音|通话|呼叫|坐席|热线|双声道|录音|TTS|SIP|kamailio|vos|VOS|DID|网关|线路|外呼|群呼|CC/i],
  ['AI/智能体', /智能体|Agent|agent|AI|意图识别|知识库/i],
  ['工单/任务', /工单|任务|待办|审批|流转/],
  ['监控/告警', /监控|告警|日志|链路|审计|报表|统计/],
  ['供应商/号码', /供应商|号码|DID|号显|线路/],
  ['性能/优化', /优化|性能|压测|卡顿|稳定|改进|升级/],
  ['部署/运维', /部署|服务器|环境|网关|TLS|证书|服务|运维/],
  ['短信', /短信|SMS/i],
  ['前端界面', /前端|页面|界面|列表|按钮|展示|排序|UI/i],
  ['测试问题', /测试|问题|缺陷|bug|修复|异常|定位/i]
];

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part.startsWith('--')) continue;
    const [key, ...rest] = part.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(value) {
  return String(value || 'all').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'all';
}

function dateStr(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const p = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function quarterRange(year, quarter) {
  const map = { Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12] };
  const pair = map[String(quarter || '').toUpperCase()];
  if (!year || !pair) return null;
  const [startMonth, endMonth] = pair;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(getLastDayOfMonth(year, endMonth)).padStart(2, '0')}`;
  return { start, end };
}

function monthOf(value) {
  return dateStr(value).slice(0, 7);
}

function quarterOf(value) {
  const s = dateStr(value);
  const year = s.slice(0, 4);
  const month = Number(s.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function parseJsonArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value !== 'string') return [];
  let text = value.trim();
  if (!text || text === 'null') return [];
  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') {
        text = parsed;
        continue;
      }
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

function emptyGroup() {
  return {
    total: 0,
    frontend: 0,
    backend: 0,
    test: 0,
    records: 0,
    tasks: new Set(),
    requirements: new Set()
  };
}

function addWork(group, row, hours, reqKey) {
  group.total += hours;
  group.records += 1;
  group.tasks.add(row.task_id);
  group.requirements.add(reqKey);
  if (ROLE_KEYS.includes(row.role)) group[row.role] += hours;
}

function round(value, digits = 1) {
  return Number(Number(value || 0).toFixed(digits));
}

function pct(value, total) {
  return total ? round((value * 100) / total, 1) : 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function versionDisplayName(version, title) {
  const rawVersion = String(version || '').trim();
  if (!rawVersion || rawVersion === '未填版本') return '——';
  let name = String(title || '').trim();
  if (!name) return '——';
  name = name.replace(new RegExp(escapeRegExp(rawVersion), 'ig'), '');
  name = name.replace(/^[\s:：\-—_【】[\]()（）]+/, '').trim();
  return name || '——';
}

function groupToRows(map, totalHours, limit = Infinity) {
  return Object.entries(map)
    .map(([name, group]) => ({
      name,
      total: round(group.total),
      frontend: round(group.frontend),
      backend: round(group.backend),
      test: round(group.test),
      records: group.records,
      taskCount: group.tasks.size,
      requirementCount: group.requirements.size,
      share: pct(group.total, totalHours),
      frontendShare: pct(group.frontend, group.total),
      backendShare: pct(group.backend, group.total),
      testShare: pct(group.test, group.total)
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function periodSortValue(name) {
  const text = String(name || '');
  const rangeMatch = text.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) return rangeMatch[2];
  const monthMatch = text.match(/^\d{4}-\d{2}/);
  if (monthMatch) return monthMatch[0];
  const quarterMatch = text.match(/^(\d{4})-Q([1-4])/);
  if (quarterMatch) return `${quarterMatch[1]}-${String(Number(quarterMatch[2]) * 3).padStart(2, '0')}`;
  const yearMatch = text.match(/^\d{4}/);
  return yearMatch ? yearMatch[0] : text;
}

function periodRows(map, direction = 'desc') {
  return Object.entries(map)
    .map(([name, group]) => ({
      name,
      sortKey: periodSortValue(name),
      total: round(group.total),
      frontend: round(group.frontend),
      backend: round(group.backend),
      test: round(group.test),
      records: group.records,
      taskCount: group.tasks.size,
      requirementCount: group.requirements.size,
      frontendShare: pct(group.frontend, group.total),
      backendShare: pct(group.backend, group.total),
      testShare: pct(group.test, group.total)
    }))
    .sort((a, b) => {
      const compare = String(a.sortKey).localeCompare(String(b.sortKey), 'zh-CN', { numeric: true });
      return direction === 'asc' ? compare : -compare;
    });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function roleCell(row, role) {
  return `<td class="num ${ROLE_CLASS[role]}-text">${fmt(row[role])}</td>`;
}

function tableHeaders(headers) {
  return headers.map((header, index) => {
    const config = typeof header === 'string' ? { label: header } : header;
    const classAttr = config.className ? ` class="${escapeHtml(config.className)}"` : '';
    return `<th${classAttr} data-sort-index="${index}" title="点击排序">${escapeHtml(config.label)}</th>`;
  }).join('');
}

function table(headers, rows, renderRow, options = {}) {
  const className = ['sortable-table', options.className].filter(Boolean).join(' ');
  return `
    <div class="table-wrap">
      <table class="${escapeHtml(className)}">
        <thead><tr>${tableHeaders(headers)}</tr></thead>
        <tbody>${rows.map(renderRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function chartLabel(row) {
  if (row.label) return String(row.label);
  if (row.title && row.version) {
    const title = String(row.title);
    const version = String(row.version);
    return title.toLowerCase().includes(version.toLowerCase()) ? title : `${version} - ${title}`;
  }
  if (row.title) return String(row.title);
  if (row.name) return String(row.name);
  if (row.version) return String(row.version);
  if (row.combo) return String(row.combo);
  return '';
}

function segmentText(row, role) {
  const hours = Number(row[role] || 0);
  const share = pct(hours, row.total);
  return `${ROLE_TEXT[role]} ${fmt(hours)}h / ${share}%`;
}

function stackedBarChart(rows, title, options = {}) {
  const data = rows.filter(r => Number(r.total) > 0).slice(0, options.limit || 999);
  const max = Math.max(...data.map(r => Number(r.total || 0)), 1);
  const rowsHtml = data.map(row => {
    const label = chartLabel(row);
    const totalWidth = Math.max(1, pct(row.total, max));
    const segments = ROLE_KEYS.map(role => ({
      role,
      className: ROLE_CLASS[role],
      width: pct(row[role], row.total),
      hours: Number(row[role] || 0),
      text: segmentText(row, role)
    }));
    const segmentSpans = segments.map(segment => `
      <span
        class="seg ${segment.className}"
        style="width:${segment.width}%"
        title="${escapeHtml(segment.text)}"
      ></span>
    `).join('');
    const segmentDetails = segments
      .filter(segment => segment.hours > 0)
      .map(segment => `<span class="segment-pill ${segment.className}"><i class="dot ${segment.className}"></i>${escapeHtml(segment.text)}</span>`)
      .join('');
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="bar-track">
          <div class="bar-stack" style="width:${totalWidth}%">
            ${segmentSpans}
          </div>
        </div>
        <div class="bar-value">${fmt(row.total)}h</div>
        <div class="segment-breakdown">${segmentDetails}</div>
      </div>
    `;
  }).join('');
  return `
    <section class="panel">
      <div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="legend">
          <span><i class="dot fe"></i>前端</span>
          <span><i class="dot be"></i>后端</span>
          <span><i class="dot qa"></i>测试</span>
        </div>
      </div>
      <div class="bar-list">${rowsHtml || '<p class="muted">无数据</p>'}</div>
    </section>
  `;
}

function simpleBarChart(rows, title, options = {}) {
  const data = rows.filter(r => Number(r.total) > 0).slice(0, options.limit || 999);
  const max = Math.max(...data.map(r => Number(r.total || 0)), 1);
  const metaField = options.metaField;
  const titleHelp = options.tip
    ? `<button type="button" class="notice-help" aria-label="${escapeHtml(title)}说明" data-tip="${escapeHtml(options.tip)}">?</button>`
    : '';
  const rowsHtml = data.map(row => {
    const label = chartLabel(row);
    const meta = metaField ? String(row[metaField] || '——') : '';
    return `
      <div class="bar-row simple ${metaField ? 'has-meta' : ''}">
        <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        ${metaField ? `<div class="bar-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>` : ''}
        <div class="bar-track">
          <div class="bar-single" style="width:${Math.max(1, pct(row.total, max))}%"></div>
        </div>
        <div class="bar-value">${fmt(row.total)}h</div>
      </div>
    `;
  }).join('');
  return `
    <section class="panel">
      <div class="section-head"><h2>${escapeHtml(title)}${titleHelp}</h2></div>
      <div class="bar-list">${rowsHtml || '<p class="muted">无数据</p>'}</div>
    </section>
  `;
}

function roleComposition(summary) {
  const items = ROLE_KEYS.map(role => ({
    role,
    label: ROLE_TEXT[role],
    hours: summary[role],
    share: pct(summary[role], summary.total)
  }));
  return `
    <section class="panel">
      <div class="section-head"><h2>角色工时构成</h2></div>
      <div class="composition">
        ${items.map(item => `
          <div class="composition-item">
            <div class="composition-top">
              <span><i class="dot ${ROLE_CLASS[item.role]}"></i>${item.label}</span>
              <strong>${fmt(item.hours)}h / ${item.share}%</strong>
            </div>
            <div class="composition-track"><span class="${ROLE_CLASS[item.role]}" style="width:${item.share}%"></span></div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function buildWhere(args) {
  const recordWhere = [];
  const recordParams = [];
  const taskWhere = [];
  const taskParams = [];
  const scope = [];
  const year = args.year ? Number(args.year) : null;
  const quarter = args.quarter ? String(args.quarter).toUpperCase() : null;
  const taskId = args.taskId && args.taskId !== 'all' ? String(args.taskId) : null;

  if (year) {
    recordWhere.push('ct.year = ?');
    recordParams.push(year);
    taskWhere.push('ct.year = ?');
    taskParams.push(year);
    scope.push(`${year}年`);
  }
  if (quarter) {
    const range = quarterRange(year || new Date().getFullYear(), quarter);
    if (!range) throw new Error(`无效季度：${quarter}`);
    recordWhere.push('ct.end_date BETWEEN ? AND ?');
    recordParams.push(range.start, range.end);
    taskWhere.push('ct.end_date BETWEEN ? AND ?');
    taskParams.push(range.start, range.end);
    scope.push(quarter);
  }
  if (taskId) {
    recordWhere.push('wr.task_id = ?');
    recordParams.push(taskId);
    taskWhere.push('ct.id = ?');
    taskParams.push(taskId);
    scope.push(`taskId=${taskId}`);
  }
  return {
    recordClause: recordWhere.length ? `WHERE ${recordWhere.join(' AND ')}` : '',
    recordParams,
    taskClause: taskWhere.length ? `WHERE ${taskWhere.join(' AND ')}` : '',
    taskParams,
    scopeText: scope.length ? scope.join(' / ') : '全部本地数据'
  };
}

async function loadData(args) {
  const where = buildWhere(args);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION READ ONLY');
  try {
    const [rows] = await conn.query(`
      SELECT wr.id, wr.task_id, wr.staff_id, wr.requirement_title, wr.version, wr.product_managers,
             CAST(wr.hours AS DECIMAL(10,2)) AS hours, wr.created_at, wr.updated_at, wr.is_active,
             wr.edit_count, wr.submit_count,
             s.name AS staff_name, s.role AS role, s.is_active AS staff_active,
             ct.title AS task_title, ct.time_dimension, ct.start_date, ct.end_date,
             ct.week_number, ct.year, ct.status AS task_status
      FROM work_records wr
      JOIN staff s ON s.id = wr.staff_id
      JOIN collection_tasks ct ON ct.id = wr.task_id
      ${where.recordClause}
      ORDER BY ct.end_date, ct.week_number, s.role, s.name, wr.requirement_title
    `, where.recordParams);

    const [tasks] = await conn.query(`
      SELECT ct.*
      FROM collection_tasks ct
      ${where.taskClause}
      ORDER BY ct.end_date
    `, where.taskParams);
    const [staff] = await conn.query('SELECT id, name, role, is_active, sort_order FROM staff ORDER BY role, sort_order, name');
    const [pms] = await conn.query('SELECT id, name, is_active, sort_order FROM product_managers ORDER BY sort_order, name');

    await conn.query('COMMIT');
    return { rows, tasks, staff, pms, scopeText: where.scopeText };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    await conn.end();
  }
}

function analyze(data) {
  const { rows, tasks, staff, pms, scopeText } = data;
  const totalGroup = emptyGroup();
  const byQuarter = {};
  const byMonth = {};
  const byWeek = {};
  const byStaff = {};
  const byPm = {};
  const byVersion = {};
  const byKeyword = {};
  const reqMap = {};
  const comboMap = {};
  const recordDetails = [];
  for (const [name] of KEYWORD_DEFS) byKeyword[name] = emptyGroup();

  const quality = {
    emptyPm: { count: 0, hours: 0 },
    explicitDefaultPm: { count: 0, hours: 0 },
    missingVersion: { count: 0, hours: 0 },
    zeroHours: { count: 0, hours: 0 },
    inactiveRecords: { count: 0, hours: 0 },
    editedRecords: { count: 0, hours: 0 },
    resubmittedRecords: { count: 0, hours: 0 }
  };

  for (const row of rows) {
    const hours = Number(row.hours || 0);
    const pmsForRow = parseJsonArray(row.product_managers).map(item => String(item || '').trim()).filter(Boolean);
    const firstPm = pmsForRow[0] || DEFAULT_PM;
    const version = String(row.version || '').trim() || '未填版本';
    const weekName = weekPeriodName(row);
    const staffName = `${row.staff_name}（${ROLE_TEXT[row.role] || row.role}）`;
    const reqKey = `${row.task_id}||${String(row.requirement_title || '').trim()}||${version}`;
    const q = quarterOf(row.end_date);
    const m = monthOf(row.end_date);

    recordDetails.push({
      id: row.id,
      taskId: row.task_id,
      period: weekName,
      periodSort: dateStr(row.end_date),
      quarter: q,
      month: m,
      staff: row.staff_name,
      staffLabel: staffName,
      role: row.role,
      roleText: ROLE_TEXT[row.role] || row.role,
      pm: firstPm,
      title: String(row.requirement_title || '').trim(),
      version,
      hours: round(hours),
      productManagers: pmsForRow,
      emptyProductManager: pmsForRow.length === 0,
      missingVersion: !String(row.version || '').trim()
    });

    addWork(totalGroup, row, hours, reqKey);

    byQuarter[q] ||= emptyGroup();
    addWork(byQuarter[q], row, hours, reqKey);

    byMonth[m] ||= emptyGroup();
    addWork(byMonth[m], row, hours, reqKey);

    byWeek[weekName] ||= emptyGroup();
    addWork(byWeek[weekName], row, hours, reqKey);

    byStaff[staffName] ||= emptyGroup();
    addWork(byStaff[staffName], row, hours, reqKey);

    byPm[firstPm] ||= emptyGroup();
    addWork(byPm[firstPm], row, hours, reqKey);

    byVersion[version] ||= emptyGroup();
    addWork(byVersion[version], row, hours, reqKey);

    for (const [name, regex] of KEYWORD_DEFS) {
      if (regex.test(`${row.requirement_title || ''} ${version}`)) {
        addWork(byKeyword[name], row, hours, reqKey);
      }
    }

    const req = reqMap[reqKey] ||= {
      title: String(row.requirement_title || '').trim(),
      version,
      task: weekName,
      taskSort: dateStr(row.end_date),
      pm: firstPm,
      total: 0,
      frontend: 0,
      backend: 0,
      test: 0,
      records: 0,
      staff: new Set()
    };
    req.total += hours;
    req.records += 1;
    req.staff.add(row.staff_name);
    if (ROLE_KEYS.includes(row.role)) req[row.role] += hours;

    if (pmsForRow.length === 0) {
      quality.emptyPm.count += 1;
      quality.emptyPm.hours += hours;
    }
    if (pmsForRow.includes(DEFAULT_PM)) {
      quality.explicitDefaultPm.count += 1;
      quality.explicitDefaultPm.hours += hours;
    }
    if (!String(row.version || '').trim()) {
      quality.missingVersion.count += 1;
      quality.missingVersion.hours += hours;
    }
    if (hours <= 0) {
      quality.zeroHours.count += 1;
      quality.zeroHours.hours += hours;
    }
    if (!row.is_active) {
      quality.inactiveRecords.count += 1;
      quality.inactiveRecords.hours += hours;
    }
    if (Number(row.edit_count || 0) > 0) {
      quality.editedRecords.count += 1;
      quality.editedRecords.hours += hours;
    }
    if (Number(row.submit_count || 0) > 1) {
      quality.resubmittedRecords.count += 1;
      quality.resubmittedRecords.hours += hours;
    }
  }

  const totalHours = totalGroup.total;
  const requirements = Object.values(reqMap)
    .map(req => {
      const roleCombo = ROLE_KEYS.filter(role => req[role] > 0).map(role => ROLE_TEXT[role]).join('+') || '无角色';
      return {
        title: req.title,
        version: req.version,
        task: req.task,
        taskSort: req.taskSort,
        pm: req.pm,
        roleCombo,
        total: round(req.total),
        frontend: round(req.frontend),
        backend: round(req.backend),
        test: round(req.test),
        records: req.records,
        staffCount: req.staff.size
      };
    })
    .sort((a, b) => b.total - a.total);

  const versionMeta = {};
  for (const req of requirements) {
    const displayName = versionDisplayName(req.version, req.title);
    if (displayName === '——') continue;
    const current = versionMeta[req.version];
    if (!current || req.total > current.hours) {
      versionMeta[req.version] = { versionName: displayName, hours: req.total };
    }
  }

  for (const req of requirements) {
    comboMap[req.roleCombo] ||= { total: 0, requirementCount: 0, topRequirement: req };
    comboMap[req.roleCombo].total += req.total;
    comboMap[req.roleCombo].requirementCount += 1;
    if (req.total > comboMap[req.roleCombo].topRequirement.total) comboMap[req.roleCombo].topRequirement = req;
  }

  const roleCombos = Object.entries(comboMap)
    .map(([combo, value]) => ({
      combo,
      total: round(value.total),
      requirementCount: value.requirementCount,
      share: pct(value.total, totalHours),
      topRequirement: value.topRequirement
    }))
    .sort((a, b) => b.total - a.total);

  const qualitySummary = {};
  for (const [key, value] of Object.entries(quality)) {
    qualitySummary[key] = {
      count: value.count,
      hours: round(value.hours),
      share: pct(value.hours, totalHours)
    };
  }

  const dataset = {
    scope: scopeText,
    recordCount: rows.length,
    requirementCount: requirements.length,
    taskCount: new Set(rows.map(row => row.task_id)).size,
    allTaskCount: tasks.length,
    staffCount: staff.length,
    activeStaffCount: staff.filter(item => item.is_active).length,
    productManagerCount: pms.length,
    activeProductManagerCount: pms.filter(item => item.is_active).length,
    dateStart: tasks.length ? dateStr(tasks[0].start_date) : '',
    dateEnd: tasks.length ? dateStr(tasks[tasks.length - 1].end_date) : ''
  };

  const summary = {
    total: round(totalGroup.total),
    frontend: round(totalGroup.frontend),
    backend: round(totalGroup.backend),
    test: round(totalGroup.test),
    frontendShare: pct(totalGroup.frontend, totalGroup.total),
    backendShare: pct(totalGroup.backend, totalGroup.total),
    testShare: pct(totalGroup.test, totalGroup.total),
    records: totalGroup.records,
    avgRecordHours: round(totalGroup.total / Math.max(totalGroup.records, 1)),
    avgRequirementHours: round(totalGroup.total / Math.max(requirements.length, 1))
  };

  return {
    generatedAt: new Date().toISOString(),
    dataset,
    summary,
    quarters: periodRows(byQuarter),
    months: periodRows(byMonth),
    weeks: periodRows(byWeek),
    topWeeks: periodRows(byWeek).sort((a, b) => b.total - a.total).slice(0, 12),
    staff: groupToRows(byStaff, totalHours),
    productManagers: groupToRows(byPm, totalHours),
    versions: groupToRows(byVersion, totalHours).map(row => ({
      ...row,
      versionName: versionMeta[row.name]?.versionName || '——'
    })),
    keywords: groupToRows(byKeyword, totalHours).filter(row => row.total > 0),
    roleCombos,
    requirements,
    topRequirements: requirements.slice(0, 40),
    requirementDetails: [...requirements].sort((a, b) => String(b.taskSort || '').localeCompare(String(a.taskSort || ''), 'zh-CN') || b.total - a.total),
    records: recordDetails.sort((a, b) => String(b.periodSort || '').localeCompare(String(a.periodSort || ''), 'zh-CN') || b.hours - a.hours),
    dataQuality: qualitySummary,
    inactiveStaff: staff.filter(item => !item.is_active).map(item => ({ name: item.name, role: item.role })),
    inactiveProductManagers: pms.filter(item => !item.is_active).map(item => item.name)
  };
}

function reportRangeText(report) {
  return report.dataset.dateStart && report.dataset.dateEnd
    ? `${report.dataset.dateStart} 至 ${report.dataset.dateEnd}`
    : '未识别时间范围';
}

function reportYearRangeText(report) {
  const startYear = String(report.dataset.dateStart || '').slice(0, 4);
  const endYear = String(report.dataset.dateEnd || '').slice(0, 4);
  if (startYear && endYear && startYear !== endYear) return `${startYear}-${endYear}年`;
  if (startYear || endYear) return `${startYear || endYear}年`;
  return '未识别时间范围';
}

function quarterTitleText(year, quarter) {
  const quarterNumber = String(quarter || '').replace(/^Q/i, '');
  if (!year || !quarterNumber) return '';
  return `${year}年第${Number(quarterNumber)}季度`;
}

function reportTitleScopeText(report) {
  const dataset = report.dataset || {};
  const grain = dataset.periodGrain || '';
  if (grain === 'week') {
    const week = String(dataset.week || '').padStart(2, '0');
    const labelWeek = String(dataset.periodLabel || '').match(/第(\d+)周/);
    return week && week !== '00' ? `第${week}周` : (labelWeek ? `第${labelWeek[1].padStart(2, '0')}周` : reportYearRangeText(report));
  }
  if (grain === 'quarter') {
    return quarterTitleText(dataset.year, dataset.quarter) || reportYearRangeText(report);
  }
  if (grain === 'month') {
    const month = String(dataset.month || '');
    const match = month.match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}年${match[2]}月` : reportYearRangeText(report);
  }
  if (grain === 'year') {
    return dataset.year ? `${dataset.year}年` : reportYearRangeText(report);
  }
  const quarterFromScope = String(dataset.scope || '').match(/(\d{4})\s*\/\s*Q([1-4])/i);
  if (quarterFromScope) return quarterTitleText(quarterFromScope[1], `Q${quarterFromScope[2]}`);
  const yearFromScope = String(dataset.scope || '').match(/^(\d{4})年?$|^(\d{4})\s*(?:\/|$)/);
  if (yearFromScope) return `${yearFromScope[1] || yearFromScope[2]}年`;
  return reportYearRangeText(report);
}

function weekPeriodName(row) {
  const year = row.year || dateStr(row.end_date).slice(0, 4) || dateStr(row.start_date).slice(0, 4);
  const week = String(row.week_number || '').padStart(2, '0');
  return `${year}-第${week}周 ${dateStr(row.start_date)}~${dateStr(row.end_date)}`;
}

function buildScopedReport(data, key, grain, label, rows, tasks, scopeText, extra = {}) {
  const report = analyze({
    rows,
    tasks,
    staff: data.staff,
    pms: data.pms,
    scopeText
  });
  report.dataset.periodKey = key;
  report.dataset.periodGrain = grain;
  report.dataset.periodLabel = label;
  Object.assign(report.dataset, extra);
  return {
    key,
    grain,
    label,
    range: reportRangeText(report),
    scope: report.dataset.scope,
    report
  };
}

function buildPeriodReports(data, baseReport) {
  const rows = data.rows || [];
  const tasks = data.tasks || [];
  baseReport.dataset.periodKey = 'all';
  baseReport.dataset.periodGrain = 'all';
  baseReport.dataset.periodLabel = '全部数据';
  const periods = [{
    key: 'all',
    grain: 'all',
    label: '全部数据',
    range: reportRangeText(baseReport),
    scope: baseReport.dataset.scope,
    report: baseReport
  }];
  const addGroups = (grain, groupRows, groupTasks, labelFor, scopeFor, extraFor = () => ({})) => {
    const keys = Object.keys(groupRows).sort((a, b) => String(b).localeCompare(String(a), 'zh-CN', { numeric: true }));
    for (const key of keys) {
      const scopedRows = groupRows[key] || [];
      if (!scopedRows.length) continue;
      const scopedTasks = groupTasks[key] || [];
      periods.push(buildScopedReport(
        data,
        `${grain}:${key}`,
        grain,
        labelFor(key),
        scopedRows,
        scopedTasks,
        scopeFor(key),
        extraFor(key)
      ));
    }
  };

  const byYearRows = {};
  const byQuarterRows = {};
  const byMonthRows = {};
  const byWeekRows = {};
  for (const row of rows) {
    const year = dateStr(row.end_date).slice(0, 4);
    const quarter = quarterOf(row.end_date);
    const month = monthOf(row.end_date);
    const week = weekPeriodName(row);
    (byYearRows[year] ||= []).push(row);
    (byQuarterRows[quarter] ||= []).push(row);
    (byMonthRows[month] ||= []).push(row);
    (byWeekRows[week] ||= []).push(row);
  }

  const byYearTasks = {};
  const byQuarterTasks = {};
  const byMonthTasks = {};
  const byWeekTasks = {};
  for (const task of tasks) {
    const year = dateStr(task.end_date).slice(0, 4);
    const quarter = quarterOf(task.end_date);
    const month = monthOf(task.end_date);
    const week = weekPeriodName(task);
    (byYearTasks[year] ||= []).push(task);
    (byQuarterTasks[quarter] ||= []).push(task);
    (byMonthTasks[month] ||= []).push(task);
    (byWeekTasks[week] ||= []).push(task);
  }

  addGroups('year', byYearRows, byYearTasks, key => `${key}年`, key => `${key}年`, key => ({ year: key }));
  addGroups('quarter', byQuarterRows, byQuarterTasks, key => key, key => key.replace('-', ' / '), key => {
    const [year, quarter] = key.split('-');
    return { year, quarter };
  });
  addGroups('month', byMonthRows, byMonthTasks, key => key, key => key, key => ({ year: key.slice(0, 4), month: key }));
  addGroups('week', byWeekRows, byWeekTasks, key => key, key => key, key => {
    const task = byWeekTasks[key]?.[0];
    return {
      year: task ? String(task.year) : key.slice(0, 4),
      week: task ? String(task.week_number || '') : '',
      quarter: task ? quarterOf(task.end_date).split('-')[1] : '',
      taskId: task?.id || '',
      taskTitle: task?.title || key
    };
  });

  return periods.map(item => ({
    key: item.key,
    grain: item.grain,
    label: item.label,
    range: item.range,
    titleScope: reportTitleScopeText(item.report),
    scope: item.scope,
    year: item.report.dataset.year || '',
    quarter: item.report.dataset.quarter || '',
    month: item.report.dataset.month || '',
    week: item.report.dataset.week || '',
    taskId: item.report.dataset.taskId || '',
    report: item.report
  }));
}

function periodFileBase(item) {
  return `devtracker_workload_period_${safeName(item.key)}_latest`;
}

function periodMeta(item, allHref) {
  return {
    key: item.key,
    grain: item.grain,
    label: item.label,
    range: item.range,
    titleScope: item.titleScope,
    scope: item.scope,
    year: item.year,
    quarter: item.quarter,
    month: item.month,
    week: item.week,
    taskId: item.taskId,
    href: item.key === 'all' ? allHref : `${periodFileBase(item)}.html`,
    jsonHref: item.key === 'all' ? allHref.replace(/\.html$/i, '.json') : `${periodFileBase(item)}.json`
  };
}

function formulasHtml() {
  return `
    <section class="panel formulas">
      <div class="section-head"><h2>固定分析公式</h2></div>
      <ol>
        <li><strong>周期归属</strong>：先按任务结束日期，把每条工时归到对应的年、季度、月份和周。</li>
        <li><strong>工时合计</strong>：把当前范围内符合条件的每条填报工时相加。</li>
        <li><strong>岗位工时</strong>：分别把前端、后端、测试人员填写的工时相加。</li>
        <li><strong>岗位占比</strong>：用某个岗位的工时除以当前范围总工时，再换算成百分比。</li>
        <li><strong>需求数量</strong>：同一个周期内，需求名称和版本相同的内容视为同一个需求。</li>
        <li><strong>产品经理归属</strong>：优先使用填报时选择的第一个产品经理；没有填写时归入“不在上述”。</li>
        <li><strong>平均单条工时</strong>：用当前范围总工时除以填报记录数。</li>
        <li><strong>平均需求工时</strong>：用当前范围总工时除以需求数量。</li>
        <li><strong>关键词分类</strong>：按固定关键词识别需求特征；同一条需求可以命中多个关键词，关键词只用于分析特征，不用于相加还原总工时。</li>
      </ol>
    </section>
  `;
}

function stepsHtml(scope) {
  return `
    <section class="panel formulas">
      <div class="section-head"><h2>离线执行步骤</h2></div>
      <ol>
        <li>确认本地数据库已经导入需要分析的数据，且系统配置指向本地数据库。</li>
        <li>进入项目后端目录。</li>
        <li>需要看全部数据时，选择全量范围生成本地分析报告。</li>
        <li>需要看指定周期时，先选择年份、季度、月份或周，再生成对应周期的本地分析报告。</li>
        <li>分析脚本只读取数据，不会写入本地或生产数据。</li>
        <li>打开生成的网页报告查看图表和结论；保留同步生成的数据文件用于二次校验。</li>
      </ol>
      <p class="muted">本报告当前范围：${escapeHtml(scope)}。</p>
    </section>
  `;
}

function roleKeysFor(row) {
  return ROLE_KEYS.filter(role => Number(row[role] || 0) > 0);
}

function attrList(values) {
  return values.map(value => String(value).replace(/\s+/g, '-')).join(' ');
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function trendAxisLabel(row, options = {}) {
  const raw = String(row.name || '');
  const monthMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch && options.compactYearMonth) return `${monthMatch[1].slice(2)}${monthMatch[2]}`;
  if (monthMatch) return monthMatch[2];
  return raw.replace(/^\d{4}-/, '');
}

function lineChart(rows, title, options = {}) {
  const data = rows
    .filter(row => Number(row.total || 0) > 0)
    .slice()
    .sort((a, b) => String(a.sortKey || a.name).localeCompare(String(b.sortKey || b.name), 'zh-CN', { numeric: true }));
  const width = 900;
  const height = 310;
  const pad = { left: 54, right: 26, top: 28, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...data.flatMap(row => [row.total, row.frontend, row.backend, row.test].map(Number)), 1);
  const x = index => pad.left + (data.length === 1 ? plotW / 2 : (index * plotW) / (data.length - 1));
  const y = value => pad.top + plotH - (Number(value || 0) / max) * plotH;
  const series = [
    { key: 'total', label: '总计', color: '#111827', width: 3 },
    { key: 'frontend', label: '前端', color: ROLE_COLORS.frontend, width: 2 },
    { key: 'backend', label: '后端', color: ROLE_COLORS.backend, width: 2 },
    { key: 'test', label: '测试', color: ROLE_COLORS.test, width: 2 }
  ];
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  const grid = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const gy = pad.top + plotH - ratio * plotH;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}" class="grid-line"></line>
      <text x="${pad.left - 10}" y="${gy + 4}" class="axis-label" text-anchor="end">${fmt(max * ratio)}</text>`;
  }).join('');
  const polylines = series.map(item => {
    const points = data.map((row, index) => `${x(index)},${y(row[item.key])}`).join(' ');
    const circles = data.map((row, index) => `<circle cx="${x(index)}" cy="${y(row[item.key])}" r="${item.key === 'total' ? 3.5 : 2.5}" fill="${item.color}"><title>${escapeHtml(row.name)} ${item.label}: ${fmt(row[item.key])}h</title></circle>`).join('');
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="${item.width}" stroke-linejoin="round" stroke-linecap="round"></polyline>${circles}`;
  }).join('');
  const labels = data.map((row, index) => {
    if (index % labelStep !== 0 && index !== data.length - 1) return '';
    return `<text x="${x(index)}" y="${height - 22}" class="axis-label" text-anchor="middle">${escapeHtml(trendAxisLabel(row, options))}</text>`;
  }).join('');
  return `
    <section class="panel chart-panel">
      <div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="legend">${series.map(item => `<span><i class="dot" style="background:${item.color}"></i>${item.label}</span>`).join('')}</div>
      </div>
      <svg class="line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        ${grid}
        <line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + plotH}" y2="${pad.top + plotH}" class="axis-line"></line>
        ${polylines}
        ${labels}
      </svg>
      ${options.note ? `<p class="muted small-note">${escapeHtml(options.note)}</p>` : ''}
    </section>
  `;
}

function roleValueBarChart(row, title, options = {}) {
  const source = row || {};
  const data = [
    { key: 'total', label: '总计', color: '#111827', value: Number(source.total || 0) },
    { key: 'frontend', label: '前端', color: ROLE_COLORS.frontend, value: Number(source.frontend || 0) },
    { key: 'backend', label: '后端', color: ROLE_COLORS.backend, value: Number(source.backend || 0) },
    { key: 'test', label: '测试', color: ROLE_COLORS.test, value: Number(source.test || 0) }
  ];
  const max = Math.max(...data.map(item => item.value), 1);
  return `
    <section class="panel chart-panel">
      <div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="legend">${data.map(item => `<span><i class="dot" style="background:${item.color}"></i>${item.label}</span>`).join('')}</div>
      </div>
      <div class="role-bar-chart" aria-label="${escapeHtml(title)}">
        ${data.map(item => `
          <div class="role-bar-row">
            <div class="role-bar-label">${escapeHtml(item.label)}</div>
            <div class="role-bar-track">
              <div class="role-bar-fill" style="width:${Math.max(1, pct(item.value, max))}%; background:${item.color}"></div>
            </div>
            <div class="role-bar-value">${fmt(item.value)}h</div>
          </div>
        `).join('')}
      </div>
      ${source.name ? `<p class="muted small-note">${escapeHtml(source.name)}：${escapeHtml(options.note || '当前周不同数据维度工时对比。')}</p>` : ''}
    </section>
  `;
}

function trendChart(report, rows, title, options = {}) {
  if (report.dataset.periodGrain === 'week') {
    const weekTitle = options.weekTitle || (title.includes('月份') ? '当前周维度对比' : title.replace('趋势：总工时与三端变化', '周维度对比：总计与三端'));
    return roleValueBarChart(report.weeks[0] || rows[0], weekTitle, { note: '当前周不同数据维度工时对比。' });
  }
  const startYear = String(report.dataset.dateStart || '').slice(0, 4);
  const endYear = String(report.dataset.dateEnd || '').slice(0, 4);
  return lineChart(rows, title, {
    ...options,
    compactYearMonth: options.compactYearMonth || ((!report.dataset.periodGrain || report.dataset.periodGrain === 'all') && startYear && endYear && startYear !== endYear)
  });
}

function pieChart(rows, title, options = {}) {
  const limit = options.limit || 8;
  const positive = rows.filter(row => Number(row.total || 0) > 0);
  const top = positive.slice(0, limit);
  const rest = positive.slice(limit);
  const restTotal = rest.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const data = restTotal > 0 ? [...top, { name: '其他', total: round(restTotal) }] : top;
  const total = data.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const palette = ['#2563eb', '#16a34a', '#f97316', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#475569', '#0f766e'];
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = data.map((row, index) => {
    const value = Number(row.total || 0);
    const len = total ? (value / total) * c : 0;
    const dashOffset = -offset;
    offset += len;
    return `<circle cx="92" cy="92" r="${r}" fill="none" stroke="${palette[index % palette.length]}" stroke-width="34" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 92 92)"><title>${escapeHtml(row.name || row.combo)} ${fmt(value)}h / ${pct(value, total)}%</title></circle>`;
  }).join('');
  const legend = data.map((row, index) => `
    <div class="pie-legend-row">
      <span><i class="dot" style="background:${palette[index % palette.length]}"></i>${escapeHtml(row.name || row.combo)}</span>
      <strong>${fmt(row.total)}h · ${pct(row.total, total)}%</strong>
    </div>
  `).join('');
  return `
    <section class="panel chart-panel">
      <div class="section-head"><h2>${escapeHtml(title)}</h2></div>
      <div class="pie-layout">
        <svg class="pie-svg" viewBox="0 0 184 184" role="img" aria-label="${escapeHtml(title)}">
          <circle cx="92" cy="92" r="${r}" fill="none" stroke="#eef2f7" stroke-width="34"></circle>
          ${circles}
          <text x="92" y="88" text-anchor="middle" class="pie-total">${fmt(total)}</text>
          <text x="92" y="108" text-anchor="middle" class="axis-label">小时</text>
        </svg>
        <div class="pie-legend">${legend || '<p class="muted">无数据</p>'}</div>
      </div>
    </section>
  `;
}

function insightCard({ tab, filterTab, filterValue, title, value, detail, tone = '' }) {
  return `
    <button type="button" class="insight-card ${tone}" data-jump-tab="${escapeHtml(tab)}" ${filterTab ? `data-filter-tab="${escapeHtml(filterTab)}"` : ''} ${filterValue ? `data-filter-value="${escapeHtml(filterValue)}"` : ''}>
      <span class="label">${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span class="sub">${escapeHtml(detail)}</span>
    </button>
  `;
}

function chips(rows, tab, labelProp = 'name', limit = 18) {
  const visible = rows.slice(0, limit);
  return `
    <div class="filter-row" data-filter-group="${escapeHtml(tab)}">
      <button type="button" class="chip active" data-filter-tab="${escapeHtml(tab)}" data-filter-value="__all">全部</button>
      ${visible.map(row => `<button type="button" class="chip" data-filter-tab="${escapeHtml(tab)}" data-filter-value="${escapeHtml(row[labelProp])}">${escapeHtml(row[labelProp])}</button>`).join('')}
    </div>
  `;
}

function renderHtml(report, options = {}) {
  const requirements = report.requirements || report.topRequirements || [];
  const detailRequirements = report.requirementDetails || requirements;
  const topStaff = report.staff.slice(0, 12);
  const topPms = report.productManagers.slice(0, 12);
  const topVersions = report.versions.slice(0, 16);
  const topRequirements = requirements.slice(0, 20);
  const topKeywords = report.keywords.slice(0, 12);
  const roleCombos = report.roleCombos.slice(0, 12);
  const topWeek = report.topWeeks[0];
  const topPm = report.productManagers[0];
  const topStaffRow = report.staff[0];
  const topReq = requirements[0];
  const topKeyword = report.keywords[0];
  const qualityRows = [
    ['emptyPm', '空产品经理数组（页面归不在上述）', report.dataQuality.emptyPm],
    ['explicitDefaultPm', '显式填写不在上述', report.dataQuality.explicitDefaultPm],
    ['missingVersion', '未填版本', report.dataQuality.missingVersion],
    ['zeroHours', '0 或负工时', report.dataQuality.zeroHours],
    ['inactiveRecords', '非 active 记录', report.dataQuality.inactiveRecords],
    ['editedRecords', '有编辑次数记录', report.dataQuality.editedRecords],
    ['resubmittedRecords', '多次提交记录', report.dataQuality.resubmittedRecords]
  ];
  const generatedAt = new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false });

  const pmSummaryTable = table(
    ['产品经理', '总工时', '占比', '前端', '后端', '测试', '记录数', '需求数'],
    report.productManagers,
    row => `<tr class="clickable-row" data-jump-tab="pm" data-filter-tab="pm" data-filter-value="${escapeHtml(row.name)}">
      <td>${escapeHtml(row.name)}</td><td class="num strong">${fmt(row.total)}</td><td class="num">${row.share}%</td>
      ${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}
      <td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.requirementCount)}</td>
    </tr>`
  );

  const pmDetailRows = detailRequirements.map(row => `<tr class="pm-detail-row" data-pm="${escapeHtml(row.pm)}">
    <td>${escapeHtml(row.pm)}</td><td class="text-left demand-cell">${escapeHtml(row.title)}</td><td>${escapeHtml(row.version)}</td><td class="period-cell">${escapeHtml(row.task)}</td><td class="combo-cell">${escapeHtml(row.roleCombo)}</td>
    <td class="num strong">${fmt(row.total)}</td>${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}
    <td class="num">${fmt(row.staffCount)}</td>
  </tr>`).join('');

  const staffSummaryTable = table(
    ['人员', '总工时', '占比', '记录数', '覆盖周期', '覆盖需求'],
    report.staff,
    row => `<tr class="clickable-row" data-jump-tab="staff" data-filter-tab="staff" data-filter-value="${escapeHtml(row.name)}">
      <td>${escapeHtml(row.name)}</td><td class="num strong">${fmt(row.total)}</td><td class="num">${row.share}%</td>
      <td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.taskCount)}</td><td class="num">${fmt(row.requirementCount)}</td>
    </tr>`
  );

  const staffRecordRows = report.records.map(row => `<tr class="staff-detail-row" data-staff="${escapeHtml(row.staffLabel)}" data-role="${escapeHtml(row.role)}">
    <td>${escapeHtml(row.staffLabel)}</td><td>${escapeHtml(row.roleText)}</td><td class="period-cell">${escapeHtml(row.period)}</td><td>${escapeHtml(row.pm)}</td>
    <td class="text-left demand-cell">${escapeHtml(row.title)}</td><td>${escapeHtml(row.version)}</td><td class="num strong">${fmt(row.hours)}</td>
  </tr>`).join('');

  const requirementRows = detailRequirements.map(row => {
    const roleKeys = attrList(roleKeysFor(row));
    return `<tr class="requirement-row" data-role-keys="${escapeHtml(roleKeys)}" data-pm="${escapeHtml(row.pm)}">
      <td class="text-left demand-cell">${escapeHtml(row.title)}</td><td>${escapeHtml(row.version)}</td><td class="period-cell">${escapeHtml(row.task)}</td><td>${escapeHtml(row.pm)}</td><td class="combo-cell">${escapeHtml(row.roleCombo)}</td>
      <td class="num strong">${fmt(row.total)}</td>${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}
      <td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.staffCount)}</td>
    </tr>`;
  }).join('');

  const versionTable = table(
    [
      { label: '版本', className: 'version-code-col' },
      { label: '版本名称', className: 'version-title-col' },
      '总工时',
      '占比',
      '前端',
      '后端',
      '测试',
      '记录数',
      '需求数'
    ],
    report.versions,
    row => `<tr>
      <td class="version-code-cell">${escapeHtml(row.name)}</td><td class="text-left version-title-cell">${escapeHtml(row.versionName || '——')}</td><td class="num strong">${fmt(row.total)}</td><td class="num">${row.share}%</td>
      ${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}
      <td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.requirementCount)}</td>
    </tr>`,
    { className: 'version-table' }
  );

  const keywordTable = table(
    ['关键词', '命中工时', '占总工时', '前端', '后端', '测试', '记录数', '需求数'],
    report.keywords,
    row => `<tr>
      <td>${escapeHtml(row.name)}</td><td class="num strong">${fmt(row.total)}</td><td class="num">${row.share}%</td>
      ${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}
      <td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.requirementCount)}</td>
    </tr>`
  );

  const qualityTable = table(
    ['检查项', '记录数', '工时', '占总工时'],
    qualityRows,
    ([key, name, item]) => `<tr class="clickable-row" data-jump-tab="quality" data-filter-tab="quality" data-filter-value="${escapeHtml(key)}">
      <td>${escapeHtml(name)}</td><td class="num">${fmt(item.count)}</td><td class="num strong">${fmt(item.hours)}</td><td class="num">${item.share}%</td>
    </tr>`
  );

  const qualityRecordRows = report.records
    .map(row => {
      const issueKeys = [];
      const issueNames = [];
      if (row.emptyProductManager) { issueKeys.push('emptyPm'); issueNames.push('空产品经理'); }
      if (row.missingVersion) { issueKeys.push('missingVersion'); issueNames.push('未填版本'); }
      if (Number(row.hours || 0) <= 0) { issueKeys.push('zeroHours'); issueNames.push('0 或负工时'); }
      if (!issueKeys.length) return '';
      return `<tr class="quality-detail-row" data-quality="${escapeHtml(issueKeys.join(' '))}">
        <td>${escapeHtml(issueNames.join('、'))}</td><td class="period-cell">${escapeHtml(row.period)}</td><td>${escapeHtml(row.pm)}</td><td>${escapeHtml(row.staffLabel)}</td>
        <td class="text-left demand-cell">${escapeHtml(row.title)}</td><td>${escapeHtml(row.version)}</td><td class="num strong">${fmt(row.hours)}</td>
      </tr>`;
    })
    .filter(Boolean)
    .join('');

  const rolePieRows = ROLE_KEYS.map(role => ({ name: ROLE_TEXT[role], total: report.summary[role] }));
  const titleScopeText = reportTitleScopeText(report);
  const referenceNoticeLines = [
    '当前数据统计依据，为人工每周填写数据所统计，存在一定的统一性偏差，工时填写预估性为主等因素，因此数据仅供参考；详细可查看~',
    'AI Agent需求对应开发测试工时在AI组占相当一部分未被统计进当前数据分析；'
  ];
  const referenceTip = '1，需求存在如：工单需求，有多个产品负责，单个开发负责开发，单个测试负责测试，最后填写工时只选择了其中一个产品人员，因此存在偏差；\n2，工时都是人工自己预估，存在不绝对准确的情况，因此不具备绝对工时参考，仅做相对数据参考；';

  const periodReports = Array.isArray(options.periodReports) ? options.periodReports : null;
  const periodSwitcher = periodReports ? `
    <div class="period-switcher" aria-label="周期切换">
      <label>
        <span>粒度</span>
        <select data-period-grain disabled>
          <option value="all">全部</option>
          <option value="year">年度</option>
          <option value="quarter">季度</option>
          <option value="month">月份</option>
          <option value="week">周</option>
        </select>
      </label>
      <label>
        <span>周期</span>
        <select data-period-key disabled>
          <option value="">数据加载中...</option>
        </select>
      </label>
    </div>
  ` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevTracker 工时数据分析报告</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel: #ffffff;
      --line: #d8e0eb;
      --text: #172033;
      --muted: #667085;
      --fe: ${ROLE_COLORS.frontend};
      --be: ${ROLE_COLORS.backend};
      --qa: ${ROLE_COLORS.test};
      --accent: #0f766e;
      --accent-2: #7c3aed;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.55;
    }
    .report-loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(248, 250, 252, 0.86);
      backdrop-filter: blur(2px);
    }
    body.report-ready .report-loading-overlay { display: none; }
    .report-loading-box {
      display: grid;
      justify-items: center;
      gap: 12px;
      min-width: 180px;
      padding: 22px 26px;
      border: 1px solid #d8e0eb;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
      color: #111827;
      font-weight: 700;
    }
    .report-spinner {
      width: 42px;
      height: 42px;
      border: 4px solid #dbeafe;
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: reportSpin 0.9s linear infinite;
    }
    @keyframes reportSpin {
      to { transform: rotate(360deg); }
    }
    header {
      padding: 16px 28px 14px;
      background: #111827;
      color: #fff;
    }
    .report-header-row { display: flex; justify-content: space-between; gap: 20px; align-items: center; }
    .report-header-title { flex: 1; min-width: 0; }
    .period-switcher { display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; justify-content: flex-end; flex: 0 0 auto; }
    .period-switcher label { display: flex; gap: 6px; align-items: center; color: #d1d5db; font-size: 12px; white-space: nowrap; }
    .period-switcher select {
      height: 30px;
      min-width: 108px;
      border: 1px solid #475569;
      border-radius: 7px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font: inherit;
    }
    header h1 { margin: 0; font-size: 24px; line-height: 1.25; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .report-note { margin: 4px 0 0; color: #cbd5e1; font-size: 12px; line-height: 1.35; }
    .report-note-line { display: grid; grid-template-columns: auto 1fr; column-gap: 0; align-items: baseline; }
    .report-note-prefix { white-space: pre; }
    .report-note-spacer { visibility: hidden; }
    .notice-help {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      margin-left: 4px;
      border: 1px solid #93c5fd;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.14);
      color: #bfdbfe;
      font-size: 11px;
      line-height: 1;
      cursor: help;
      vertical-align: text-bottom;
    }
    .notice-help::after {
      content: attr(data-tip);
      position: absolute;
      left: 50%;
      top: calc(100% + 8px);
      z-index: 30;
      width: min(560px, calc(100vw - 56px));
      padding: 10px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      color: #111827;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
      font-size: 12px;
      line-height: 1.6;
      text-align: left;
      white-space: pre-line;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 4px);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .notice-help:hover::after,
    .notice-help:focus-visible::after {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    main { padding: 20px 28px 48px; max-width: 1500px; margin: 0 auto; }
    .tabs {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 12px 0;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .tab-btn, .chip {
      border: 1px solid var(--line);
      background: #fff;
      color: #344054;
      border-radius: 7px;
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
    }
    .tab-btn.active, .chip.active { background: #111827; border-color: #111827; color: #fff; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .dimension-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
    }
    .card { padding: 18px; text-align: left; }
    button.card { cursor: pointer; }
    button.card:hover, .insight-card:hover, .clickable-row:hover { border-color: #9db2ce; background: #f8fbff; }
    .card .label { color: var(--muted); font-size: 13px; }
    .card .value { margin-top: 8px; font-size: 30px; font-weight: 800; }
    .card .sub { margin-top: 4px; color: var(--muted); font-size: 13px; }
    .panel { padding: 18px; margin-bottom: 18px; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    h2 { margin: 0; font-size: 18px; }
    h3 { margin: 18px 0 10px; font-size: 15px; }
    .muted { color: var(--muted); }
    .summary { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px; align-items: stretch; }
    .chart-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr); gap: 18px; align-items: stretch; }
    .insight-card {
      width: 100%;
      text-align: left;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 15px;
      min-height: 122px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      cursor: pointer;
      font: inherit;
    }
    .insight-card strong { font-size: 22px; }
    .insight-card .sub { color: var(--muted); font-size: 13px; }
    .filter-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .filter-status { color: var(--muted); font-size: 13px; }
    .clickable-row { cursor: pointer; }
    .finding-list { margin: 0; padding-left: 20px; }
    .finding-list li { margin: 8px 0; }
    .legend { display: flex; gap: 14px; color: var(--muted); font-size: 13px; white-space: nowrap; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
    .dot.fe, .seg.fe, .composition-track .fe { background: var(--fe); }
    .dot.be, .seg.be, .composition-track .be { background: var(--be); }
    .dot.qa, .seg.qa, .composition-track .qa { background: var(--qa); }
    .fe-text { color: var(--fe); }
    .be-text { color: var(--be); }
    .qa-text { color: var(--qa); }
    .metric-value { color: var(--accent-2); font-weight: 800; }
    .metric-fe { color: var(--fe); font-weight: 800; }
    .metric-be { color: var(--be); font-weight: 800; }
    .metric-qa { color: var(--qa); font-weight: 800; }
    .bar-list { display: grid; gap: 12px; }
    .bar-row { display: grid; grid-template-columns: minmax(180px, 270px) minmax(260px, 1fr) 88px; align-items: center; column-gap: 12px; row-gap: 4px; min-height: 34px; }
    .bar-row.simple { grid-template-columns: minmax(190px, 300px) minmax(260px, 1fr) 88px; }
    .bar-row.simple.has-meta { grid-template-columns: minmax(150px, 240px) minmax(180px, 300px) minmax(260px, 1fr) 88px; }
    .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #344054; font-size: 13px; }
    .bar-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475467; font-size: 13px; }
    .bar-track { height: 20px; background: #eef2f7; border: 1px solid #e4e9f2; border-radius: 4px; overflow: hidden; }
    .bar-stack { height: 100%; display: flex; min-width: 2px; overflow: hidden; border-radius: 4px; }
    .seg { display: block; height: 100%; min-width: 0; overflow: hidden; }
    .bar-single { height: 100%; background: var(--accent); border-radius: 4px; min-width: 2px; }
    .bar-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; }
    .segment-breakdown { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 4px 7px; align-items: center; color: #344054; font-size: 11px; line-height: 1.2; }
    .segment-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 6px; border-radius: 5px; border: 1px solid #d8e0eb; background: #f8fafc; white-space: nowrap; }
    .segment-pill.fe { border-color: rgba(37, 99, 235, 0.25); background: rgba(37, 99, 235, 0.08); color: #1d4ed8; }
    .segment-pill.be { border-color: rgba(22, 163, 74, 0.25); background: rgba(22, 163, 74, 0.08); color: #15803d; }
    .segment-pill.qa { border-color: rgba(249, 115, 22, 0.28); background: rgba(249, 115, 22, 0.1); color: #c2410c; }
    .line-svg { display: block; width: 100%; height: auto; min-height: 250px; }
    .role-bar-chart { display: grid; gap: 16px; padding: 20px 6px 8px; }
    .role-bar-row { display: grid; grid-template-columns: 54px minmax(180px, 1fr) 82px; gap: 12px; align-items: center; }
    .role-bar-label { color: #344054; font-size: 13px; text-align: right; }
    .role-bar-track { height: 28px; background: #eef2f7; border: 1px solid #e4e9f2; border-radius: 5px; overflow: hidden; }
    .role-bar-fill { height: 100%; min-width: 2px; border-radius: 5px; }
    .role-bar-value { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 13px; }
    .grid-line { stroke: #e8edf5; stroke-width: 1; }
    .axis-line { stroke: #b9c4d3; stroke-width: 1; }
    .axis-label { fill: #667085; font-size: 12px; }
    .pie-layout { display: grid; grid-template-columns: 210px 1fr; gap: 18px; align-items: center; }
    .pie-svg { width: 210px; height: 210px; }
    .pie-total { fill: #111827; font-size: 20px; font-weight: 800; }
    .pie-legend { display: grid; gap: 8px; }
    .pie-legend-row { display: flex; justify-content: space-between; gap: 14px; font-size: 13px; }
    .composition { display: grid; gap: 12px; }
    .composition-top { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
    .composition-track { height: 10px; background: #eef2f7; border-radius: 999px; overflow: hidden; }
    .composition-track span { display: block; height: 100%; border-radius: 999px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; font-size: 13px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e8edf5; text-align: center; vertical-align: middle; }
    th { background: #f8fafc; color: #475467; font-weight: 700; position: sticky; top: 0; user-select: none; }
    .sortable-table th { cursor: pointer; }
    .sortable-table th::after { content: "↕"; margin-left: 5px; color: #98a2b3; font-size: 11px; }
    .sortable-table th.sort-asc::after { content: "↑"; color: #111827; }
    .sortable-table th.sort-desc::after { content: "↓"; color: #111827; }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .text-left { text-align: left !important; }
    .demand-col, .demand-cell { min-width: 280px; }
    .demand-cell { white-space: normal; line-height: 1.45; }
    .period-col, .period-cell { min-width: 230px; white-space: nowrap; }
    .combo-col, .combo-cell { min-width: 94px; white-space: nowrap; }
    .version-code-col, .version-code-cell { width: 108px; max-width: 118px; white-space: nowrap; }
    .version-title-col, .version-title-cell { min-width: 380px; }
    .pm-detail-table .demand-cell,
    .requirement-detail-table .demand-cell,
    .staff-record-table .demand-cell,
    .quality-record-table .demand-cell { min-width: 320px; }
    .strong { font-weight: 800; }
    .small-note { margin: 10px 0 0; font-size: 12px; }
    .hide { display: none !important; }
    code {
      padding: 2px 5px;
      background: #eef2f7;
      border: 1px solid #dde5ef;
      border-radius: 4px;
      color: #0f172a;
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
    }
    .formulas ol { margin: 0; padding-left: 22px; }
    .formulas li { margin: 8px 0; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .dimension-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary { grid-template-columns: 1fr; }
      .chart-grid { grid-template-columns: 1fr; }
      .pie-layout { grid-template-columns: 1fr; }
      .bar-row, .bar-row.simple, .bar-row.simple.has-meta { grid-template-columns: minmax(100px, 180px) 1fr 72px; }
      .bar-meta, .segment-breakdown { grid-column: 1 / -1; }
      .report-header-row { display: block; }
      header h1 { white-space: normal; }
      .period-switcher { justify-content: flex-start; flex-wrap: wrap; margin-top: 10px; }
      main { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="report-loading-overlay" id="report-loading-overlay" role="status" aria-live="polite">
    <div class="report-loading-box">
      <div class="report-spinner" aria-hidden="true"></div>
      <div>正在加载中，请稍后...</div>
    </div>
  </div>
  <header>
    <div class="report-header-row">
      <div class="report-header-title">
    <h1>DevTracker 工时数据分析报告 | ${escapeHtml(titleScopeText)}</h1>
    <div class="report-note" aria-label="数据统计注意事项">
      <div class="report-note-line"><span class="report-note-prefix">注意：</span><span>1，${escapeHtml(referenceNoticeLines[0])}<button type="button" class="notice-help" aria-label="查看数据参考说明" data-tip="${escapeHtml(referenceTip)}">?</button></span></div>
      <div class="report-note-line"><span class="report-note-prefix report-note-spacer">注意：</span><span>2，${escapeHtml(referenceNoticeLines[1])}</span></div>
    </div>
      </div>
      ${periodSwitcher}
    </div>
  </header>
  <main id="report-body">
    <nav class="tabs" aria-label="分析维度页签">
      <button type="button" class="tab-btn active" data-open-tab="overview">总览</button>
      <button type="button" class="tab-btn" data-open-tab="trend">周期趋势</button>
      <button type="button" class="tab-btn" data-open-tab="pm">产品经理归属</button>
      <button type="button" class="tab-btn" data-open-tab="staff">人员投入</button>
      <button type="button" class="tab-btn" data-open-tab="requirements">需求明细</button>
      <button type="button" class="tab-btn" data-open-tab="versions">版本</button>
      <button type="button" class="tab-btn" data-open-tab="keywords">关键词</button>
      <button type="button" class="tab-btn" data-open-tab="quality">数据质量</button>
      <button type="button" class="tab-btn" data-open-tab="formula">公式步骤</button>
    </nav>

    <section class="tab-panel active" id="tab-overview">
      <section class="grid">
        <button type="button" class="card" data-jump-tab="trend"><div class="label">总工时</div><div class="value">${fmt(report.summary.total)}</div><div class="sub">${fmt(report.dataset.recordCount)} 条记录 / ${fmt(report.dataset.requirementCount)} 个需求</div></button>
        <button type="button" class="card" data-jump-tab="requirements" data-filter-tab="requirements" data-filter-value="frontend"><div class="label">前端总工时</div><div class="value fe-text">${fmt(report.summary.frontend)}</div><div class="sub">${report.summary.frontendShare}% · 点击看前端相关需求</div></button>
        <button type="button" class="card" data-jump-tab="requirements" data-filter-tab="requirements" data-filter-value="backend"><div class="label">后端总工时</div><div class="value be-text">${fmt(report.summary.backend)}</div><div class="sub">${report.summary.backendShare}% · 点击看后端相关需求</div></button>
        <button type="button" class="card" data-jump-tab="requirements" data-filter-tab="requirements" data-filter-value="test"><div class="label">测试总工时</div><div class="value qa-text">${fmt(report.summary.test)}</div><div class="sub">${report.summary.testShare}% · 点击看测试相关需求</div></button>
      </section>
      <section class="dimension-grid">
        ${insightCard({ tab: 'trend', title: '周期峰值', value: `${fmt(topWeek?.total || 0)}h`, detail: topWeek?.name || '-', filterTab: '', filterValue: '' })}
        ${insightCard({ tab: 'pm', filterTab: 'pm', filterValue: topPm?.name, title: '产品经理归属最高', value: topPm?.name || '-', detail: `${fmt(topPm?.total || 0)}h · 前端 ${fmt(topPm?.frontend || 0)} / 后端 ${fmt(topPm?.backend || 0)} / 测试 ${fmt(topPm?.test || 0)}` })}
        ${insightCard({ tab: 'staff', filterTab: 'staff', filterValue: topStaffRow?.name, title: '人员投入最高', value: topStaffRow?.name || '-', detail: `${fmt(topStaffRow?.total || 0)}h · ${fmt(topStaffRow?.records || 0)} 条记录` })}
        ${insightCard({ tab: 'requirements', title: '单需求最高投入', value: `${fmt(topReq?.total || 0)}h`, detail: topReq?.title || '-' })}
        ${insightCard({ tab: 'keywords', title: '关键词命中最高', value: topKeyword?.name || '-', detail: `${fmt(topKeyword?.total || 0)}h · ${topKeyword?.share || 0}%` })}
        ${insightCard({ tab: 'quality', filterTab: 'quality', filterValue: 'missingVersion', title: '数据质量重点', value: `${fmt(report.dataQuality.missingVersion.hours)}h`, detail: `未填版本 ${fmt(report.dataQuality.missingVersion.count)} 条` })}
        ${insightCard({ tab: 'pm', filterTab: 'pm', filterValue: DEFAULT_PM, title: '不在上述归属', value: `${fmt((report.productManagers.find(row => row.name === DEFAULT_PM) || {}).total)}h`, detail: '未填写产品经理时按页面口径归入不在上述' })}
        ${insightCard({ tab: 'requirements', title: '协作形态最高', value: roleCombos[0]?.combo || '-', detail: `${fmt(roleCombos[0]?.total || 0)}h · ${fmt(roleCombos[0]?.requirementCount || 0)} 个需求` })}
      </section>
      <section class="chart-grid">
        ${trendChart(report, report.months.length > 1 ? report.months : report.weeks, '主页趋势：总工时与三端变化')}
        ${pieChart(rolePieRows, '主页构成：三端工时占比')}
      </section>
      <section class="summary">
        <section class="panel">
          <div class="section-head"><h2>总览解读</h2></div>
          <ul class="finding-list">
            <li>当前范围共有 <strong class="metric-value">${fmt(report.dataset.recordCount)}</strong> 条填报记录、<strong class="metric-value">${fmt(report.dataset.requirementCount)}</strong> 个需求粒度、<strong class="metric-value">${fmt(report.dataset.taskCount)}</strong> 个采集周期。</li>
            <li>后端投入最高：<strong class="metric-be">${fmt(report.summary.backend)}h</strong>，占 <strong class="metric-be">${report.summary.backendShare}%</strong>；测试 <strong class="metric-qa">${fmt(report.summary.test)}h</strong>，占 <strong class="metric-qa">${report.summary.testShare}%</strong>；前端 <strong class="metric-fe">${fmt(report.summary.frontend)}h</strong>，占 <strong class="metric-fe">${report.summary.frontendShare}%</strong>。</li>
            <li>平均每条记录 <strong class="metric-value">${fmt(report.summary.avgRecordHours)}h</strong>，平均每个需求粒度 <strong class="metric-value">${fmt(report.summary.avgRequirementHours)}h</strong>。</li>
            <li>点击上方卡片会进入对应页签，并按卡片维度自动筛选明细。</li>
          </ul>
        </section>
        ${roleComposition(report.summary)}
      </section>
    </section>

    <section class="tab-panel" id="tab-trend">
      <section class="chart-grid">
        ${trendChart(report, report.months, '月份折线趋势', { note: '折线同时展示总计、前端、后端、测试；季度报告中月线更适合看结构变化。' })}
        ${pieChart(report.quarters, '季度总工时占比')}
      </section>
      ${stackedBarChart(report.weeks, '按周期堆叠趋势：三端工时')}
      ${table(
        ['周期', '总工时', '前端', '后端', '测试', '记录数', '需求数', '前端占比', '后端占比', '测试占比'],
        report.weeks,
        row => `<tr><td>${escapeHtml(row.name)}</td><td class="num strong">${fmt(row.total)}</td>${roleCell(row, 'frontend')}${roleCell(row, 'backend')}${roleCell(row, 'test')}<td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.requirementCount)}</td><td class="num">${row.frontendShare}%</td><td class="num">${row.backendShare}%</td><td class="num">${row.testShare}%</td></tr>`
      )}
    </section>

    <section class="tab-panel" id="tab-pm">
      <section class="chart-grid">
        ${stackedBarChart(topPms, '产品经理归属 Top：三端拆分（未包含AI_Agent需求开发测试工时）', { limit: 12 })}
        ${pieChart(report.productManagers, '产品经理工时占比', { limit: 8 })}
      </section>
      ${pmSummaryTable}
      <section class="panel">
        <div class="section-head">
          <h2>产品经理下需求三端明细</h2>
          <span class="filter-status" data-status-for="pm">当前：全部</span>
        </div>
        ${chips(report.productManagers, 'pm', 'name', 24)}
        <div class="table-wrap">
          <table class="sortable-table pm-detail-table">
            <thead><tr>${tableHeaders(['产品经理', { label: '需求', className: 'demand-col' }, '版本', { label: '周期', className: 'period-col' }, { label: '角色组合', className: 'combo-col' }, '总工时', '前端', '后端', '测试', '人数'])}</tr></thead>
            <tbody>${pmDetailRows}</tbody>
          </table>
        </div>
      </section>
    </section>

    <section class="tab-panel" id="tab-staff">
      <section class="chart-grid">
        ${simpleBarChart(topStaff, '人员投入 Top 12', { limit: 12 })}
        ${pieChart(report.staff, '人员工时占比', { limit: 10 })}
      </section>
      ${staffSummaryTable}
      <section class="panel">
        <div class="section-head">
          <h2>人员填报记录明细</h2>
          <span class="filter-status" data-status-for="staff">当前：全部</span>
        </div>
        ${chips(report.staff, 'staff', 'name', 24)}
        <div class="table-wrap">
          <table class="sortable-table staff-record-table">
            <thead><tr>${tableHeaders(['人员', '角色', { label: '周期', className: 'period-col' }, '产品经理', { label: '需求', className: 'demand-col' }, '版本', '工时'])}</tr></thead>
            <tbody>${staffRecordRows}</tbody>
          </table>
        </div>
      </section>
    </section>

    <section class="tab-panel" id="tab-requirements">
      <section class="chart-grid">
        ${simpleBarChart(topRequirements, '需求投入 Top 20', {
          limit: 20,
          tip: '统计的是需求在单个填写周期内，即某一周内的工时占用总量排行；存在一个需求三端協作总计时间较大，或者单个需求在不同周期都出现，也在列表排行，这是正常的；'
        })}
        ${pieChart(roleCombos.map(row => ({ name: row.combo, total: row.total })), '需求协作形态占比', { limit: 8 })}
      </section>
      <section class="panel">
        <div class="section-head">
          <h2>需求明细：总工时与三端拆分</h2>
          <span class="filter-status" data-status-for="requirements">当前：全部</span>
        </div>
        <div class="filter-row" data-filter-group="requirements">
          <button type="button" class="chip active" data-filter-tab="requirements" data-filter-value="__all">全部</button>
          <button type="button" class="chip" data-filter-tab="requirements" data-filter-value="frontend">包含前端</button>
          <button type="button" class="chip" data-filter-tab="requirements" data-filter-value="backend">包含后端</button>
          <button type="button" class="chip" data-filter-tab="requirements" data-filter-value="test">包含测试</button>
        </div>
        <div class="table-wrap">
          <table class="sortable-table requirement-detail-table">
            <thead><tr>${tableHeaders([{ label: '需求', className: 'demand-col' }, '版本', { label: '周期', className: 'period-col' }, '产品经理', { label: '角色组合', className: 'combo-col' }, '总工时', '前端', '后端', '测试', '记录数', '人数'])}</tr></thead>
            <tbody>${requirementRows}</tbody>
          </table>
        </div>
      </section>
    </section>

    <section class="tab-panel" id="tab-versions">
      <section class="chart-grid">
        ${simpleBarChart(topVersions, '版本投入 Top 16', { limit: 16, metaField: 'versionName' })}
        ${pieChart(report.versions, '版本工时占比', { limit: 10 })}
      </section>
      ${versionTable}
    </section>

    <section class="tab-panel" id="tab-keywords">
      <section class="chart-grid">
        ${stackedBarChart(topKeywords, '关键词特征：三端拆分', { limit: 12 })}
        ${pieChart(report.keywords, '关键词命中工时占比', { limit: 10 })}
      </section>
      <section class="panel">
        <p class="muted">关键词分类用固定正则命中需求标题和版本；同一需求可能命中多个关键词，所以关键词工时用于识别特征，不用于相加还原总工时。</p>
      </section>
      ${keywordTable}
    </section>

    <section class="tab-panel" id="tab-quality">
      ${qualityTable}
      <section class="panel">
        <div class="section-head">
          <h2>质量问题相关记录</h2>
          <span class="filter-status" data-status-for="quality">当前：全部</span>
        </div>
        <div class="filter-row" data-filter-group="quality">
          <button type="button" class="chip active" data-filter-tab="quality" data-filter-value="__all">全部</button>
          <button type="button" class="chip" data-filter-tab="quality" data-filter-value="emptyPm">空产品经理</button>
          <button type="button" class="chip" data-filter-tab="quality" data-filter-value="missingVersion">未填版本</button>
          <button type="button" class="chip" data-filter-tab="quality" data-filter-value="zeroHours">0 或负工时</button>
        </div>
        <div class="table-wrap">
          <table class="sortable-table quality-record-table">
            <thead><tr>${tableHeaders(['问题', { label: '周期', className: 'period-col' }, '产品经理归属', '人员', { label: '需求', className: 'demand-col' }, '版本', '工时'])}</tr></thead>
            <tbody>${qualityRecordRows || '<tr><td colspan="7" class="muted">无质量问题记录</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </section>

    <section class="tab-panel" id="tab-formula">
      ${formulasHtml()}
      ${stepsHtml(report.dataset.scope)}
    </section>
  </main>
  <script>
    window.__WORKLOAD_REPORT__ = ${scriptJson({
      generatedAt: report.generatedAt,
      dataset: report.dataset,
      summary: report.summary
    })};
    window.__PERIOD_REPORTS__ = ${scriptJson(periodReports || [])};

    function openTab(tab) {
      const tabButtons = [...document.querySelectorAll('[data-open-tab]')];
      const panels = [...document.querySelectorAll('.tab-panel')];
      tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.openTab === tab));
      panels.forEach(panel => panel.classList.toggle('active', panel.id === 'tab-' + tab));
      window.location.hash = tab;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function reportByKey(key) {
      return (window.__PERIOD_REPORTS__ || []).find(item => item.key === key);
    }

    function hideReportLoading() {
      document.body.classList.add('report-ready');
    }

    function currentPeriodKey() {
      return window.__WORKLOAD_REPORT__?.dataset?.periodKey || 'all';
    }

    function reportHref(item) {
      if (!item || !item.href) return '';
      const url = new URL(item.href, window.location.href);
      url.search = '';
      url.hash = window.location.hash || '';
      return url.href;
    }

    function reportByQuery() {
      const reports = window.__PERIOD_REPORTS__ || [];
      const params = new URLSearchParams(window.location.search);
      const period = params.get('period');
      if (period && reportByKey(period)) return period;
      const year = params.get('year');
      const quarter = params.get('quarter');
      const month = params.get('month');
      const week = params.get('week');
      const taskId = params.get('taskId');
      if (taskId && taskId !== 'all') {
        const byTask = reports.find(item =>
          item.taskId === taskId
          && (!year || item.year === year)
          && (!quarter || item.quarter === quarter)
        );
        if (byTask) return byTask.key;
      }
      if (week) {
        const found = reports.find(item => item.grain === 'week' && item.week === week && (!year || item.year === year));
        if (found) return found.key;
      }
      if (month) {
        const value = month.includes('-') ? month : ((year || '') + '-' + String(month).padStart(2, '0'));
        const found = reports.find(item => item.grain === 'month' && item.month === value);
        if (found) return found.key;
      }
      if (year && quarter) {
        const found = reports.find(item => item.grain === 'quarter' && item.year === year && item.quarter === quarter);
        if (found) return found.key;
      }
      if (year) {
        const found = reports.find(item => item.grain === 'year' && item.year === year);
        if (found) return found.key;
      }
      return currentPeriodKey() || reports[0]?.key || 'all';
    }

    function populatePeriodOptions(grain, selectedKey) {
      const select = document.querySelector('[data-period-key]');
      if (!select) return;
      const reports = (window.__PERIOD_REPORTS__ || []).filter(item => item.grain === grain);
      select.innerHTML = reports.map(item => '<option value="' + item.key + '">' + item.label + '</option>').join('');
      if (reports.some(item => item.key === selectedKey)) select.value = selectedKey;
    }

    function setPeriod(key, updateUrl = false) {
      const item = reportByKey(key);
      if (!item) return;
      if (item.key !== currentPeriodKey() && item.href) {
        const href = reportHref(item);
        if (href) {
          if (updateUrl) window.location.assign(href);
          else window.location.replace(href);
          return false;
        }
      }
      const title = document.querySelector('header h1');
      if (title) title.textContent = 'DevTracker 工时数据分析报告 | ' + (item.titleScope || item.range);
      const grainSelect = document.querySelector('[data-period-grain]');
      if (grainSelect) grainSelect.value = item.grain;
      populatePeriodOptions(item.grain, item.key);
      const periodSelect = document.querySelector('[data-period-key]');
      if (periodSelect) periodSelect.value = item.key;
      if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set('period', item.key);
        window.history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString() + window.location.hash);
      }
      const initialTab = (window.location.hash || '').replace('#', '') || 'overview';
      if (document.getElementById('tab-' + initialTab)) openTab(initialTab);
      return true;
    }

    function initPeriodSwitcher() {
      const reports = window.__PERIOD_REPORTS__ || [];
      if (!reports.length) {
        hideReportLoading();
        return;
      }
      const selectedKey = reportByQuery();
      const selected = reportByKey(selectedKey) || reports[0];
      const grainSelect = document.querySelector('[data-period-grain]');
      const periodSelect = document.querySelector('[data-period-key]');
      if (grainSelect) grainSelect.disabled = false;
      if (periodSelect) periodSelect.disabled = false;
      if (grainSelect) {
        grainSelect.addEventListener('change', () => {
          const first = reports.find(item => item.grain === grainSelect.value);
          if (first) setPeriod(first.key, true);
        });
      }
      if (periodSelect) {
        periodSelect.addEventListener('change', () => setPeriod(periodSelect.value, true));
      }
      if (setPeriod(selected.key, false) === false) return;
      hideReportLoading();
    }

    function setChip(tab, value) {
      const group = document.querySelector('[data-filter-group="' + tab + '"]');
      if (!group) return;
      group.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filterValue === value);
      });
    }

    function setStatus(tab, value) {
      const status = document.querySelector('[data-status-for="' + tab + '"]');
      if (!status) return;
      status.textContent = '当前：' + (value === '__all' ? '全部' : value);
    }

    function applyFilter(tab, value) {
      const selected = value || '__all';
      setChip(tab, selected);
      setStatus(tab, selected);
      if (tab === 'pm') {
        document.querySelectorAll('.pm-detail-row').forEach(row => {
          row.classList.toggle('hide', selected !== '__all' && row.dataset.pm !== selected);
        });
      }
      if (tab === 'staff') {
        document.querySelectorAll('.staff-detail-row').forEach(row => {
          row.classList.toggle('hide', selected !== '__all' && row.dataset.staff !== selected);
        });
      }
      if (tab === 'requirements') {
        document.querySelectorAll('.requirement-row').forEach(row => {
          row.classList.toggle('hide', selected !== '__all' && !row.dataset.roleKeys.split(' ').includes(selected));
        });
      }
      if (tab === 'quality') {
        document.querySelectorAll('.quality-detail-row').forEach(row => {
          row.classList.toggle('hide', selected !== '__all' && !row.dataset.quality.split(' ').includes(selected));
        });
      }
    }

    function sortableValue(text) {
      const raw = String(text || '').trim();
      const weekMatch = raw.match(/(\\d{4})-第(\\d{1,2})周/);
      if (weekMatch) return { type: 'number', value: Number(weekMatch[1]) * 100 + Number(weekMatch[2]) };
      const dateRangeMatch = raw.match(/(\\d{4}-\\d{2}-\\d{2})~(\\d{4}-\\d{2}-\\d{2})/);
      if (dateRangeMatch) return { type: 'number', value: Date.parse(dateRangeMatch[2]) || 0 };
      if (/^[-+]?\\d[\\d,]*(\\.\\d+)?\\s*(h|%|小时|条|个)?$/i.test(raw)) {
        return { type: 'number', value: Number(raw.replace(/,/g, '').replace(/(h|%|小时|条|个)/ig, '').trim()) || 0 };
      }
      return { type: 'text', value: raw };
    }

    function compareCells(a, b, direction) {
      const va = sortableValue(a);
      const vb = sortableValue(b);
      let result;
      if (va.type === 'number' && vb.type === 'number') {
        result = va.value - vb.value;
      } else {
        result = String(va.value).localeCompare(String(vb.value), 'zh-CN', { numeric: true, sensitivity: 'base' });
      }
      return direction === 'asc' ? result : -result;
    }

    function sortTableByHeader(header) {
      const table = header.closest('table');
      const tbody = table?.tBodies?.[0];
      if (!table || !tbody) return;
      const index = Number(header.dataset.sortIndex);
      if (!Number.isFinite(index)) return;
      const direction = header.classList.contains('sort-desc') ? 'asc' : 'desc';
      table.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
      header.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
      const rows = Array.from(tbody.rows);
      rows.sort((ra, rb) => compareCells(ra.cells[index]?.textContent || '', rb.cells[index]?.textContent || '', direction));
      rows.forEach(row => tbody.appendChild(row));
    }

    document.addEventListener('click', event => {
      const sortHeader = event.target.closest('th[data-sort-index]');
      if (sortHeader) {
        sortTableByHeader(sortHeader);
        return;
      }
      const openBtn = event.target.closest('[data-open-tab]');
      if (openBtn) {
        openTab(openBtn.dataset.openTab);
        return;
      }
      const filterBtn = event.target.closest('[data-filter-tab]');
      if (filterBtn && filterBtn.classList.contains('chip')) {
        applyFilter(filterBtn.dataset.filterTab, filterBtn.dataset.filterValue);
        return;
      }
      const jump = event.target.closest('[data-jump-tab]');
      if (jump) {
        const tab = jump.dataset.jumpTab;
        openTab(tab);
        if (jump.dataset.filterTab) {
          window.setTimeout(() => applyFilter(jump.dataset.filterTab, jump.dataset.filterValue || '__all'), 0);
        }
      }
    });

    initPeriodSwitcher();
    const initialTab = (window.location.hash || '').replace('#', '');
    if (initialTab && document.getElementById('tab-' + initialTab)) openTab(initialTab);
  </script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = await loadData(args);
  const report = analyze(data);
  const periodReports = buildPeriodReports(data, report);

  const outDir = path.resolve(process.cwd(), args.out || args.outDir || path.join('..', '.codex-local', 'reports', 'workload-analysis'));
  ensureDir(outDir);

  const scopeSlug = safeName([args.year, args.quarter, args.taskId].filter(Boolean).join('_') || 'all');
  const base = `devtracker_workload_${scopeSlug}_${stamp()}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const htmlPath = path.join(outDir, `${base}.html`);
  const latestJsonPath = path.join(outDir, `devtracker_workload_${scopeSlug}_latest.json`);
  const latestHtmlPath = path.join(outDir, `devtracker_workload_${scopeSlug}_latest.html`);
  const latestHtmlName = path.basename(latestHtmlPath);
  const periodMetas = periodReports.map(item => periodMeta(item, latestHtmlName));

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(htmlPath, renderHtml(report, { periodReports: periodMetas }), 'utf8');
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(latestHtmlPath, renderHtml(report, { periodReports: periodMetas }), 'utf8');

  for (const item of periodReports) {
    if (item.key === 'all') continue;
    const periodBase = periodFileBase(item);
    fs.writeFileSync(path.join(outDir, `${periodBase}.json`), JSON.stringify(item.report, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, `${periodBase}.html`), renderHtml(item.report, { periodReports: periodMetas }), 'utf8');
  }

  console.log(`[OK] HTML 报告: ${htmlPath}`);
  console.log(`[OK] JSON 数据: ${jsonPath}`);
  console.log(`[OK] 最新 HTML: ${latestHtmlPath}`);
  console.log(`[OK] 最新 JSON: ${latestJsonPath}`);
  console.log(`[OK] 周期页面: ${periodReports.length - 1} 个`);
  console.log(`[OK] 总工时: ${report.summary.total}h；前端: ${report.summary.frontend}h；后端: ${report.summary.backend}h；测试: ${report.summary.test}h`);
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
