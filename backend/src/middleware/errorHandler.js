/**
 * 全局错误处理中间件
 */
function errorHandler(err, req, res, _next) {
  console.error('[ERROR]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    code: status >= 500 ? -1 : 1,
    message: status >= 500 ? '服务器内部错误' : err.message,
    detail: err.message
  });
}

module.exports = errorHandler;
