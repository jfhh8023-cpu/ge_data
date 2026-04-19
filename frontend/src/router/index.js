import { createRouter, createWebHistory } from 'vue-router'

/** 路由 → 资源标识映射（v3.0.0: TaskDetail 独立资源） */
const ROUTE_RESOURCE_MAP = {
  TaskList: 'page:tasks',
  TaskDetail: 'page:task_detail',
  Report: 'page:report',
  Stats: 'page:stats',
  Personnel: 'page:personnel',
  Permissions: 'page:permissions'
}

const RESOURCE_FALLBACK_ROUTES = [
  { resource: 'page:tasks', routeName: 'TaskList' },
  { resource: 'page:report', routeName: 'Report' },
  { resource: 'page:stats', routeName: 'Stats' },
  { resource: 'page:personnel', routeName: 'Personnel' },
  { resource: 'page:permissions', routeName: 'Permissions' }
]

const routes = [
  {
    path: '/',
    redirect: to => ({ path: '/tasks', query: to.query })
  },
  {
    path: '/access',
    redirect: to => ({ path: '/tasks', query: to.query })
  },
  {
    path: '/tasks',
    name: 'TaskList',
    component: () => import('../views/TaskList.vue'),
    meta: { title: '任务收集' }
  },
  {
    path: '/tasks/:id',
    name: 'TaskDetail',
    component: () => import('../views/TaskDetail.vue'),
    meta: { title: '任务详情', showBack: true }
  },
  {
    path: '/report',
    name: 'Report',
    component: () => import('../views/ReportPage.vue'),
    meta: { title: '需求工时统计' }
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('../views/StatsPage.vue'),
    meta: { title: '周期统计（季度）' }
  },
  {
    path: '/personnel',
    name: 'Personnel',
    component: () => import('../views/PersonnelPage.vue'),
    meta: { title: '团队人员', showBack: true }
  },
  {
    path: '/permissions',
    name: 'Permissions',
    component: () => import('../views/PermissionPage.vue'),
    meta: { title: '权限控制', showBack: true }
  },
  {
    path: '/fill/:token',
    name: 'Fill',
    component: () => import('../views/FillPage.vue'),
    meta: { title: '填写工时', layout: 'fill' }
  },
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('../views/ForbiddenPage.vue'),
    meta: { title: '无权限' }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

/** 路由守卫：权限校验（REQ-21） */
router.beforeEach(async (to) => {
  document.title = `${to.meta.title || 'DevTracker'} - DevTracker`

  // 填写页和 403 页不做权限校验
  if (to.name === 'Fill' || to.name === 'Forbidden') return

  // 动态导入 auth store（避免循环依赖）
  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()

  // 首次加载权限（传入路由 query 确保 redirect 场景下 token 可读）
  if (!authStore.loaded) {
    await authStore.init(to.query)
  }

  // 管理员直接放行
  if (authStore.isAdmin) return

  // 检查页面权限
  const resource = ROUTE_RESOURCE_MAP[to.name]
  if (resource && !authStore.hasPermission(resource, 'view')) {
    // 权限链接场景：若当前页无权，尝试跳转到该 token 的首个可访问页面
    const firstAllowed = RESOURCE_FALLBACK_ROUTES.find(item =>
      authStore.hasPermission(item.resource, 'view')
    )
    if (firstAllowed) {
      return { name: firstAllowed.routeName, query: to.query }
    }
    return { name: 'Forbidden' }
  }
})

export default router
