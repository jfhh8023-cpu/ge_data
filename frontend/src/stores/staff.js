import { defineStore } from 'pinia'
import api from '../api'

export const useStaffStore = defineStore('staff', {
  state: () => ({
    list: [],
    loading: false
  }),
  getters: {
    activeStaff: (state) => state.list.filter(s => s.is_active),
    byRole: (state) => (role) => state.list.filter(s => s.role === role && s.is_active),
    frontendStaff() { return this.byRole('frontend') },
    backendStaff() { return this.byRole('backend') },
    testStaff() { return this.byRole('test') }
  },
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const res = await api.get('/staff')
        this.list = res.data
      } finally { this.loading = false }
    },
    async create(data) {
      const res = await api.post('/staff', data)
      this.list.push(res.data)
      return res.data
    },
    async update(id, data) {
      const res = await api.put(`/staff/${id}`, data)
      const idx = this.list.findIndex(s => s.id === id)
      if (idx !== -1) this.list[idx] = res.data
      return res.data
    },
    async remove(id) {
      await api.delete(`/staff/${id}`)
      this.list = this.list.filter(s => s.id !== id)
    }
  }
})
