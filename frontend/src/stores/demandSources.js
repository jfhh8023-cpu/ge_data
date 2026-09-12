import { defineStore } from 'pinia'
import api from '../api'

export const DEFAULT_DEMAND_SOURCES = [
  { id: 'legacy-internal', name: '内部需求', color: '#165DFF', sort_order: 10, is_active: true, is_system: true },
  { id: 'legacy-customer', name: '客户需求', color: '#00B42A', sort_order: 20, is_active: true, is_system: true },
  { id: 'legacy-service', name: '对外服务', color: '#F77234', sort_order: 30, is_active: true, is_system: true },
  { id: 'legacy-other', name: '其他需求', color: '#0E9384', sort_order: 40, is_active: true, is_system: true }
]

function normalize(list) {
  const source = Array.isArray(list) && list.length ? list : DEFAULT_DEMAND_SOURCES
  return source.map(item => ({
    id: String(item.id || item.name),
    name: String(item.name || '').trim(),
    color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? String(item.color).toUpperCase() : '#86909C',
    sort_order: Number(item.sort_order || 0),
    is_active: item.is_active !== false,
    is_system: Boolean(item.is_system)
  })).filter(item => item.name).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export const useDemandSourceStore = defineStore('demandSources', {
  state: () => ({ list: normalize(DEFAULT_DEMAND_SOURCES), loading: false, loaded: false }),
  getters: {
    activeList: state => state.list.filter(item => item.is_active),
    activeNames: state => state.list.filter(item => item.is_active).map(item => item.name),
    byName: state => name => state.list.find(item => item.name === name) || null
  },
  actions: {
    apply(list) { this.list = normalize(list); this.loaded = true; return this.list },
    async fetchAll({ force = false, includeInactive = false } = {}) {
      if (this.loaded && !force && !includeInactive) return this.list
      this.loading = true
      try {
        const res = await api.get('/demand-sources', { params: includeInactive ? { includeInactive: 1 } : {} })
        this.apply(res.data.data || res.data || [])
      } finally { this.loading = false }
      return this.list
    },
    async create(data) { const res = await api.post('/demand-sources', data); await this.fetchAll({ force: true, includeInactive: true }); return res.data.data || res.data },
    async update(id, data) { const res = await api.put(`/demand-sources/${id}`, data); await this.fetchAll({ force: true, includeInactive: true }); return res.data.data || res.data },
    async remove(id) { const res = await api.delete(`/demand-sources/${id}`); await this.fetchAll({ force: true, includeInactive: true }); return res.data.data || res.data }
  }
})
