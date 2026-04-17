import { defineStore } from 'pinia'
import api from '../api'

export const useTaskStore = defineStore('task', {
  state: () => ({
    list: [],
    current: null,
    loading: false
  }),
  getters: {
    /** 按年份→季度分组（跨年周用 end_date 判定季度归属） */
    grouped: (state) => {
      const groups = {}
      for (const task of state.list) {
        const y = task.year
        // 用 end_date 判定季度，解决跨年周（如第1周 start_date=2025-12-28）归属问题
        const refDate = task.end_date || task.start_date
        const m = new Date(refDate).getMonth() + 1
        const q = m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'
        const key = `${y}-${q}`
        if (!groups[key]) groups[key] = { year: y, quarter: q, label: `${y}年 ${q}`, tasks: [] }
        groups[key].tasks.push(task)
      }
      return Object.values(groups).sort((a, b) => b.year - a.year || b.quarter.localeCompare(a.quarter))
    }
  },
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const res = await api.get('/tasks')
        this.list = res.data
      } finally { this.loading = false }
    },
    async fetchDetail(id) {
      this.loading = true
      try {
        const res = await api.get(`/tasks/${id}`)
        this.current = res.data
        return res.data
      } finally { this.loading = false }
    },
    async create(data) {
      const res = await api.post('/tasks', data)
      this.list.unshift(res.data)
      return res.data
    },
    async generateLinks(taskId) {
      const res = await api.post(`/tasks/${taskId}/generate-links`)
      return res
    },
    async update(id, data) {
      const res = await api.put(`/tasks/${id}`, data)
      const idx = this.list.findIndex(t => t.id === id)
      if (idx !== -1) Object.assign(this.list[idx], res.data)
      return res.data
    },
    async remove(id) {
      await api.delete(`/tasks/${id}`)
      this.list = this.list.filter(t => t.id !== id)
    },
    async updateStatus(id, status) {
      const res = await api.put(`/tasks/${id}`, { status })
      const idx = this.list.findIndex(t => t.id === id)
      if (idx !== -1) this.list[idx].status = status
      return res.data
    }
  }
})
