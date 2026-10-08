<script setup>
/**
 * 系统启用设置弹窗（REQ-074）
 * 开关开启 = 当前正常状态；关闭后可填写提示内容，提交后填写工时页被不可关闭弹窗占据。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const MAX_MESSAGE_LENGTH = 2000

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const loading = ref(false)
const saving = ref(false)
const enabled = ref(true)
const message = ref('')
const saved = ref({ enabled: true, message: '' })

const isDirty = computed(() =>
  enabled.value !== saved.value.enabled || message.value.trim() !== saved.value.message.trim()
)
const canSubmit = computed(() => isDirty.value && (enabled.value || message.value.trim().length > 0))

async function load() {
  loading.value = true
  try {
    const res = await api.get('/settings/system-access')
    const data = res.data || {}
    enabled.value = data.enabled !== false
    message.value = data.message || ''
    saved.value = { enabled: enabled.value, message: message.value }
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '加载系统启用状态失败')
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!enabled.value && !message.value.trim()) {
    ElMessage.warning('关闭系统时请填写展示内容')
    return
  }
  saving.value = true
  try {
    const res = await api.put('/settings/system-access', {
      enabled: enabled.value,
      message: message.value.trim()
    })
    const data = res.data || {}
    enabled.value = data.enabled !== false
    message.value = data.message || ''
    saved.value = { enabled: enabled.value, message: message.value }
    ElMessage.success(enabled.value ? '系统已启用' : '系统已关闭，填写工时页将展示提示内容')
    emit('saved', { ...saved.value })
    visible.value = false
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, v => { if (v) load() })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="系统启用设置"
    width="520px"
    align-center
    destroy-on-close
    class="system-access-dialog"
  >
    <div v-loading="loading" class="system-access-body">
      <div class="system-access-switch-row">
        <div>
          <div class="system-access-label">系统开启</div>
          <div class="system-access-hint">
            {{ enabled ? '当前状态：填写工时页面正常可用。' : '关闭后填写工时页面将被提示弹窗占据，不可编辑与提交。' }}
          </div>
        </div>
        <el-switch
          v-model="enabled"
          inline-prompt
          active-text="开"
          inactive-text="关"
          size="large"
        />
      </div>

      <transition name="el-fade-in">
        <div v-if="!enabled" class="system-access-message">
          <div class="system-access-label">
            展示内容
            <span class="system-access-required">*</span>
          </div>
          <el-input
            v-model="message"
            type="textarea"
            :rows="6"
            :maxlength="MAX_MESSAGE_LENGTH"
            show-word-limit
            resize="none"
            placeholder="请输入填写工时页面要展示的内容，例如：系统维护中，预计 xx 月 xx 日恢复。"
          />
        </div>
      </transition>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.system-access-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 72px;
}

.system-access-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.system-access-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

.system-access-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.system-access-required {
  color: var(--el-color-danger);
  margin-left: 2px;
}
</style>
