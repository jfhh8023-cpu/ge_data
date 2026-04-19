<script setup>
/**
 * AppHeader — 穹顶导航栏
 * 导航规则：任务清单 | 汇总报表 | 周期统计 + [新建收集] [管理员] [团]
 */
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import CreateTaskModal from './CreateTaskModal.vue'
import { APP_VERSION } from '../version'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

/** 主导航配置 */
const NAV_ITEMS = [
  { path: '/tasks', label: '任务收集', resource: 'page:tasks' },
  { path: '/report', label: '需求工时统计', resource: 'page:report' },
  { path: '/stats', label: '周期统计（季度）', resource: 'page:stats' }
]

/** 根据权限过滤导航项 */
const visibleNavItems = computed(() => {
  return NAV_ITEMS.filter(item => authStore.hasPermission(item.resource, 'view'))
})

const currentPath = computed(() => route.path)
const showCreateModal = ref(false)

function isActive(path) {
  return currentPath.value === path || currentPath.value.startsWith(path + '/')
}

function goHome() {
  router.push('/tasks')
}

function goPersonnel() {
  router.push('/personnel')
}

function goPermissions() {
  router.push('/permissions')
}

function handleTaskCreated() {
  // 创建成功后跳转到任务清单并刷新
  router.push('/tasks')
}
</script>

<template>
  <header class="dt-header">
    <div class="dt-header-inner">
      <!-- Logo —— 追踪雷达风格 -->
      <a class="dt-logo" @click.prevent="goHome">
        <span class="dt-logo-icon-wrap">
          <svg class="dt-logo-svg" viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#165DFF"/>
                <stop offset="100%" stop-color="#722ED1"/>
              </linearGradient>
            </defs>
            <!-- 外圈 -->
            <circle cx="16" cy="16" r="14" fill="none" stroke="url(#logoGrad)" stroke-width="1.8" opacity="0.35"/>
            <!-- 中圈 -->
            <circle cx="16" cy="16" r="9" fill="none" stroke="url(#logoGrad)" stroke-width="1.5" opacity="0.55"/>
            <!-- 内圈 -->
            <circle cx="16" cy="16" r="4.5" fill="none" stroke="url(#logoGrad)" stroke-width="1.5" opacity="0.7"/>
            <!-- 中心亮点 -->
            <circle cx="16" cy="16" r="2" fill="url(#logoGrad)"/>
            <!-- 十字准线 -->
            <line x1="16" y1="1" x2="16" y2="7" stroke="url(#logoGrad)" stroke-width="1.2" opacity="0.3" stroke-linecap="round"/>
            <line x1="16" y1="25" x2="16" y2="31" stroke="url(#logoGrad)" stroke-width="1.2" opacity="0.3" stroke-linecap="round"/>
            <line x1="1" y1="16" x2="7" y2="16" stroke="url(#logoGrad)" stroke-width="1.2" opacity="0.3" stroke-linecap="round"/>
            <line x1="25" y1="16" x2="31" y2="16" stroke="url(#logoGrad)" stroke-width="1.2" opacity="0.3" stroke-linecap="round"/>
            <!-- 扫描线（旋转动画） -->
            <line x1="16" y1="16" x2="16" y2="3" stroke="url(#logoGrad)" stroke-width="1.8" stroke-linecap="round" opacity="0.65">
              <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="4s" repeatCount="indefinite"/>
            </line>
            <!-- 扫描扇形拖影 -->
            <path d="M16,16 L16,3 A13,13 0 0,1 27.26,9.5 Z" fill="url(#logoGrad)" opacity="0.08">
              <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="4s" repeatCount="indefinite"/>
            </path>
          </svg>
        </span>
        <span class="dt-logo-text">DevTracker</span>
        <span style="font-size:10px; color:var(--color-text-4); margin-left:4px; font-weight:400;">{{ APP_VERSION }}</span>
      </a>

      <!-- 主导航 -->
      <nav class="dt-nav">
        <router-link
          v-for="item in visibleNavItems"
          :key="item.path"
          :to="item.path"
          class="dt-nav-item"
          :class="{ active: isActive(item.path) }"
        >
          {{ item.label }}
        </router-link>
      </nav>

      <!-- 右侧操作区 -->
      <div class="dt-user-actions">
        <button v-if="authStore.hasPermission('btn:tasks:create', 'create')" class="dt-btn dt-btn-primary dt-btn-sm" @click="showCreateModal = true">
          + 新建收集
        </button>
        <span class="dt-avatar">{{ authStore.isAdmin ? '管理员' : authStore.linkName || '访客' }}</span>
        <a v-if="authStore.hasPermission('page:permissions', 'view')" class="dt-team-badge" title="权限控制" @click.prevent="goPermissions" style="background:#722ED1;">🔐</a>
        <a v-if="authStore.hasPermission('page:personnel', 'view')" class="dt-team-badge" title="团队人员" @click.prevent="goPersonnel">团</a>
      </div>
    </div>
  </header>

  <!-- 新建任务弹窗 -->
  <CreateTaskModal
    :visible="showCreateModal"
    @close="showCreateModal = false"
    @created="handleTaskCreated"
  />
</template>
