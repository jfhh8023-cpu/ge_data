import { defineStore } from 'pinia'
import api from '../api'
import { ROLE_AI_DEV, ROLE_AI_QUALITY, getRoleDefinitions } from '../utils/roles'

const emptyRoleSummary = () => ({
  ...Object.fromEntries(getRoleDefinitions().map(role => [role.key, 0])),
  [ROLE_AI_DEV]: 0,
  [ROLE_AI_QUALITY]: 0,
  frontend: 0,
  backend: 0,
  test: 0
})

export const useStatsStore = defineStore('stats', {
  state: () => ({
    tasks: [],
    records: [],
    matchGroups: [],
    staff: [],
    currentStaff: [],
    roleDefinitions: [],
    summary: { totalHours: 0, recordCount: 0, staffCount: 0, taskCount: 0 },
    /* v1.1.0: 基于 WorkRecord + Staff.role 的聚合统计（REQ-11） */
    roleSummary: emptyRoleSummary(),
    /* v1.1.0: 按 PM 分组的工时分布（REQ-13） */
    pmDistribution: [],
    productManagerRecords: [],
    productDemandDistribution: [],
    demandSources: [],
    progressDetails: null,
    progressDetailsLoading: false,
    loading: false,
    /* 个人统计 */
    personalData: null,
    personalLoading: false,
    /* PM 聚焦统计 */
    pmFocusData: null,
    pmFocusLoading: false
  }),
  actions: {
    /** 部门统计 */
    async fetch({ year, quarter, taskId, pmSort } = {}) {
      this.loading = true
      try {
        const params = {}
        if (year) params.year = year
        if (quarter) params.quarter = quarter
        if (taskId) params.taskId = taskId
        if (pmSort) params.pmSort = pmSort
        const res = await api.get('/stats', { params })
        const data = res.data.data || res.data
        this.tasks = data.tasks || []
        this.records = data.records || []
        this.matchGroups = data.matchGroups || []
        this.staff = data.staff || []
        this.currentStaff = data.currentStaff || data.staff || []
        this.roleDefinitions = data.roleDefinitions || []
        this.summary = data.summary || {}
        this.roleSummary = data.roleSummary || emptyRoleSummary()
        this.pmDistribution = data.pmDistribution || []
        this.productManagerRecords = data.productManagerRecords || []
        this.productDemandDistribution = data.productDemandDistribution || []
        this.demandSources = data.demandSources || []
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
    },
    async fetchProgressDetails(params = {}) {
      this.progressDetailsLoading = true
      try {
        const res = await api.get('/stats/progress-details', { params })
        this.progressDetails = res.data.data || res.data || null
        return this.progressDetails
      } finally { this.progressDetailsLoading = false }
    },
    /** PM 聚焦统计 */
    async fetchPmFocus(pmId, { year, quarter, taskId } = {}) {
      this.pmFocusLoading = true
      try {
        const params = {}
        if (year) params.year = year
        if (quarter) params.quarter = quarter
        if (taskId) params.taskId = taskId
        const res = await api.get(`/stats/pm/${pmId}`, { params })
        this.pmFocusData = res.data.data || res.data
      } finally { this.pmFocusLoading = false }
    }
  }
})
