import { defineStore } from 'pinia'
import api from '../api'

export const useStatsStore = defineStore('stats', {
  state: () => ({
    tasks: [],
    records: [],
    matchGroups: [],
    staff: [],
    summary: { totalHours: 0, recordCount: 0, staffCount: 0, taskCount: 0 },
    /* v1.1.0: 基于 WorkRecord + Staff.role 的聚合统计（REQ-11） */
    roleSummary: { frontend: 0, backend: 0, test: 0 },
    /* v1.1.0: 按 PM 分组的工时分布（REQ-13） */
    pmDistribution: [],
    loading: false,
    /* 个人统计 */
    personalData: null,
    personalLoading: false
  }),
  actions: {
    /** 部门统计 */
    async fetch({ year, quarter, taskId } = {}) {
      this.loading = true
      try {
        const params = {}
        if (year) params.year = year
        if (quarter) params.quarter = quarter
        if (taskId) params.taskId = taskId
        const res = await api.get('/stats', { params })
        const data = res.data.data || res.data
        this.tasks = data.tasks || []
        this.records = data.records || []
        this.matchGroups = data.matchGroups || []
        this.staff = data.staff || []
        this.summary = data.summary || {}
        this.roleSummary = data.roleSummary || { frontend: 0, backend: 0, test: 0 }
        this.pmDistribution = data.pmDistribution || []
      } finally { this.loading = false }
    },
    /** 个人统计 */
    async fetchPersonal(staffId, { year, quarter, taskId } = {}) {
      this.personalLoading = true
      try {
        const params = {}
        if (year) params.year = year
        if (quarter) params.quarter = quarter
        if (taskId) params.taskId = taskId
        const res = await api.get(`/stats/personal/${staffId}`, { params })
        this.personalData = res.data.data || res.data
      } finally { this.personalLoading = false }
    }
  }
})
