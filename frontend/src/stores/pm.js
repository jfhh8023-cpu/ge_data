import { defineStore } from 'pinia'
import api from '../api'

export const usePmStore = defineStore('pm', {
  state: () => ({
    list: [],
    loading: false
  }),
  getters: {
    activePms: (state) => state.list.filter(pm => pm.is_active),
    /** 获取 PM 名称列表（用于下拉选择） */
    nameList: (state) => state.list.filter(pm => pm.is_active).map(pm => pm.name)
  },
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const res = await api.get('/pm')
        this.list = res.data
      } finally { this.loading = false }
    },
    async create(data) {
      const res = await api.post('/pm', data)
      this.list.push(res.data)
      return res.data
    },
    async update(id, data) {
      const res = await api.put(`/pm/${id}`, data)
      const idx = this.list.findIndex(p => p.id === id)
      if (idx !== -1) this.list[idx] = res.data
      return res.data
    },
    async remove(id) {
      await api.delete(`/pm/${id}`)
      this.list = this.list.filter(p => p.id !== id)
    }
  }
})
