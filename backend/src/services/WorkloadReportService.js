const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const BACKEND_DIR = path.join(__dirname, '..', '..');
const REPO_DIR = path.join(BACKEND_DIR, '..');
const REPORT_ROOT = path.join(REPO_DIR, '.codex-local', 'reports');
const WORKLOAD_REPORT_DIR = path.join(REPORT_ROOT, 'workload-analysis');
const ANALYZE_SCRIPT = path.join(BACKEND_DIR, 'scripts', 'analyze_workload.js');
const REFRESH_MARKER = path.join(WORKLOAD_REPORT_DIR, '.refresh-state.json');
const GENERATE_TIMEOUT_MS = Number(process.env.WORKLOAD_REPORT_GENERATE_TIMEOUT_MS || 120000);

let refreshPromise = null;

function workloadReportRoot() {
  return WORKLOAD_REPORT_DIR;
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readRefreshMarker() {
  try {
    return JSON.parse(await fs.promises.readFile(REFRESH_MARKER, 'utf8'));
  } catch {
    return null;
  }
}

async function writeRefreshMarker(signature) {
  await fs.promises.mkdir(WORKLOAD_REPORT_DIR, { recursive: true });
  await fs.promises.writeFile(REFRESH_MARKER, JSON.stringify({
    signature,
    refreshedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}

function normalizeSignatureValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function currentDataSignature() {
  const [row] = await sequelize.query(`
    SELECT
      (SELECT COUNT(*) FROM work_records) AS work_record_count,
      (SELECT COALESCE(SUM(hours), 0) FROM work_records) AS work_hour_total,
      (SELECT MAX(GREATEST(COALESCE(updated_at, created_at), created_at)) FROM work_records) AS work_record_updated_at,
      (SELECT COUNT(*) FROM collection_tasks) AS task_count,
      (SELECT MAX(GREATEST(COALESCE(updated_at, created_at), created_at)) FROM collection_tasks) AS task_updated_at,
      (SELECT COUNT(*) FROM staff) AS staff_count,
      (SELECT MAX(GREATEST(COALESCE(status_changed_at, created_at), created_at)) FROM staff) AS staff_updated_at,
      (SELECT COALESCE(GROUP_CONCAT(
        CONCAT_WS(':', id, COALESCE(name, ''), COALESCE(role, ''), COALESCE(employment_status, ''), COALESCE(is_active, 0))
        ORDER BY id SEPARATOR '|'
      ), '') FROM staff) AS staff_roster_signature,
      (SELECT COUNT(*) FROM staff_status_history) AS staff_status_history_count,
      (SELECT MAX(GREATEST(COALESCE(ended_at, started_at), started_at, created_at)) FROM staff_status_history) AS staff_status_history_updated_at,
      (SELECT COUNT(*) FROM product_managers) AS pm_count,
      (SELECT MAX(GREATEST(COALESCE(updated_at, created_at), COALESCE(status_changed_at, created_at), created_at)) FROM product_managers) AS pm_updated_at,
      (SELECT COUNT(*) FROM product_manager_status_history) AS pm_status_history_count,
      (SELECT MAX(GREATEST(COALESCE(ended_at, started_at), started_at, created_at)) FROM product_manager_status_history) AS pm_status_history_updated_at
  `, { type: QueryTypes.SELECT });

  const generatorHash = crypto
    .createHash('sha256')
    .update(await fs.promises.readFile(ANALYZE_SCRIPT))
    .digest('hex');

  return JSON.stringify(Object.fromEntries(
    Object.entries({ ...row, workload_generator_sha256: generatorHash })
      .map(([key, value]) => [key, normalizeSignatureValue(value)])
  ));
}

function generateWorkloadReport() {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [ANALYZE_SCRIPT],
      {
        cwd: BACKEND_DIR,
        env: process.env,
        timeout: GENERATE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10
      },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}\n${stderr || stdout || ''}`.trim();
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );

    child.on('error', reject);
  });
}

async function ensureFreshWorkloadReport(requestedPath) {
  const signature = await currentDataSignature();
  const marker = await readRefreshMarker();
  const allReportPath = path.join(WORKLOAD_REPORT_DIR, 'devtracker_workload_all_latest.html');
  const needsRefresh =
    marker?.signature !== signature
    || !(await pathExists(allReportPath))
    || (requestedPath && !(await pathExists(requestedPath)));

  if (!needsRefresh) return false;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      await fs.promises.mkdir(WORKLOAD_REPORT_DIR, { recursive: true });
      await generateWorkloadReport();
      await writeRefreshMarker(signature);
    })().finally(() => {
      refreshPromise = null;
    });
  }

  await refreshPromise;
  return true;
}

module.exports = {
  ensureFreshWorkloadReport,
  workloadReportRoot
};
