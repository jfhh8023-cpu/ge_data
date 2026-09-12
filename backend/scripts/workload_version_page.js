const VERSION_STYLES = `
  .version-toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin-bottom:12px; }
  .version-toolbar label { display:grid; gap:4px; font-size:13px; flex:1 1 150px; min-width:0; }
  .version-toolbar select { width:100%; height:34px; border:1px solid var(--line); border-radius:5px; background:#fff; padding:0 8px; color:var(--text); font:inherit; }
  .version-toolbar button { height:34px; padding:0 12px; border:1px solid var(--line); border-radius:5px; background:#fff; font:inherit; font-size:13px; cursor:pointer; white-space:nowrap; }
  .version-toolbar .version-export { background:#2563eb; color:#fff; border-color:#2563eb; }
  .version-toolbar button:disabled { opacity:.6; cursor:wait; }
  .version-result-status { font-size:13px; color:#344054; margin:8px 0 16px; }
  .version-feedback { font-size:13px; color:#15803d; min-height:20px; }
  .version-feedback.error { color:#b42318; }
  #tab-versions .version-table th { white-space:nowrap; }
  #tab-versions .version-table .version-title-cell { min-width:250px; white-space:normal; overflow-wrap:anywhere; }
  #tab-versions .version-table td:not(.version-title-cell) { white-space:nowrap; }
  #tab-versions .version-detail-section { margin-top:20px; }
  #tab-versions .bar-row.simple.has-meta { grid-template-columns:105px minmax(100px,1fr) minmax(100px,1fr) 70px; }
  #tab-versions .pie-layout { grid-template-columns:180px minmax(0,1fr); gap:12px; }
  #tab-versions .pie-svg { width:180px; height:180px; }
  #tab-versions .pie-legend-row > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #tab-versions .pie-legend-row > strong { white-space:nowrap; }
  @media(max-width:720px) {
    #tab-versions .bar-row.simple.has-meta { grid-template-columns:90px minmax(0,1fr) 64px; }
    #tab-versions .bar-meta { grid-column:1 / -1; grid-row:auto; }
    #tab-versions .pie-layout { grid-template-columns:1fr; }
    #tab-versions .pie-svg { justify-self:center; }
  }
`;

function versionControlsHtml() {
  return `<div class="version-toolbar" aria-label="版本筛选">
    <label>人员<select id="version-staff" aria-label="人员筛选"><option value="">全部</option></select></label>
    <label>岗位<select id="version-role" aria-label="岗位筛选"><option value="">全部</option></select></label>
    <label>版本号<select id="version-number" aria-label="版本号筛选"><option value="">全部</option></select></label>
    <label>去重维度<select id="version-group" aria-label="去重维度">
      <option value="combination">人员 + 岗位 + 版本号</option><option value="staff">按人员</option>
      <option value="role">按岗位</option><option value="version">按版本号</option>
    </select></label>
    <button type="button" id="version-reset">重置筛选</button>
    <button type="button" class="version-export" id="version-export">导出 Excel</button>
  </div><div class="version-result-status" id="version-result-status" role="status"></div>
  <div class="version-feedback" id="version-feedback" role="status" aria-live="polite"></div>`;
}

// Runs inside generated HTML; dependencies are explicitly supplied by the generator.
function mountVersionPage(report, buildView, helpers) {
  const root = document.getElementById('tab-versions');
  if (!root) return;
  const staff = document.getElementById('version-staff');
  const role = document.getElementById('version-role');
  const version = document.getElementById('version-number');
  const group = document.getElementById('version-group');
  const exportButton = document.getElementById('version-export');
  const feedback = document.getElementById('version-feedback');
  const sorts = {};
  let view;
  const filters = () => ({ staff: staff.value ? [staff.value] : [], roles: role.value ? [role.value] : [], versions: version.value ? [version.value] : [] });
  const html = helpers.escapeHtml;
  const initial = buildView(report);
  for (const [select, options] of [[staff, initial.options.staff], [role, initial.options.roles], [version, initial.options.versions]]) {
    select.innerHTML = '<option value="">全部</option>' + options.map(option => `<option value="${html(option.value)}">${html(option.label)}</option>`).join('');
  }
  const renderTable = (rows, columns, kind) => {
    const headers = columns.map(column => {
      const direction = sorts[kind]?.key === column.key ? sorts[kind].direction : '';
      return `<th data-version-sort="${html(column.key)}" data-version-table="${kind}" tabindex="0" aria-sort="${direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}" class="${direction ? `sort-${direction}` : ''}" title="点击排序">${html(column.label)}</th>`;
    }).join('');
    const body = rows.map(row => '<tr>' + columns.map(column => `<td class="${column.key === 'versionName' ? 'version-title-cell text-left' : column.numeric || column.percent ? 'num' : ''}">${html(column.numeric ? helpers.fmt(row[column.key]) : column.percent ? row[column.key] + '%' : row[column.key])}</td>`).join('') + '</tr>').join('');
    return `<div class="table-wrap"><table class="sortable-table version-table"><thead><tr>${headers}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">无匹配数据</td></tr>`}</tbody></table></div>`;
  };
  const render = () => {
    view = buildView(report, filters(), group.value, sorts);
    root.querySelector('[data-version-charts]').innerHTML = helpers.simpleBarChart(view.chartRows, '版本投入 Top 16', { limit: 16, metaField: 'versionName' }) + helpers.pieChart(view.chartRows, '版本工时占比', { limit: 10 });
    root.querySelector('[data-version-summary]').innerHTML = renderTable(view.versionRows, view.versionColumns, 'versions');
    root.querySelector('[data-version-details]').innerHTML = renderTable(view.detailRows, view.detailColumns, 'details');
    document.getElementById('version-result-status').textContent = `${view.recordCount} 条记录 · ${view.versionRows.length} 个版本 · ${view.detailRows.length} 条去重汇总 · 总工时 ${helpers.fmt(view.total)}h`;
    document.getElementById('version-details-title').textContent = `去重汇总：${view.groupLabel}`;
    feedback.textContent = '';
  };
  for (const select of [staff, role, version, group]) select.addEventListener('change', () => { if (select === group) delete sorts.details; render(); });
  document.getElementById('version-reset').addEventListener('click', () => {
    staff.value = ''; role.value = ''; version.value = ''; group.value = 'combination';
    delete sorts.versions; delete sorts.details; render();
  });
  const sortHandler = event => {
    const header = event.target.closest('[data-version-sort]');
    if (!header || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
    event.preventDefault();
    const key = header.dataset.versionSort;
    const kind = header.dataset.versionTable;
    sorts[kind] = { key, direction: sorts[kind]?.key === key && sorts[kind].direction === 'desc' ? 'asc' : 'desc' };
    render();
  };
  root.addEventListener('click', sortHandler);
  root.addEventListener('keydown', sortHandler);
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    exportButton.textContent = '正在导出…';
    feedback.classList.remove('error');
    feedback.textContent = '';
    try {
      const url = new URL('export', window.location.href);
      const reportFile = decodeURIComponent(window.location.pathname.split('/').pop());
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportFile, generatedAt: report.generatedAt, filters: filters(), groupBy: group.value, sorts })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || '导出失败，请重试');
      }
      const blob = await response.blob();
      const link = document.createElement('a');
      const match = (response.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i);
      link.download = match ? decodeURIComponent(match[1]) : '工时数据分析报告_版本.xlsx';
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 30000);
      feedback.textContent = 'Excel 已导出';
    } catch (error) {
      feedback.classList.add('error'); feedback.textContent = error.message || '导出失败，请重试';
    } finally {
      exportButton.disabled = false; exportButton.textContent = '导出 Excel';
    }
  });
  render();
}

module.exports = { VERSION_STYLES, versionControlsHtml, mountVersionPage };
