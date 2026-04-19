/**
 * Excel 路由 — 文件上传存档 & 模板下载
 * v2.0.0: 导入导出功能新增
 *
 * POST /api/excel/upload                     上传 Excel 文件存档到 DB
 * GET  /api/excel/template/:page             下载各页面导入模板
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { ExcelFile } = require('../models');

/* ========== multer 内存存储 ========== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx / .xls 格式'));
    }
  }
});

/* ========== POST /api/excel/upload — 上传存档 ========== */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ code: 1, message: '请上传文件' });

    const { source_page, task_id, staff_id, upload_type } = req.body;
    if (!source_page) return res.status(400).json({ code: 1, message: 'source_page 必填' });
    if (!upload_type) return res.status(400).json({ code: 1, message: 'upload_type 必填' });

    const record = await ExcelFile.create({
      id: uuidv4(),
      filename: req.file.originalname,
      file_data: req.file.buffer,
      file_size: req.file.size,
      source_page,
      task_id: task_id || null,
      staff_id: staff_id || null,
      upload_type
    });

    res.json({ code: 0, data: { id: record.id, filename: record.filename }, message: '文件已存档' });
  } catch (err) { next(err); }
});

/* ========== 模板定义 ========== */
const TEMPLATES = {
  fill: {
    filename: '填写工时导入模板.xlsx',
    headers: ['需求标题', '版本号', '产品经理', '工时(小时)'],
    sample: ['示例需求', 'V4.633.0', '张三', '8']
  },
  'task-detail': {
    filename: '任务提交数据导入模板.xlsx',
    headers: ['人员姓名', '需求标题', '版本号', '产品经理', '工时(小时)'],
    sample: ['邬涛', '示例需求', 'V4.633.0', '张三', '16']
  },
  report: {
    filename: '需求工时统计导入模板.xlsx',
    headers: ['版本号', '需求名称', '产品经理', '前端姓名', '前端工时', '后端姓名', '后端工时', '测试姓名', '测试工时', '备注'],
    sample: ['V4.633.0', '示例需求', '张三', '李四', '8', '王五', '16', '赵六', '4', '']
  }
};

/* ========== GET /api/excel/template/:page — 下载导入模板 ========== */
router.get('/template/:page', (req, res) => {
  const tpl = TEMPLATES[req.params.page];
  if (!tpl) return res.status(404).json({ code: 1, message: '模板不存在' });

  const wb = XLSX.utils.book_new();
  const wsData = [tpl.headers, tpl.sample];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 设置列宽
  ws['!cols'] = tpl.headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));

  XLSX.utils.book_append_sheet(wb, ws, '导入模板');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(tpl.filename)}`);
  res.send(buf);
});

module.exports = router;
