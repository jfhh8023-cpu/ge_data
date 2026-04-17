<script setup>
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const message = computed(() => {
  if (authStore.forbiddenReason === 'disabled') {
    return '当前链接已停用，请联系管理员处理！'
  }
  if (authStore.forbiddenReason === 'no_view') {
    return '当前链接暂未配置查看项，请及时联系管理员配置！'
  }
  return '无访问权限，请联系管理员获取权限。'
})
</script>

<template>
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;">
    <div style="font-size:60px;opacity:0.3;">🔒</div>
    <h2 style="color:#86909C;margin-top:16px;">无访问权限</h2>
    <p style="color:#C9CDD4;margin-top:8px;">{{ message }}</p>
  </div>
</template>
