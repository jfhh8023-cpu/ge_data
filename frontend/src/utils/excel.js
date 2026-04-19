/**
 * Excel 工具函数 — 前端导入/导出通用封装
 * v2.0.0: 导入导出功能新增
 */
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import api from '../api'

/**
 * 解析上传的 Excel 文件
 * @param {File} file - 用户选择的文件对象
 * @returns {Promise<{ headers: string[], rows: Array<object> }>}
 */
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 })

        if (jsonData.length < 1) {
          reject(new Error('Excel 文件为空'))
          return
        }

        const headers = jsonData[0].map(h => String(h || '').trim())
        const rows = []
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i]
          // 跳过全空行
          if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) continue
          const obj = {}
          headers.forEach((h, idx) => {
            obj[h] = row[idx] !== undefined && row[idx] !== null ? row[idx] : ''
          })
          rows.push(obj)
        }

        resolve({ headers, rows })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 校验 Excel 列头是否匹配
 * @param {string[]} actual - 实际列头
 * @param {string[]} expected - 期望列头
 * @returns {boolean}
 */
export function validateHeaders(actual, expected) {
  if (actual.length < expected.length) return false
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) return false
  }
  return true
}

/**
 * 生成并下载 Excel 文件
 * @param {object} options
 * @param {string} options.filename - 文件名（含 .xlsx）
 * @param {Array<{ name: string, data: Array<Array<any>>, colWidths?: number[] }>} options.sheets - Sheet 数据
 */
export function generateAndDownloadExcel({ filename, sheets }) {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.data)
    if (sheet.colWidths) {
      ws['!cols'] = sheet.colWidths.map(w => ({ wch: w }))
    }
    if (sheet.merges) {
      ws['!merges'] = sheet.merges
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveAs(blob, filename)
  return blob
}

/**
 * 上传 Excel 文件到后端存档
 * @param {File|Blob} file - 文件对象
 * @param {object} meta - 元数据
 * @param {string} meta.source_page - 来源页面
 * @param {string} meta.upload_type - 'import' | 'export'
 * @param {string} [meta.task_id] - 关联任务ID
 * @param {string} [meta.staff_id] - 关联人员ID
 * @param {string} [meta.filename] - 文件名（Blob 时需要）
 */
export async function uploadExcelToServer(file, meta) {
  const formData = new FormData()
  if (file instanceof Blob && !(file instanceof File)) {
    formData.append('file', file, meta.filename || 'export.xlsx')
  } else {
    formData.append('file', file)
  }
  formData.append('source_page', meta.source_page)
  formData.append('upload_type', meta.upload_type)
  if (meta.task_id) formData.append('task_id', meta.task_id)
  if (meta.staff_id) formData.append('staff_id', meta.staff_id)

  // 直接用 axios 实例（需要覆盖 Content-Type）
  const baseURL = import.meta.env.MODE === 'production' ? '/devtracker/api' : '/api'
  const res = await fetch(`${baseURL}/excel/upload`, {
    method: 'POST',
    body: formData
  })
  return res.json()
}

/**
 * 下载后端模板
 * @param {string} page - 'fill' | 'task-detail' | 'report'
 */
export function downloadTemplate(page) {
  const baseURL = import.meta.env.MODE === 'production' ? '/devtracker/api' : '/api'
  window.open(`${baseURL}/excel/template/${page}`, '_blank')
}

/**
 * 将 Canvas 转为 PNG ArrayBuffer（用于嵌入 Excel）
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<ArrayBuffer>}
 */
export function canvasToArrayBuffer(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsArrayBuffer(blob)
    }, 'image/png')
  })
}
