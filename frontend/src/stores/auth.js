import { defineStore } from 'pinia'
import api from '../api'

/**
 * 全局权限状态（REQ-21 前端实施）
 * 访问模式：
 * - 权限链接：/access?token=xxx
 * - 管理员：?admin=1（会话内记忆）
 */
const ACCESS_TOKEN_KEY = 'devtracker_access_token'
const ADMIN_MODE_KEY = 'devtracker_admin_mode'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '',
    linkName: '',
    permissions: [],     // LinkPermission[]
    loaded: false,       // 是否已加载完成
    isAdmin: false,      // 默认非管理员
    forbiddenReason: ''  // 403 原因：disabled | no_view | invalid
  }),
  getters: {
    /**
     * 检查是否拥有指定资源的指定操作权限
     * @param {string} resource - 资源标识，如 'page:tasks'
     * @param {string} action - 操作类型：'view' | 'create' | 'update' | 'delete'
     */
    hasPermission: (state) => (resource, action = 'view') => {
      if (state.isAdmin) return true
      const perm = state.permissions.find(p => p.resource === resource)
      if (!perm) return false
      const field = `can_${action}`
      return perm[field] === true || perm[field] === 1
    }
  },
  actions: {
    /** 从 URL 初始化权限（routeQuery 来自路由守卫，确保 redirect 场景可读） */
    async init(routeQuery = null) {
      const urlParams = new URLSearchParams(window.location.search)
      const queryToken = routeQuery?.token || urlParams.get('token')
      const queryAdmin = routeQuery?.admin || urlParams.get('admin')

      // 管理员模式显式优先：避免被历史 token 会话劫持
      if (queryAdmin === '1') {
        sessionStorage.setItem(ADMIN_MODE_KEY, '1')
        sessionStorage.removeItem(ACCESS_TOKEN_KEY)
        this.isAdmin = true
        this.token = ''
        this.linkName = ''
        this.permissions = []
        this.forbiddenReason = ''
        this.loaded = true
        return
      }

      // token 优先：一旦是权限链接模式，不应回退到管理员模式
      if (queryToken) {
        sessionStorage.setItem(ACCESS_TOKEN_KEY, queryToken)
        sessionStorage.removeItem(ADMIN_MODE_KEY)
      }

      const token = queryToken || sessionStorage.getItem(ACCESS_TOKEN_KEY) || ''
      if (token) {
        this.token = token
        this.isAdmin = false
        try {
          const res = await api.get(`/permissions/check/${token}`)
          const data = res.data || {}
          this.linkName = data.name || ''
          this.permissions = data.permissions || []
          const hasAnyPageView = this.permissions.some(p => p.resource?.startsWith('page:') && p.can_view)
          this.forbiddenReason = hasAnyPageView ? '' : 'no_view'
        } catch (err) {
          const reason = err?.response?.data?.reason
          if (reason === 'link_disabled') {
            this.forbiddenReason = 'disabled'
          } else {
            this.forbiddenReason = 'invalid'
          }
          // token 无效/停用时，禁止全部
          this.token = ''
          this.linkName = ''
          this.permissions = []
        }
        this.loaded = true
        return
      }

      const adminMode = sessionStorage.getItem(ADMIN_MODE_KEY) === '1'
      if (adminMode) {
        this.isAdmin = true
        this.loaded = true
        return
      }

      // 既不是权限链接，也不是管理员模式 => 访客无权限
      this.isAdmin = false
      this.token = ''
      this.linkName = ''
      this.permissions = []
      this.forbiddenReason = 'invalid'
      this.loaded = true
    },
    /** 清理模式缓存（可用于退出权限模式/管理员模式） */
    clearSessionMode() {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY)
      sessionStorage.removeItem(ADMIN_MODE_KEY)
      this.token = ''
      this.linkName = ''
      this.isAdmin = false
      this.loaded = false
      this.permissions = []
      this.forbiddenReason = ''
    }
  }
})
