const path = require('path');
const fs = require('fs');
const express = require('express');
const { buildVersionWorkbook, validateVersionQuery } = require('../services/WorkloadVersionExport');
const {
  ensureFreshWorkloadReport,
  workloadReportRoot
} = require('../services/WorkloadReportService');

const router = express.Router();
const REPORT_EXTENSIONS = new Set(['.html', '.json']);

function resolveReportFile(fileName) {
  if (typeof fileName !== 'string' || /[\\/:\x00-\x1f]/.test(fileName)) return null;
  const baseName = path.basename(fileName || '');
  if (!baseName || baseName !== fileName) return null;
  if (!baseName.startsWith('devtracker_workload_')) return null;
  if (!REPORT_EXTENSIONS.has(path.extname(baseName).toLowerCase())) return null;
  return path.join(workloadReportRoot(), baseName);
}

router.post('/export', async (req, res, next) => {
  try {
    const reportPath = resolveReportFile(req.body?.reportFile);
    if (!reportPath) return res.status(400).json({ code: 1, message: '报告文件名无效' });
    const query = validateVersionQuery(req.body);
    const jsonPath = reportPath.replace(/\.html$/i, '.json');
    // Read the page snapshot, not a newer aggregation which may differ from what the user sees.
    const report = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    if (typeof req.body.generatedAt !== 'string' || req.body.generatedAt !== report.generatedAt) {
      return res.status(409).json({ code: 1, message: '报告数据已更新，请刷新页面后重新导出' });
    }
    const buffer = buildVersionWorkbook(report, query);
    const scope = String(report.dataset.periodLabel || report.dataset.scope || '全部').replace(/[\\/:*?"<>|\r\n]/g, '_');
    const filename = `工时数据分析报告_版本_${scope}_${Date.now()}.xlsx`;
    res.set('Cache-Control', 'no-store');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ code: 1, message: error.message });
    if (error.code === 'ENOENT') return res.status(404).json({ code: 1, message: '报告不存在，请重新打开报告' });
    next(error);
  }
});

router.get('/:fileName', async (req, res, next) => {
  try {
    const reportPath = resolveReportFile(req.params.fileName);
    if (!reportPath) {
      res.status(404).json({ code: 1, message: 'Report file not found' });
      return;
    }

    await ensureFreshWorkloadReport(reportPath);
    await fs.promises.access(reportPath, fs.constants.R_OK);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type(path.extname(reportPath).toLowerCase() === '.json' ? 'application/json' : 'html');
    fs.createReadStream(reportPath).on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
