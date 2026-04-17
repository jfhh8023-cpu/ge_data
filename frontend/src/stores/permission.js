import { defineStore } from 'pinia'
import api from '../api'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    links: [],
    resources: [],
    loading: false
  }),
  actions: {
    /** 获取全部访问链接 */
    async fetchAll() {
      this.loading = true
      try {
        const res = await api.get('/permissions')
        const data = res.data.data || res.data
        this.links = data.links || []
        this.resources = data.resources || []
      } finally { this.loading = false }
    },
    /** 创建访问链接 */
    async create(name) {
      const res = await api.post('/permissions', { name })
      await this.fetchAll()
      return res.data.data
    },
    /** 更新链接信息 */
    async update(id, payload) {
      await api.put(`/permissions/${id}`, payload)
      await this.fetchAll()
    },
    /** 删除访问链接 */
    async remove(id) {
      await api.delete(`/permissions/${id}`)
      await this.fetchAll()
    },
    /** 更新权限配置 */
    async updatePermissions(linkId, permissions) {
      await api.put(`/permissions/${linkId}/permissions`, { permissions })
      await this.fetchAll()
    }
  }
})
