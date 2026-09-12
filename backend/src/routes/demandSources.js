const express = require('express');
const router = express.Router();
const {
  getDemandSourceDefinitions,
  createDemandSource,
  updateDemandSource,
  deleteDemandSource,
  countReferences
} = require('../services/DemandSourceService');
const { DemandSource } = require('../models');

router.get('/', async (req, res, next) => {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1';
    const data = await getDemandSourceDefinitions({ includeInactive });
    res.json({ code: 0, data });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try { res.status(201).json({ code: 0, data: await createDemandSource(req.body || {}), message: '需求方已新增' }); }
  catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try { res.json({ code: 0, data: await updateDemandSource(req.params.id, req.body || {}), message: '需求方已保存' }); }
  catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try { res.json({ code: 0, data: await deleteDemandSource(req.params.id), message: '需求方已删除' }); }
  catch (err) { next(err); }
});

router.get('/:id/references', async (req, res, next) => {
  try {
    const row = await DemandSource.findByPk(req.params.id);
    if (!row) return res.status(404).json({ code: 1, message: '需求方不存在' });
    res.json({ code: 0, data: await countReferences(row.id, row.name) });
  } catch (err) { next(err); }
});

module.exports = router;
