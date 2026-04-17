/**
 * 钉钉网页版 DOM 选择器配置
 *
 * 钉钉网页版更新时仅需修改此文件，无需改动业务逻辑。
 * 选择器优先级：role/placeholder > text > data-* > class（最不稳定）
 *
 * 调试方式：
 *   npx playwright codegen https://im.dingtalk.com
 *   或在 DingtalkService 中设置 headless: false + page.pause()
 */
module.exports = {
  // 登录页二维码图片元素（用于截图）
  QR_CODE_IMG: 'img[class*="qrcode"], img[src*="qrcode"], .login-qrcode img, [class*="QRCode"] img, canvas[class*="qr"]',

  // 登录页二维码容器（备用，整体截图）
  QR_CODE_WRAPPER: '[class*="qrcode-wrap"], [class*="qr-wrap"], [class*="QRCode"], .login-qrcode',

  // 侧边栏会话列表（确认主界面已加载完成）
  SIDEBAR: '#sidebar-session-list, [class*="session-list"], [class*="sidebar"], [class*="left-panel"]',

  // 搜索按钮/搜索输入框（顶部搜索入口）
  SEARCH_INPUT: '[placeholder*="搜索"], [placeholder*="Search"], input[class*="search"]',

  // 搜索结果列表中的单个条目
  SEARCH_RESULT_ITEM: '[class*="search-result"] [class*="item"], [class*="search-panel"] [class*="contact"], [class*="result-item"], [class*="search-item"]',

  // 聊天消息输入框（富文本 contenteditable）
  MSG_INPUT: '[contenteditable="true"][class*="editor"], [contenteditable="true"][class*="input"], #MessageEditor, [class*="chat-editor"], [class*="message-input"] [contenteditable="true"]',
};
