const path = require('path');
const fs = require('fs');
const express = require('express');
const {
  ensureFreshWorkloadReport,
  workloadReportRoot
} = require('../services/WorkloadReportService');

const router = express.Router();
const REPORT_EXTENSIONS = new Set(['.html', '.json']);

function resolveReportFile(fileName) {
  const baseName = path.basename(fileName || '');
  if (!baseName || baseName !== fileName) return null;
  if (!baseName.startsWith('devtracker_workload_')) return null;
  if (!REPORT_EXTENSIONS.has(path.extname(baseName).toLowerCase())) return null;
  return path.join(workloadReportRoot(), baseName);
}

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
