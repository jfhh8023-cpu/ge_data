const express = require('express');
const router = express.Router();
const { DutyScheduleSwap } = require('../models');
const {
  getDutyCalendar,
  hasSuccessfulDutyStart,
  invalidateResolverCache,
  previewDutySchedule,
  saveDutyCalendar
} = require('../services/DutyCalendarService');

router.get('/', async (req, res, next) => {
  try {
    const data = await getDutyCalendar({
      year: req.query.year,
      ruleId: req.query.rule_id
    });
    res.json({ code: 0, data });
  } catch (error) {
    next(error);
  }
});

router.post('/preview', async (req, res, next) => {
  try {
    const data = await previewDutySchedule({
      ruleId: req.body.rule_id,
      from: req.body.from,
      to: req.body.to,
      draft: req.body.draft || null,
      presentationBeforeFirstEffective: req.body.presentation_before_first_effective === true
    });
    res.json({ code: 0, data });
  } catch (error) {
    next(error);
  }
});

router.put('/:year', async (req, res, next) => {
  try {
    const data = await saveDutyCalendar({
      year: req.params.year,
      ruleId: req.body.rule_id,
      payload: req.body
    });
    res.json({ code: 0, data, message: '节假日跳过设置已保存并生效' });
  } catch (error) {
    next(error);
  }
});

router.delete('/swaps/:id', async (req, res, next) => {
  try {
    const swap = await DutyScheduleSwap.findByPk(req.params.id);
    if (!swap) return res.status(404).json({ code: 1, message: '临时换班不存在' });
    if (await hasSuccessfulDutyStart(swap.rule_id, swap.date_a) || await hasSuccessfulDutyStart(swap.rule_id, swap.date_b)) {
      return res.status(409).json({ code: 1, message: '已执行的临时换班不能取消历史结果' });
    }
    await swap.update({ status: 'cancelled', revision: Number(swap.revision || 0) + 1, updated_at: new Date() });
    invalidateResolverCache();
    res.json({ code: 0, message: '临时换班已取消' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
