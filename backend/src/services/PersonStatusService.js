const { v4: uuidv4 } = require('uuid');
const { DataTypes, Op } = require('sequelize');
const {
  sequelize,
  Staff,
  ProductManager,
  StaffStatusHistory,
  ProductManagerStatusHistory
} = require('../models');
const { safeParseJsonArray } = require('../utils/parseJson');
const { dateToYmd, getBeijingDate } = require('../utils/beijingTime');

const EMPLOYMENT_STATUSES = ['active', 'resigned', 'retained', 'long_leave'];
const RESIGNED_STATUS = 'resigned';
const STAFF_RESIGNED_MESSAGE = '用户已离职，无法填写页面数据';
const PM_RESIGNED_MESSAGE = '用户已离职，无法查看页面数据';
const STATUS_LABEL = {
  active: '在职',
  resigned: '离职',
  retained: '留职',
  long_leave: '长假'
};
const PM_DEFAULT_NAME = '不在上述';

async function ensureColumn(tableName, columnName, definition) {
  const table = await sequelize.getQueryInterface().describeTable(tableName);
  if (!table[columnName]) {
    await sequelize.getQueryInterface().addColumn(tableName, columnName, definition);
  }
}

async function ensurePersonStatusTables() {
  await ensureColumn('staff', 'employment_status', {
    type: DataTypes.ENUM(...EMPLOYMENT_STATUSES),
    allowNull: false,
    defaultValue: 'active'
  });
  await ensureColumn('staff', 'status_changed_at', {
    type: DataTypes.DATE,
    allowNull: true
  });
  await ensureColumn('product_managers', 'employment_status', {
    type: DataTypes.ENUM(...EMPLOYMENT_STATUSES),
    allowNull: false,
    defaultValue: 'active'
  });
  await ensureColumn('product_managers', 'status_changed_at', {
    type: DataTypes.DATE,
    allowNull: true
  });

  await StaffStatusHistory.sync();
  await ProductManagerStatusHistory.sync();

  await sequelize.query(`
    UPDATE staff
    SET employment_status = CASE WHEN is_active = 0 THEN 'resigned' ELSE 'active' END
    WHERE employment_status IS NULL OR employment_status = ''
  `);
  await sequelize.query(`
    UPDATE staff
    SET status_changed_at = COALESCE(status_changed_at, created_at, NOW()),
        is_active = CASE WHEN employment_status = 'resigned' THEN 0 ELSE 1 END
  `);
  await sequelize.query(`
    UPDATE product_managers
    SET employment_status = CASE WHEN is_active = 0 THEN 'resigned' ELSE 'active' END
    WHERE employment_status IS NULL OR employment_status = ''
  `);
  await sequelize.query(`
    UPDATE product_managers
    SET status_changed_at = COALESCE(status_changed_at, updated_at, created_at, NOW()),
        is_active = CASE WHEN employment_status = 'resigned' THEN 0 ELSE 1 END
  `);

  await sequelize.query(`
    INSERT INTO staff_status_history (id, staff_id, status, started_at, ended_at, created_at)
    SELECT UUID(), s.id, s.employment_status, COALESCE(s.status_changed_at, s.created_at, NOW()), NULL, NOW()
    FROM staff s
    WHERE NOT EXISTS (
      SELECT 1 FROM staff_status_history h WHERE h.staff_id = s.id
    )
  `);
  await sequelize.query(`
    INSERT INTO product_manager_status_history (id, product_manager_id, status, started_at, ended_at, created_at)
    SELECT UUID(), p.id, p.employment_status, COALESCE(p.status_changed_at, p.updated_at, p.created_at, NOW()), NULL, NOW()
    FROM product_managers p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_manager_status_history h WHERE h.product_manager_id = p.id
    )
  `);
}

function normalizeEmploymentStatus(status, fallbackIsActive = true) {
  const value = String(status || '').trim();
  if (EMPLOYMENT_STATUSES.includes(value)) return value;
  return fallbackIsActive === false ? RESIGNED_STATUS : 'active';
}

function isResignedStatus(status) {
  return normalizeEmploymentStatus(status) === RESIGNED_STATUS;
}

function isNonResigned(person) {
  return !isResignedStatus(person?.employment_status ?? (person?.is_active === false ? RESIGNED_STATUS : 'active'));
}

function getStatusLabel(status) {
  return STATUS_LABEL[normalizeEmploymentStatus(status)] || STATUS_LABEL.active;
}

function normalizeStatusDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  const ymd = text ? text.slice(0, 10) : dateToYmd(getBeijingDate());
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return new Date(`${ymd}T00:00:00+08:00`);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date(`${dateToYmd(getBeijingDate())}T00:00:00+08:00`) : parsed;
}

function toDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const local = new Date(value.getTime() + 8 * 60 * 60 * 1000);
    return local.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return toDateKey(parsed);
}

function compareDateKey(left, right) {
  const l = toDateKey(left);
  const r = toDateKey(right);
  if (!l || !r) return 0;
  return l < r ? -1 : (l > r ? 1 : 0);
}

function historyRowsForDate(histories = [], businessDate) {
  const key = toDateKey(businessDate);
  if (!key) return null;
  return histories.find(row => {
    const started = toDateKey(row.started_at);
    const ended = row.ended_at ? toDateKey(row.ended_at) : null;
    return started && started <= key && (!ended || key < ended);
  }) || null;
}

function isResignedAt(histories = [], businessDate, fallbackStatus = 'active') {
  const row = historyRowsForDate(histories, businessDate);
  if (row) return row.status === RESIGNED_STATUS;
  return isResignedStatus(fallbackStatus);
}

async function setStaffStatus(staff, status, effectiveDate, transaction = null) {
  return setPersonStatus({
    instance: staff,
    status,
    effectiveDate,
    transaction,
    historyModel: StaffStatusHistory,
    foreignKey: 'staff_id',
    updatedAtField: null
  });
}

async function setProductManagerStatus(pm, status, effectiveDate, transaction = null) {
  return setPersonStatus({
    instance: pm,
    status,
    effectiveDate,
    transaction,
    historyModel: ProductManagerStatusHistory,
    foreignKey: 'product_manager_id',
    updatedAtField: 'updated_at'
  });
}

async function setPersonStatus({ instance, status, effectiveDate, transaction, historyModel, foreignKey, updatedAtField }) {
  const normalized = normalizeEmploymentStatus(status, instance.is_active !== false);
  const effectiveAt = normalizeStatusDate(effectiveDate);
  await historyModel.update(
    { ended_at: effectiveAt },
    { where: { [foreignKey]: instance.id, ended_at: null }, transaction }
  );
  await historyModel.create({
    id: uuidv4(),
    [foreignKey]: instance.id,
    status: normalized,
    started_at: effectiveAt,
    ended_at: null,
    created_at: new Date()
  }, { transaction });
  instance.employment_status = normalized;
  instance.status_changed_at = effectiveAt;
  instance.is_active = normalized !== RESIGNED_STATUS;
  if (updatedAtField) instance[updatedAtField] = new Date();
  await instance.save({ transaction });
  return instance;
}

function buildCurrentStatusPayload(person) {
  const employmentStatus = normalizeEmploymentStatus(person?.employment_status, person?.is_active !== false);
  return {
    employment_status: employmentStatus,
    employment_status_label: getStatusLabel(employmentStatus),
    is_active: employmentStatus !== RESIGNED_STATUS,
    status_changed_at: person?.status_changed_at || person?.created_at || null
  };
}

function getTaskBusinessDate(task) {
  return toDateKey(task?.end_date || task?.start_date || task?.created_at || new Date());
}

async function getStaffHistoryMap(staffIds = []) {
  const ids = [...new Set(staffIds.filter(Boolean))];
  const map = new Map();
  if (ids.length === 0) return map;
  const rows = await StaffStatusHistory.findAll({
    where: { staff_id: { [Op.in]: ids } },
    order: [['staff_id', 'ASC'], ['started_at', 'ASC']]
  });
  for (const row of rows) {
    const plain = row.toJSON();
    if (!map.has(plain.staff_id)) map.set(plain.staff_id, []);
    map.get(plain.staff_id).push(plain);
  }
  return map;
}

async function getPmStatusContextByName(pmNames = []) {
  const names = [...new Set(pmNames.map(name => String(name || '').trim()).filter(Boolean))]
    .filter(name => name !== PM_DEFAULT_NAME);
  const result = new Map();
  if (names.length === 0) return result;
  const pms = await ProductManager.findAll({
    where: { name: { [Op.in]: names } },
    attributes: ['id', 'name', 'employment_status', 'is_active', 'status_changed_at', 'sort_order']
  });
  const pmIds = pms.map(pm => pm.id);
  const histories = pmIds.length
    ? await ProductManagerStatusHistory.findAll({
        where: { product_manager_id: { [Op.in]: pmIds } },
        order: [['product_manager_id', 'ASC'], ['started_at', 'ASC']]
      })
    : [];
  const historyMap = new Map();
  for (const row of histories) {
    const plain = row.toJSON();
    if (!historyMap.has(plain.product_manager_id)) historyMap.set(plain.product_manager_id, []);
    historyMap.get(plain.product_manager_id).push(plain);
  }
  for (const pm of pms) {
    result.set(pm.name, {
      pm,
      histories: historyMap.get(pm.id) || []
    });
  }
  return result;
}

function collectPmNamesFromRecords(records = []) {
  const names = new Set();
  for (const record of records) {
    for (const name of safeParseJsonArray(record.product_managers)) {
      if (name) names.add(name);
    }
  }
  return [...names];
}

async function filterRecordsByStaffStatus(records = [], taskMap = new Map()) {
  const staffIds = records.map(record => record.staff_id || record.staff?.id).filter(Boolean);
  const historyMap = await getStaffHistoryMap(staffIds);
  return records.filter(record => {
    const staff = record.staff || {};
    const staffId = record.staff_id || staff.id;
    const task = taskMap.get(record.task_id) || record.task;
    const businessDate = getTaskBusinessDate(task);
    return !isResignedAt(
      historyMap.get(staffId) || [],
      businessDate,
      normalizeEmploymentStatus(staff.employment_status, staff.is_active !== false)
    );
  });
}

async function filterPmNamesForRecord(record, task, pmContextByName = null) {
  const pms = safeParseJsonArray(record.product_managers);
  if (pms.length === 0) return [];
  const context = pmContextByName || await getPmStatusContextByName(pms);
  const businessDate = getTaskBusinessDate(task);
  return pms.filter(name => {
    const ctx = context.get(name);
    if (!ctx) return true;
    return !isResignedAt(
      ctx.histories,
      businessDate,
      normalizeEmploymentStatus(ctx.pm.employment_status, ctx.pm.is_active !== false)
    );
  });
}

async function filterRecordsForPm(records = [], pm, taskMap = new Map()) {
  const context = await getPmStatusContextByName([pm.name]);
  const ctx = context.get(pm.name);
  return records.filter(record => {
    const pms = safeParseJsonArray(record.product_managers);
    if (!(pms.includes(pm.name) || (pm.name === PM_DEFAULT_NAME && pms.length === 0))) return false;
    if (!ctx || pm.name === PM_DEFAULT_NAME) return true;
    const task = taskMap.get(record.task_id) || record.task;
    return !isResignedAt(
      ctx.histories,
      getTaskBusinessDate(task),
      normalizeEmploymentStatus(ctx.pm.employment_status, ctx.pm.is_active !== false)
    );
  });
}

function assertStaffCanWrite(staff) {
  if (!isNonResigned(staff)) {
    const err = new Error(STAFF_RESIGNED_MESSAGE);
    err.status = 403;
    err.reason = 'staff_resigned';
    throw err;
  }
}

function assertPmCanView(pm) {
  if (!isNonResigned(pm)) {
    const err = new Error(PM_RESIGNED_MESSAGE);
    err.status = 403;
    err.reason = 'pm_resigned';
    throw err;
  }
}

module.exports = {
  EMPLOYMENT_STATUSES,
  RESIGNED_STATUS,
  STAFF_RESIGNED_MESSAGE,
  PM_RESIGNED_MESSAGE,
  STATUS_LABEL,
  ensurePersonStatusTables,
  normalizeEmploymentStatus,
  normalizeStatusDate,
  isNonResigned,
  isResignedStatus,
  isResignedAt,
  getStatusLabel,
  buildCurrentStatusPayload,
  setStaffStatus,
  setProductManagerStatus,
  getTaskBusinessDate,
  getStaffHistoryMap,
  getPmStatusContextByName,
  collectPmNamesFromRecords,
  filterRecordsByStaffStatus,
  filterPmNamesForRecord,
  filterRecordsForPm,
  assertStaffCanWrite,
  assertPmCanView,
  toDateKey,
  compareDateKey
};
