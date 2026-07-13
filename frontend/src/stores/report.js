import { defineStore } from 'pinia'
import api from '../api'

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  let text = value.trim()
  if (!text) return []
  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
      if (typeof parsed === 'string') {
        text = parsed
        continue
      }
      return []
    } catch {
      return []
    }
  }
  return []
}

function normalizeRoleList(value) {
  return parseJsonArray(value)
    .map(item => ({
      staffName: String(item?.staffName || item?.name || '').trim(),
      hours: Number(item?.hours || 0)
    }))
    .filter(item => item.staffName || item.hours > 0)
}

function normalizeGroup(group) {
  return {
    ...group,
    product_managers: parseJsonArray(group.product_managers).map(item => String(item || '').trim()).filter(Boolean),
    frontend: normalizeRoleList(group.frontend),
    backend: normalizeRoleList(group.backend),
    test_role: normalizeRoleList(group.test_role)
  }
}

export const useReportStore = defineStore('report', {
  state: () => ({
    matchGroups: [],
    loading: false
  }),
  getters: {
    /** 计算每行工时总计 */
    groupsWithTotal: (state) => {
      return state.matchGroups.map(g => {
        const fe = Array.isArray(g.frontend) ? g.frontend : []
        const be = Array.isArray(g.backend) ? g.backend : []
        const te = Array.isArray(g.test_role) ? g.test_role : []
        const frontendTotal = fe.reduce((s, p) => s + (parseFloat(p.hours) || 0), 0)
        const backendTotal = be.reduce((s, p) => s + (parseFloat(p.hours) || 0), 0)
        const testTotal = te.reduce((s, p) => s + (parseFloat(p.hours) || 0), 0)
        return {
          ...g,
          _frontendTotal: frontendTotal,
          _backendTotal: backendTotal,
          _testTotal: testTotal,
          _rowTotal: frontendTotal + backendTotal + testTotal
        }
      })
    },
    /** 各列合计 */
    columnTotals() {
      const groups = this.groupsWithTotal
      return {
        frontend: groups.reduce((s, g) => s + g._frontendTotal, 0),
        backend: groups.reduce((s, g) => s + g._backendTotal, 0),
        test: groups.reduce((s, g) => s + g._testTotal, 0),
        total: groups.reduce((s, g) => s + g._rowTotal, 0)
      }
    }
  },
  actions: {
    async fetchByTask(taskId) {
      this.loading = true
      try {
        const res = await api.get('/report', { params: { taskId } })
        this.matchGroups = (res.data.data || res.data || []).map(normalizeGroup)
      } finally { this.loading = false }
    },
    async triggerMatch(taskId) {
      this.loading = true
      try {
        const res = await api.post('/report/match', null, { params: { taskId } })
        await this.fetchByTask(taskId)
        return res.data
      } finally { this.loading = false }
    },
    async updateRemark(id, remark) {
      await api.put(`/report/${id}`, { remark })
      const idx = this.matchGroups.findIndex(g => g.id === id)
      if (idx !== -1) this.matchGroups[idx].remark = remark
    },
    async addManualRow(taskId) {
      const res = await api.post('/report/manual-row', { task_id: taskId })
      const newRow = normalizeGroup(res.data.data || res.data)
      this.matchGroups.push(newRow)
      return newRow
    },
    async deleteRow(id) {
      await api.delete(`/report/${id}`)
      this.matchGroups = this.matchGroups.filter(g => g.id !== id)
    },
    async updateRow(id, data) {
      const res = await api.put(`/report/${id}`, data)
      const saved = normalizeGroup(res.data.data || res.data || data)
      const idx = this.matchGroups.findIndex(g => g.id === id)
      if (idx !== -1) Object.assign(this.matchGroups[idx], saved)
      return saved
    }
  }
})
