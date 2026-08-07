import { defineStore } from 'pinia'
import api from '../api'
import { ROLE_AI_DEV, ROLE_AI_QUALITY, ROLE_VOIP, getRoleDefinitions } from '../utils/roles'

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

function parseRoleBuckets(value) {
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = {} }
  }
  if (!source || Array.isArray(source) || typeof source !== 'object') return {}
  return Object.fromEntries(Object.entries(source).map(([key, rows]) => [key, normalizeRoleList(rows)]))
}

function normalizeGroup(group) {
  const frontend = normalizeRoleList(group.frontend)
  const backend = normalizeRoleList(group.backend)
  const voip = normalizeRoleList(group.voip)
  const testRole = normalizeRoleList(group.test_role)
  const aiDevelopers = normalizeRoleList(group.ai_developers)
  const aiQuality = normalizeRoleList(group.ai_quality)
  const parsedBuckets = parseRoleBuckets(group.role_buckets)
  const roleBuckets = Object.keys(parsedBuckets).length ? parsedBuckets : {
    [ROLE_AI_DEV]: aiDevelopers.length ? aiDevelopers : [...frontend, ...backend],
    [ROLE_VOIP]: voip,
    [ROLE_AI_QUALITY]: aiQuality.length ? aiQuality : testRole
  }
  for (const role of getRoleDefinitions()) {
    if (!roleBuckets[role.key]) roleBuckets[role.key] = []
  }
  return {
    ...group,
    product_managers: parseJsonArray(group.product_managers).map(item => String(item || '').trim()).filter(Boolean),
    frontend,
    backend,
    voip,
    test_role: testRole,
    role_buckets: roleBuckets,
    ai_developers: roleBuckets[ROLE_AI_DEV] || [],
    voip: roleBuckets[ROLE_VOIP] || [],
    ai_quality: roleBuckets[ROLE_AI_QUALITY] || []
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
        const roleTotals = Object.fromEntries(Object.entries(g.role_buckets || {}).map(([key, rows]) => [
          key,
          (Array.isArray(rows) ? rows : []).reduce((sum, person) => sum + (parseFloat(person.hours) || 0), 0)
        ]))
        const aiDevTotal = roleTotals[ROLE_AI_DEV] || 0
        const aiQualityTotal = roleTotals[ROLE_AI_QUALITY] || 0
        const voipTotal = roleTotals[ROLE_VOIP] || 0
        return {
          ...g,
          _roleTotals: roleTotals,
          _aiDevTotal: aiDevTotal,
          _aiQualityTotal: aiQualityTotal,
          _voipTotal: voipTotal,
          _frontendTotal: aiDevTotal,
          _backendTotal: 0,
          _testTotal: aiQualityTotal,
          _rowTotal: Object.values(roleTotals).reduce((sum, value) => sum + value, 0)
        }
      })
    },
    /** 各列合计 */
    columnTotals() {
      const groups = this.groupsWithTotal
      const totals = {}
      for (const group of groups) {
        for (const [key, value] of Object.entries(group._roleTotals || {})) {
          totals[key] = (totals[key] || 0) + value
        }
      }
      return {
        ...totals,
        ai_dev: groups.reduce((s, g) => s + g._aiDevTotal, 0),
        voip: groups.reduce((s, g) => s + g._voipTotal, 0),
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
