const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../config/database');
const DemandSource = require('../models/DemandSource');
const ProductManagerWorkRecord = require('../models/ProductManagerWorkRecord');

const DEFAULT_DEMAND_SOURCES = [
  { name: '内部需求', color: '#165DFF', sort_order: 10 },
  { name: '客户需求', color: '#00B42A', sort_order: 20 },
  { name: '对外服务', color: '#F77234', sort_order: 30 },
  { name: '其他需求', color: '#0E9384', sort_order: 40 }
];

function normalizeName(value) { return String(value || '').trim().replace(/\s+/g, ' '); }

function payload(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: String(item.id), name: item.name, color: item.color,
    sort_order: Number(item.sort_order || 0), is_system: Boolean(item.is_system),
    is_active: item.is_active !== false, updated_at: item.updated_at || null
  };
}

function validateInput(input = {}, partial = false) {
  const result = {};
  if (!partial || input.name !== undefined) {
    const name = normalizeName(input.name);
    if (name.length < 2 || name.length > 30) throw Object.assign(new Error('需求方名称长度须为 2-30 个字符'), { status: 400 });
    result.name = name;
  }
  if (!partial || input.color !== undefined) {
    const color = String(input.color || '').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) throw Object.assign(new Error('需求方颜色须为 #RRGGBB 格式'), { status: 400 });
    result.color = color;
  }
  if (!partial || input.sort_order !== undefined) {
    const sortOrder = Number(input.sort_order ?? 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw Object.assign(new Error('排序必须为非负整数'), { status: 400 });
    result.sort_order = sortOrder;
  }
  if (input.is_active !== undefined) result.is_active = Boolean(input.is_active);
  return result;
}

async function refreshCatalog() {
  return DemandSource.findAll({ order: [['sort_order', 'ASC'], ['created_at', 'ASC']] });
}

async function getDemandSourceDefinitions({ includeInactive = false } = {}) {
  const rows = await DemandSource.findAll({
    where: includeInactive ? undefined : { is_active: true },
    order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
  });
  return rows.map(payload);
}

async function resolveDemandSources(value, { includeInactive = false } = {}) {
  const definitions = await getDemandSourceDefinitions({ includeInactive: true });
  const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,，、|\s]+/) : []);
  const result = [];
  for (const raw of values) {
    const text = normalizeName(raw);
    const item = definitions.find(definition => definition.id === text || definition.name === text);
    if (!item || (!includeInactive && !item.is_active)) continue;
    if (!result.some(existing => existing.id === item.id)) result.push(item);
  }
  return { names: result.map(item => item.name), ids: result.map(item => item.id), definitions: result };
}

async function ensureDemandSourceSchema() {
  await DemandSource.sync();
  const count = await DemandSource.count();
  if (count > 0) return;
  await DemandSource.bulkCreate(DEFAULT_DEMAND_SOURCES.map(item => ({
    id: uuidv4(), ...item, is_system: true, is_active: true, updated_at: new Date()
  })));
}

async function assertUniqueName(name, excludeId = null, transaction) {
  const where = { name };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const found = await DemandSource.findOne({ where, transaction });
  if (found) throw Object.assign(new Error('需求方名称已存在'), { status: 409 });
}

async function createDemandSource(input) {
  const values = validateInput(input);
  await assertUniqueName(values.name);
  const max = await DemandSource.max('sort_order') || 0;
  const row = await DemandSource.create({ id: uuidv4(), ...values, sort_order: values.sort_order || max + 10, updated_at: new Date() });
  return payload(row);
}

async function updateDemandSource(id, input) {
  const transaction = await sequelize.transaction();
  try {
    const row = await DemandSource.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw Object.assign(new Error('需求方不存在'), { status: 404 });
    const values = validateInput(input, true);
    if (values.name) await assertUniqueName(values.name, id, transaction);
    Object.assign(row, values, { updated_at: new Date() });
    await row.save({ transaction });
    await transaction.commit();
    return payload(row);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function countReferences(id, name) {
  const rows = await ProductManagerWorkRecord.findAll({ attributes: ['id', 'demand_sources', 'demand_source_weights'] });
  const matching = rows.filter(row => {
    let values = row.demand_sources;
    if (typeof values === 'string') { try { values = JSON.parse(values); } catch { values = []; } }
    return Array.isArray(values) && values.some(item => String(item) === String(id) || String(item) === name);
  });
  return { total: matching.length, productRecords: matching.length };
}

async function deleteDemandSource(id) {
  const row = await DemandSource.findByPk(id);
  if (!row) throw Object.assign(new Error('需求方不存在'), { status: 404 });
  const references = await countReferences(id, row.name);
  if (references.total > 0) {
    const err = new Error(`需求方“${row.name}”已被 ${references.total} 条工时记录引用，不能删除`);
    err.status = 409;
    err.references = references;
    throw err;
  }
  if (row.is_system) throw Object.assign(new Error('系统默认需求方不允许删除，可停用或修改名称'), { status: 409 });
  await row.destroy();
  return { id, references };
}

module.exports = {
  DEFAULT_DEMAND_SOURCES,
  ensureDemandSourceSchema,
  getDemandSourceDefinitions,
  resolveDemandSources,
  createDemandSource,
  updateDemandSource,
  deleteDemandSource,
  countReferences,
  normalizeName
};
