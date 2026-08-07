import { defineStore } from 'pinia'
import api from '../api'
import { DEFAULT_ROLE_DEFINITIONS, setRoleDefinitions } from '../utils/roles'

function normalizeList(value) {
  const list = Array.isArray(value) && value.length ? value : DEFAULT_ROLE_DEFINITIONS
  return setRoleDefinitions(list)
}

export const useRoleStore = defineStore('roles', {
  state: () => ({
    list: normalizeList(DEFAULT_ROLE_DEFINITIONS),
    loading: false,
    loaded: false
  }),
  getters: {
    options: state => state.list.map(role => ({ value: role.key, label: role.name })),
    byKey: state => key => state.list.find(role => role.key === key) || null
  },
  actions: {
    apply(definitions) {
      this.list = normalizeList(definitions)
      this.loaded = true
    },
    async fetchAll({ force = false } = {}) {
      if (this.loaded && !force) return this.list
      this.loading = true
      try {
        const res = await api.get('/roles')
        this.apply(res.data.data || res.data || [])
      } catch {
        this.apply(this.list.length ? this.list : DEFAULT_ROLE_DEFINITIONS)
      } finally {
        this.loading = false
      }
      return this.list
    },
    async createRole(data) {
      const res = await api.post('/roles', data)
      await this.fetchAll({ force: true })
      return res.data.data || res.data
    },
    async updateRole(key, data) {
      const res = await api.put(`/roles/${key}`, data)
      await this.fetchAll({ force: true })
      return res.data.data || res.data
    }
  }
})
