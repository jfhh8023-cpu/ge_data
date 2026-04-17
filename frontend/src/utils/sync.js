/**
 * 跨页面数据同步广播
 * 使用 BroadcastChannel API 实现多标签页间实时通知
 *
 * 使用方式：
 *   发送端：broadcastDataChange('work_record_changed', { taskId })
 *   接收端：onDataChange('work_record_changed', callback)  → 返回 cleanup 函数
 */

const CHANNEL_NAME = 'devtracker_sync'

/** 事件类型常量 */
export const SYNC_EVENTS = {
  WORK_RECORD_CHANGED: 'work_record_changed'
}

/** 发送数据变更通知 */
export function broadcastDataChange(event, payload = {}) {
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME)
    ch.postMessage({ event, payload, timestamp: Date.now() })
    ch.close()
  } catch {
    // BroadcastChannel 不可用时静默失败
  }
}

/**
 * 监听数据变更通知
 * @param {string} event 事件类型
 * @param {Function} callback 回调函数
 * @returns {Function} cleanup 清理函数（在 onUnmounted 中调用）
 */
export function onDataChange(event, callback) {
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME)
    ch.onmessage = (e) => {
      if (e.data?.event === event) {
        callback(e.data.payload)
      }
    }
    return () => ch.close()
  } catch {
    return () => {}
  }
}
