import { defineStore } from 'pinia'
import api from '../api'
import { ROLE_AI_DEV, ROLE_VOIP, ROLE_AI_QUALITY, normalizeRole } from '../utils/roles'

function isActiveLike(person) {
  return (person?.employment_status || (person?.is_active === false ? 'resigned' : 'active')) !== 'resigned'
}

export const useStaffStore = defineStore('staff', {
  state: () => ({
    list: [],
    loading: false
  }),
  getters: {
    activeStaff: (state) => state.list.filter(isActiveLike),
    byRole: (state) => (role) => state.list.filter(s => normalizeRole(s.role) === normalizeRole(role) && isActiveLike(s)),
    aiDevStaff() { return this.byRole(ROLE_AI_DEV) },
    voipStaff() { return this.byRole(ROLE_VOIP) },
    aiQualityStaff() { return this.byRole(ROLE_AI_QUALITY) },
    frontendStaff() { return this.aiDevStaff },
    backendStaff() { return this.aiDevStaff },
    testStaff() { return this.aiQualityStaff }
  },
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const res = await api.get('/staff')
        this.list = res.data.map(item => ({ ...item, role: normalizeRole(item.role) }))
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
