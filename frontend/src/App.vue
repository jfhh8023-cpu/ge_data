<script setup>
/**
 * App.vue — 根布局组件
 * 管理端：Header + router-view + Footer
 * 填写页：独立布局（无Header/Footer）
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import { APP_VERSION, AUTHOR } from './version'

const route = useRoute()

/** 填写页使用独立布局，不显示管理端导航 */
const isFillLayout = computed(() => route.meta.layout === 'fill')

const CURRENT_YEAR = new Date().getFullYear()
</script>

<template>
  <div v-if="isFillLayout" class="dt-fill-layout">
    <router-view />
    <footer class="dt-footer">
      <div class="dt-footer-inner">
        <span class="dt-footer-version">DevTracker {{ APP_VERSION }}</span>
        <span class="dt-footer-divider">·</span>
        <span class="dt-footer-copyright">© {{ CURRENT_YEAR }}</span>
        <span class="dt-footer-divider">·</span>
        <span class="dt-footer-author">{{ AUTHOR }}</span>
      </div>
    </footer>
  </div>
  <div v-else class="dt-app-layout">
    <AppHeader />
    <main class="dt-main-container">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <!-- T3: 底部版本信息 -->
    <footer class="dt-footer">
      <div class="dt-footer-inner">
        <span class="dt-footer-version">DevTracker {{ APP_VERSION }}</span>
        <span class="dt-footer-divider">·</span>
        <span class="dt-footer-copyright">© {{ CURRENT_YEAR }}</span>
        <span class="dt-footer-divider">·</span>
        <span class="dt-footer-author">{{ AUTHOR }}</span>
      </div>
    </footer>
  </div>
</template>
