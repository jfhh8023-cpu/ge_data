/**
 * DingtalkService — 钉钉网页版自动化服务
 *
 * 职责：
 *  - 通过 Playwright headless Chromium 操控 im.dingtalk.com
 *  - getQrcode()：截取登录页二维码图片，返回 base64
 *  - pollLogin()：检测扫码是否完成，完成后保存 storageState
 *  - sendMessage()：搜索联系人 → 输入 → 发送私聊消息（串行队列）
 *  - isLoggedIn() / getSessionAge()：会话状态查询
 *
 * 会话文件：backend/src/config/dingtalk-session.json（已加入 .gitignore）
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const SELECTORS = require('../config/dingtalk-selectors');

const SESSION_PATH = path.join(__dirname, '../config/dingtalk-session.json');
const DINGTALK_URL = 'https://im.dingtalk.com';

class DingtalkService {
  constructor() {
    // 串行发送队列
    this._sendQueue = Promise.resolve();
    // 扫码登录的临时浏览器实例（等待用户扫码期间保持）
    this._loginBrowser = null;
    this._loginContext = null;
    this._loginDone = false;
    this._loginError = null;
  }

  /* ===== 状态查询 ===== */

  isLoggedIn() {
    return fs.existsSync(SESSION_PATH);
  }

  getSessionAge() {
    if (!this.isLoggedIn()) return null;
    const stat = fs.statSync(SESSION_PATH);
    const days = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
    return days === 0 ? '今天登录' : `${days} 天前登录`;
  }

  /* ===== 二维码获取（headless 截图）===== */

  /**
   * 启动 headless 浏览器，打开钉钉登录页，截取二维码图片。
   * 同时在后台监听扫码完成（URL 跳转），完成后自动保存会话。
   * @returns {Promise<string>} base64 编码的 PNG 图片（data:image/png;base64,...）
   */
  async getQrcode() {
    // 如果上一次登录流程还在等待，先关闭
    await this._cleanupLoginBrowser();

    this._loginDone = false;
    this._loginError = null;

    this._loginBrowser = await chromium.launch({ headless: true });
    this._loginContext = await this._loginBrowser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await this._loginContext.newPage();

    await page.goto(DINGTALK_URL, { waitUntil: 'domcontentloaded' });

    // 等待二维码出现
    let qrcodeBase64;
    try {
      // 优先截取二维码 img 元素
      const qrImg = page.locator(SELECTORS.QR_CODE_IMG).first();
      const qrWrapper = page.locator(SELECTORS.QR_CODE_WRAPPER).first();

      let target = null;
      try {
        await qrImg.waitFor({ timeout: 10000 });
        target = qrImg;
      } catch {
        await qrWrapper.waitFor({ timeout: 5000 });
        target = qrWrapper;
      }

      const buf = await target.screenshot({ type: 'png' });
      qrcodeBase64 = 'data:image/png;base64,' + buf.toString('base64');
    } catch {
      // 降级：截取整个视口并裁剪登录区域
      const buf = await page.screenshot({ type: 'png', clip: { x: 400, y: 100, width: 480, height: 500 } });
      qrcodeBase64 = 'data:image/png;base64,' + buf.toString('base64');
    }

    // 后台异步监听扫码完成
    this._waitForScan(page);

    return qrcodeBase64;
  }

  /**
   * 后台监听扫码跳转，完成后保存会话文件。
   */
  async _waitForScan(page) {
    try {
      // 等待 URL 跳转到聊天主界面（最多 3 分钟）
      await page.waitForFunction(
        () => !window.location.href.includes('login') && !window.location.href.includes('passport'),
        { timeout: 180_000 }
      );
      // 额外等待确保 Cookie 完整写入
      await page.waitForTimeout(2000);
      await this._loginContext.storageState({ path: SESSION_PATH });
      this._loginDone = true;
      console.log('[DingTalk] 扫码登录成功，会话已保存');
    } catch (err) {
      this._loginError = err.message.includes('Timeout') ? '扫码超时（3分钟），请重新获取二维码' : err.message;
      console.error('[DingTalk] 扫码等待失败:', this._loginError);
    } finally {
      await this._cleanupLoginBrowser();
    }
  }

  /* ===== 轮询扫码状态 ===== */

  /**
   * 前端每 2 秒调用一次。
   * @returns {{ done: boolean, error?: string }}
   */
  pollLogin() {
    if (this._loginError) {
      const err = this._loginError;
      this._loginError = null;
      return { done: false, error: err };
    }
    return { done: this._loginDone };
  }

  async _cleanupLoginBrowser() {
    if (this._loginBrowser) {
      try { await this._loginBrowser.close(); } catch {}
      this._loginBrowser = null;
      this._loginContext = null;
    }
  }

  /* ===== 发送私聊消息 ===== */

  /**
   * 发送私聊消息（加入串行队列，防止并发）。
   * @param {string} staffName  联系人姓名
   * @param {string} messageText 消息正文（支持 \n 换行）
   */
  sendMessage(staffName, messageText) {
    return new Promise((resolve, reject) => {
      this._sendQueue = this._sendQueue
        .then(() => this._doSend(staffName, messageText))
        .then(resolve)
        .catch(reject);
    });
  }

  async _doSend(staffName, messageText) {
    if (!this.isLoggedIn()) {
      const err = new Error('未登录钉钉，请先扫码登录');
      err.code = 2;
      throw err;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: SESSION_PATH });
    const page = await context.newPage();

    try {
      await page.goto(DINGTALK_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20_000 });

      // 检测会话是否过期（跳回登录页）
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('passport')) {
        fs.unlinkSync(SESSION_PATH);
        const err = new Error('钉钉会话已过期，请重新扫码登录');
        err.code = 2;
        throw err;
      }

      // 等待主界面加载
      await page.waitForSelector(SELECTORS.SIDEBAR, { timeout: 15_000 });

      // 点击搜索框并输入姓名
      const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
      await searchInput.waitFor({ timeout: 10_000 });
      await searchInput.click();
      await page.waitForTimeout(300);
      await searchInput.fill(staffName);
      await page.waitForTimeout(1800);

      // 在搜索结果中找联系人
      const resultItem = page.locator(SELECTORS.SEARCH_RESULT_ITEM)
        .filter({ hasText: staffName })
        .first();

      if (await resultItem.count() === 0) {
        const err = new Error(`未在钉钉通讯录中找到联系人：${staffName}`);
        err.code = 3;
        throw err;
      }
      await resultItem.click();
      await page.waitForTimeout(1200);

      // 输入消息
      const msgInput = page.locator(SELECTORS.MSG_INPUT).first();
      await msgInput.waitFor({ timeout: 10_000 });
      await msgInput.click();

      // 逐行输入（Shift+Enter 换行，Enter 发送）
      const lines = messageText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        }
        await page.keyboard.type(lines[i], { delay: 20 });
      }

      // 发送
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // 续期会话
      await context.storageState({ path: SESSION_PATH });

      return { success: true, message: `已发送给 ${staffName}` };
    } finally {
      await browser.close();
    }
  }
}

module.exports = new DingtalkService();
