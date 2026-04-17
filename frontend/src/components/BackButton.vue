<script setup>
/**
 * BackButton — 二级页面返回按钮
 * 在 TaskDetail、PersonnelPage 等二级页面显示
 */
import { useRouter } from 'vue-router'

const props = defineProps({
  /** 自定义返回路径，默认使用 router.back() */
  to: { type: String, default: '' },
  label: { type: String, default: '← 返回' }
})

const router = useRouter()

function handleBack() {
  if (props.to) {
    router.push(props.to)
  } else {
    router.back()
  }
}
</script>

<template>
  <button class="dt-back-btn" @click="handleBack">{{ label }}</button>
</template>
