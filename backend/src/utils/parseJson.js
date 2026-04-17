/**
 * 安全解析 JSON 字段（兼容 MariaDB 双重编码）
 * MariaDB 可能将 JSON 列返回为双重编码字符串，如 '"[\"name\"]"'
 * 第一次 JSON.parse 得到内层字符串 '["name"]'，需要再次解析
 */
function safeParseJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      let parsed = JSON.parse(val);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

module.exports = { safeParseJsonArray };
