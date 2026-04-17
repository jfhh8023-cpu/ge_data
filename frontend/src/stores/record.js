import { defineStore } from 'pinia'
import api from '../api'

export const useRecordStore = defineStore('record', {
  state: () => ({
    list: [],
    loading: false
  }),
  actions: {
    async fetchByTask(taskId) {
      this.loading = true
      try {
        const res = await api.get('/records', { params: { taskId } })
        this.list = res.data
      } finally { this.loading = false }
    },
    async create(data) {
      const res = await api.post('/records', data)
      this.list.push(res.data)
      return res.data
    },
    async update(id, data) {
      const res = await api.put(`/records/${id}`, data)
      const idx = this.list.findIndex(r => r.id === id)
      if (idx !== -1) this.list[idx] = res.data
      return res.data
    },
    async remove(id) {
      await api.delete(`/records/${id}`)
      this.list = this.list.filter(r => r.id !== id)
    }
  }
})
