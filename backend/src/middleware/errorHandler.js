/**
 * 全局错误处理中间件
 */
function errorHandler(err, req, res, _next) {
  console.error('[ERROR]', err.message);
  res.status(500).json({ code: -1, message: '服务器内部错误', detail: err.message });
}

module.exports = errorHandler;
