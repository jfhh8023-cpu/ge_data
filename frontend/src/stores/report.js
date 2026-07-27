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
  const frontend = normalizeRoleList(group.frontend)
  const backend = normalizeRoleList(group.backend)
  const testRole = normalizeRoleList(group.test_role)
  const aiDevelopers = normalizeRoleList(group.ai_developers)
  const aiQuality = normalizeRoleList(group.ai_quality)
  return {
    ...group,
    product_managers: parseJsonArray(group.product_managers).map(item => String(item || '').trim()).filter(Boolean),
    frontend,
    backend,
    test_role: testRole,
    ai_developers: aiDevelopers.length ? aiDevelopers : [...frontend, ...backend],
    ai_quality: aiQuality.length ? aiQuality : testRole
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
        const dev = Array.isArray(g.ai_developers) ? g.ai_developers : []
        const qa = Array.isArray(g.ai_quality) ? g.ai_quality : []
        const aiDevTotal = dev.reduce((s, p) => s + (parseFloat(p.hours) || 0), 0)
        const aiQualityTotal = qa.reduce((s, p) => s + (parseFloat(p.hours) || 0), 0)
        return {
          ...g,
          _aiDevTotal: aiDevTotal,
          _aiQualityTotal: aiQualityTotal,
          _frontendTotal: aiDevTotal,
          _backendTotal: 0,
          _testTotal: aiQualityTotal,
          _rowTotal: aiDevTotal + aiQualityTotal
        }
      })
    },
    /** 各列合计 */
    columnTotals() {
      const groups = this.groupsWithTotal
      return {
        ai_dev: groups.reduce((s, g) => s + g._aiDevTotal, 0),
        ai_quality: groups.reduce((s, g) => s + g._aiQualityTotal, 0),
        frontend: groups.reduce((s, g) => s + g._aiDevTotal, 0),
        backend: 0,
        test: groups.reduce((s, g) => s + g._aiQualityTotal, 0),
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
