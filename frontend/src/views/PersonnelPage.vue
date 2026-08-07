<script setup>
/**
 * PersonnelPage.vue — 团队人员管理页
 * v3.2.0: 双 Tab 布局（研发人员 + 产品经理）
 * v1.6.1: 链接完整显示 + 操作按钮优化 + 数据交接功能
 * v1.6.0: el-table 布局 + 系统级专属链接操作区
 */
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useStaffStore } from '../stores/staff'
import { usePmStore } from '../stores/pm'
import { useRoleStore } from '../stores/roles'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Setting } from '@element-plus/icons-vue'
import BackButton from '../components/BackButton.vue'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import Sortable from 'sortablejs'
import { buildAppUrl, copyToClipboard } from '../utils/url'
import { ROLE_AI_DEV, roleLabel, roleTagStyle } from '../utils/roles'
import { broadcastDataChange, SYNC_EVENTS } from '../utils/sync'

const staffStore = useStaffStore()
const pmStore = usePmStore()
const roleStore = useRoleStore()
const authStore = useAuthStore()
const pageLoading = ref(true)

/* ========== Tab 切换 ========== */
const activeTab = ref('staff')

/** 弹窗状态 */
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const form = ref({ name: '', phone: '', role: ROLE_AI_DEV })

const staffFilters = ref({ name: '', phone: '', role: '', status: '' })
const hasStaffFilters = computed(() => Object.values(staffFilters.value).some(value => String(value || '').trim()))
const filteredStaffList = computed(() => {
  const name = staffFilters.value.name.trim().toLocaleLowerCase()
  const phone = staffFilters.value.phone.trim()
  return staffStore.list.filter(staff => {
    if (name && !String(staff.name || '').toLocaleLowerCase().includes(name)) return false
    if (phone && !String(staff.phone || '').includes(phone)) return false
    if (staffFilters.value.role && staff.role !== staffFilters.value.role) return false
    if (staffFilters.value.status && normalizedEmploymentStatus(staff) !== staffFilters.value.status) return false
    return true
  })
})

function resetStaffFilters() {
  staffFilters.value = { name: '', phone: '', role: '', status: '' }
}

/** 预设文本（带标题链接用） */
const presetText = ref('请填写上周工作内容，您的专属链接如下：')

/** 角色选项 */
const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: '在职' },
  { value: 'resigned', label: '离职' },
  { value: 'retained', label: '留职' },
  { value: 'long_leave', label: '长假' }
]
const EMPLOYMENT_STATUS_LABEL = EMPLOYMENT_STATUS_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label
  return acc
}, {})
const EMPLOYMENT_STATUS_BADGE = {
  active: 'dt-badge-active',
  resigned: 'dt-badge-closed',
  retained: 'dt-badge-draft',
  long_leave: 'dt-badge-warning'
}

function normalizedEmploymentStatus(person) {
  return person?.employment_status || (person?.is_active === false ? 'resigned' : 'active')
}

function isActiveLike(person) {
  return normalizedEmploymentStatus(person) !== 'resigned'
}

function todayYmd() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ========== 交接弹窗状态 ========== */
const transferDialogVisible = ref(false)
const transferSource = ref(null)       // 被交接的人员对象
const transferLoading = ref(false)     // 加载汇总中
const transferSummary = ref(null)      // { staff, tasks, totalRecords }
const transferTargetId = ref('')       // 目标人员 id
const transferSubmitting = ref(false)

/** 下拉候选（去掉自身） */
const transferTargetOptions = computed(() => {
  if (!transferSource.value) return []
  return staffStore.list.filter(s => s.id !== transferSource.value.id && isActiveLike(s))
})

onMounted(async () => {
  pageLoading.value = true
  await Promise.all([staffStore.fetchAll(), pmStore.fetchAll(), roleStore.fetchAll({ force: true })])
  pageLoading.value = false
  await nextTick()
  initSortable()
})

/* ========== 拖拽排序 ========== */
let staffSortable = null
let pmSortable = null

function initSortable() {
  // 延迟确保 el-table 渲染完成
  setTimeout(() => {
    initTableSortable('staff')
    initTableSortable('pm')
  }, 200)
}

function destroySortable(type) {
  if (type === 'staff' && staffSortable) { staffSortable.destroy(); staffSortable = null }
  if (type === 'pm' && pmSortable) { pmSortable.destroy(); pmSortable = null }
}

function initTableSortable(type) {
  destroySortable(type)
  if (type === 'staff' && hasStaffFilters.value) return
  const selector = type === 'staff' ? '.staff-sortable-table' : '.pm-sortable-table'
  const el = document.querySelector(`${selector} .el-table__body-wrapper tbody`)
  if (!el) return

  const instance = Sortable.create(el, {
    animation: 200,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: async (evt) => {
      const { oldIndex, newIndex } = evt
      if (oldIndex === newIndex) return

      // 关键：先还原 DOM 移动，避免与 Vue 虚拟 DOM 冲突
      const parent = evt.from
      const children = parent.children
      if (oldIndex < newIndex) {
        parent.insertBefore(evt.item, children[oldIndex])
      } else {
        parent.insertBefore(evt.item, children[oldIndex + 1])
      }

      // 在数据层计算新顺序
      const store = type === 'staff' ? staffStore : pmStore
      const newList = [...store.list]
      const [moved] = newList.splice(oldIndex, 1)
      newList.splice(newIndex, 0, moved)
      const ids = newList.map(item => item.id)

      // 保存到后端
      try {
        const endpoint = type === 'staff' ? '/staff/sort' : '/pm/sort'
        await api.put(endpoint, { ids })
        // 从后端重新拉取确保数据一致
        await store.fetchAll()
        ElMessage.success('排序已保存')
      } catch {
        ElMessage.error('排序保存失败')
        await store.fetchAll()
      }

      // 重建 Sortable 实例（因为 el-table 重新渲染了 DOM）
      await nextTick()
      setTimeout(() => initTableSortable(type), 150)
    }
  })

  if (type === 'staff') staffSortable = instance
  else pmSortable = instance
}

// Tab 切换后重新初始化 Sortable
watch(activeTab, async () => {
  await nextTick()
  setTimeout(() => initTableSortable(activeTab.value), 200)
})

watch(staffFilters, async () => {
  await nextTick()
  setTimeout(() => initTableSortable('staff'), 100)
}, { deep: true })

async function refreshCurrent() {
  if (activeTab.value === 'staff') {
    await Promise.all([staffStore.fetchAll(), roleStore.fetchAll({ force: true })])
  } else {
    await pmStore.fetchAll()
  }
}

function getFillUrl(token) {
  if (!token) return null
  return buildAppUrl(`fill/${token}`)
}

function openCreate() {
  isEditing.value = false
  editingId.value = ''
  form.value = { name: '', phone: '', role: ROLE_AI_DEV }
  dialogVisible.value = true
}

function openEdit(staff) {
  isEditing.value = true
  editingId.value = staff.id
  form.value = { name: staff.name, phone: staff.phone || '', role: staff.role }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.value.name || form.value.name.trim().length < 2) {
    ElMessage.warning('姓名长度须为 2-20 个字符')
    return
  }
  if (form.value.phone && !/^\d{5,20}$/.test(form.value.phone.trim())) {
    ElMessage.warning('手机号码只允许数字，长度 5-20 位')
    return
  }
  try {
    if (isEditing.value) {
      await staffStore.update(editingId.value, form.value)
      ElMessage.success('更新成功')
    } else {
      await staffStore.create(form.value)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    await staffStore.fetchAll()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '操作失败')
  }
}

/* ========== 研发角色配置 ========== */
const roleConfigVisible = ref(false)
const roleDrafts = ref([])
const roleSavingKey = ref('')
const newRoleSaving = ref(false)
const newRole = ref({ name: '', short_name: '', color: '#14B8A6' })

function refreshRoleDrafts() {
  roleDrafts.value = roleStore.list.map(role => ({ ...role }))
}

async function openRoleConfig() {
  await roleStore.fetchAll({ force: true })
  refreshRoleDrafts()
  newRole.value = { name: '', short_name: '', color: '#14B8A6' }
  roleConfigVisible.value = true
}

async function saveRoleConfig(role) {
  roleSavingKey.value = role.key
  try {
    await roleStore.updateRole(role.key, {
      name: role.name,
      short_name: role.short_name,
      color: role.color
    })
    refreshRoleDrafts()
    broadcastDataChange(SYNC_EVENTS.ROLE_CONFIG_CHANGED, { key: role.key })
    ElMessage.success('角色配置已保存并全局生效')
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '角色配置保存失败')
  } finally {
    roleSavingKey.value = ''
  }
}

async function createRoleConfig() {
  newRoleSaving.value = true
  try {
    await roleStore.createRole(newRole.value)
    refreshRoleDrafts()
    newRole.value = { name: '', short_name: '', color: '#14B8A6' }
    broadcastDataChange(SYNC_EVENTS.ROLE_CONFIG_CHANGED)
    ElMessage.success('新角色已新增并全局生效')
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '角色新增失败')
  } finally {
    newRoleSaving.value = false
  }
}

async function updateStaffStatus(staff, status) {
  if (status === normalizedEmploymentStatus(staff)) return
  try {
    if (status === 'resigned') {
      await ElMessageBox.confirm(
        `确认将「${staff.name}」设为离职？生效后该人员不可填写，后续周期不再统计。`,
        '切换为离职',
        { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
      )
    }
    await api.put(`/staff/${staff.id}/status`, {
      employment_status: status,
      effective_date: todayYmd()
    })
    await staffStore.fetchAll()
    ElMessage.success('状态已更新')
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error(err.response?.data?.message || '状态更新失败')
  }
}

async function handleDelete(staff) {
  try {
    await ElMessageBox.confirm(`确认删除「${staff.name}」？`, '删除人员', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning'
    })
    await staffStore.remove(staff.id)
    ElMessage.success('已删除')
  } catch (err) {
    // 后端拦截（有工时记录）时显示详细提示
    const msg = err.response?.data?.message
    if (msg) ElMessage.error(msg)
  }
}

/** 打开交接弹窗 */
async function openTransfer(staff) {
  transferSource.value = staff
  transferTargetId.value = ''
  transferSummary.value = null
  transferDialogVisible.value = true
  transferLoading.value = true
  try {
    const res = await api.get(`/staff/${staff.id}/records-summary`)
    transferSummary.value = res.data
  } catch {
    ElMessage.error('加载数据失败')
    transferDialogVisible.value = false
  } finally {
    transferLoading.value = false
  }
}

/** 执行交接 */
async function handleTransfer() {
  if (!transferTargetId.value) {
    ElMessage.warning('请选择交接目标人员')
    return
  }
  transferSubmitting.value = true
  try {
    const res = await api.post(`/staff/${transferSource.value.id}/transfer`, { to_staff_id: transferTargetId.value })
    ElMessage.success(res.data.message || '交接成功')
    transferDialogVisible.value = false
    await staffStore.fetchAll()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '交接失败')
  } finally {
    transferSubmitting.value = false
  }
}

/** 复制纯链接 */
async function copyLink(token) {
  const url = getFillUrl(token)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  try {
    await copyToClipboard(url)
    ElMessage.success('链接已复制')
  } catch { ElMessage.error('复制失败，请手动复制') }
}

/** 复制带标题的链接 */
async function copyLinkWithTitle(staff) {
  const url = getFillUrl(staff.fillToken)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  const text = `${staff.name}同学${presetText.value}\n${url}`
  try {
    await copyToClipboard(text)
    ElMessage.success('带标题链接已复制')
  } catch { ElMessage.error('复制失败，请手动复制') }
}

/** 打开专属链接 */
function openLink(token) {
  const url = getFillUrl(token)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  window.open(url, '_blank')
}

/* ========== AI产品经理 Tab ========== */
const pmDialogVisible = ref(false)
const pmIsEditing = ref(false)
const pmEditingId = ref('')
const pmForm = ref({ name: '' })

/* PM 交接 */
const pmTransferDialogVisible = ref(false)
const pmTransferSource = ref(null)
const pmTransferLoading = ref(false)
const pmTransferSummary = ref(null)
const pmTransferTargetId = ref('')
const pmTransferSubmitting = ref(false)

const pmTransferTargetOptions = computed(() => {
  if (!pmTransferSource.value) return []
  return pmStore.list.filter(p => p.id !== pmTransferSource.value.id && isActiveLike(p))
})

function getPmViewUrl(token) {
  if (!token) return null
  return buildAppUrl(`pm/view/${token}`)
}

function openPmCreate() {
  pmIsEditing.value = false
  pmEditingId.value = ''
  pmForm.value = { name: '' }
  pmDialogVisible.value = true
}

function openPmEdit(pm) {
  pmIsEditing.value = true
  pmEditingId.value = pm.id
  pmForm.value = { name: pm.name }
  pmDialogVisible.value = true
}

async function handlePmSubmit() {
  if (!pmForm.value.name || pmForm.value.name.trim().length < 2) {
    ElMessage.warning('姓名长度须为 2-20 个字符')
    return
  }
  try {
    if (pmIsEditing.value) {
      await pmStore.update(pmEditingId.value, pmForm.value)
      ElMessage.success('更新成功（已全局同步）')
    } else {
      await pmStore.create(pmForm.value)
      ElMessage.success('新增成功')
    }
    pmDialogVisible.value = false
    await pmStore.fetchAll()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '操作失败')
  }
}

async function handlePmDelete(pm) {
  try {
    await ElMessageBox.confirm(`确认删除AI产品经理「${pm.name}」？`, '删除AI产品经理', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning'
    })
    await pmStore.remove(pm.id)
    ElMessage.success('已删除')
  } catch (err) {
    const msg = err.response?.data?.message
    if (msg) ElMessage.error(msg)
  }
}

async function openPmTransfer(pm) {
  pmTransferSource.value = pm
  pmTransferTargetId.value = ''
  pmTransferSummary.value = null
  pmTransferDialogVisible.value = true
  pmTransferLoading.value = true
  try {
    const res = await api.get(`/pm/${pm.id}/references`)
    pmTransferSummary.value = res.data
  } catch {
    ElMessage.error('加载数据失败')
    pmTransferDialogVisible.value = false
  } finally {
    pmTransferLoading.value = false
  }
}

async function handlePmTransfer() {
  if (!pmTransferTargetId.value) {
    ElMessage.warning('请选择交接目标AI产品经理')
    return
  }
  pmTransferSubmitting.value = true
  try {
    const res = await api.post(`/pm/${pmTransferSource.value.id}/transfer`, { to_pm_id: pmTransferTargetId.value })
    ElMessage.success(res.data.message || '交接成功')
    pmTransferDialogVisible.value = false
    await pmStore.fetchAll()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '交接失败')
  } finally {
    pmTransferSubmitting.value = false
  }
}

function copyPmLink(token) {
  const url = getPmViewUrl(token)
  if (!url) return ElMessage.warning('该AI产品经理暂无专属链接')
  copyToClipboard(url)
    .then(() => ElMessage.success('链接已复制'))
    .catch(() => ElMessage.error('复制失败'))
}

function openPmLink(token) {
  const url = getPmViewUrl(token)
  if (!url) return ElMessage.warning('该AI产品经理暂无专属链接')
  window.open(url, '_blank')
}

async function updatePmStatus(pm, status) {
  if (status === normalizedEmploymentStatus(pm)) return
  try {
    if (status === 'resigned') {
      await ElMessageBox.confirm(
        `确认将AI产品经理「${pm.name}」设为离职？生效后专属查看链接会被阻断，后续周期不再统计该AI产品经理。`,
        '切换为离职',
        { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
      )
    }
    await api.put(`/pm/${pm.id}/status`, {
      employment_status: status,
      effective_date: todayYmd()
    })
    await pmStore.fetchAll()
    ElMessage.success('状态已更新')
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error(err.response?.data?.message || '状态更新失败')
  }
}
</script>

<template>
  <div>
    <!-- 页面加载动画 -->
    <div v-if="pageLoading" class="dt-page-loading">
      <div class="dt-page-spinner"></div>
      <p style="margin-top:16px; color:var(--color-text-3); font-size:14px;">正在加载中...</p>
    </div>
    <template v-else>
      <BackButton to="/tasks" label="← 返回" />

      <div class="dt-page-header flex-between">
        <div>
          <h1 class="dt-page-title">团队人员</h1>
          <p class="dt-page-description">管理研发团队成员与AI产品经理名单</p>
        </div>
        <div style="display:flex; gap:8px;">
          <el-button circle :icon="Refresh" @click="refreshCurrent" title="刷新数据" />
          <el-button v-if="activeTab === 'staff' && authStore.hasPermission('btn:personnel:create', 'view')" type="primary" @click="openCreate">+ 新增研发人员</el-button>
          <el-button v-if="activeTab === 'staff'" :icon="Setting" @click="openRoleConfig">配置</el-button>
          <el-button v-if="activeTab === 'pm'" type="primary" @click="openPmCreate">+ 新增AI产品经理</el-button>
        </div>
      </div>

      <!-- 双 Tab 切换 -->
      <el-tabs v-model="activeTab" type="border-card" style="margin-bottom:20px;">

        <!-- ===== Tab 1: 研发人员 ===== -->
        <el-tab-pane label="研发人员" name="staff">
          <!-- 预设文本区 -->
          <div class="dt-preset-box">
            <div class="dt-preset-label">复制带标题链接时使用的预设文本：</div>
            <el-input v-model="presetText" placeholder="请填写预设文本..." style="max-width:480px;" size="default" />
            <span class="dt-preset-hint">点击"复制带标题"会发送：姓名同学 + 此文本 + 换行 + 专属链接</span>
          </div>

          <div class="dt-staff-filter-bar">
            <el-input v-model="staffFilters.name" clearable placeholder="按姓名筛选" />
            <el-input v-model="staffFilters.phone" clearable placeholder="按手机号码筛选" />
            <el-select v-model="staffFilters.role" clearable placeholder="全部角色">
              <el-option v-for="role in roleStore.list" :key="role.key" :label="role.name" :value="role.key" />
            </el-select>
            <el-select v-model="staffFilters.status" clearable placeholder="全部状态">
              <el-option v-for="item in EMPLOYMENT_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-button :disabled="!hasStaffFilters" @click="resetStaffFilters">重置</el-button>
          </div>

          <el-skeleton v-if="staffStore.loading" :rows="5" animated />
          <div v-else-if="staffStore.list.length === 0" class="dt-empty" style="padding:60px;">
            <div class="dt-empty-icon">👥</div>
            <p class="dt-empty-text">暂无团队人员，请点击上方按钮添加</p>
          </div>

          <div v-else-if="filteredStaffList.length === 0" class="dt-empty" style="padding:48px;">
            <p class="dt-empty-text">未找到符合条件的研发人员</p>
          </div>

          <!-- 表格列表 -->
          <div v-else class="dt-data-card">
            <el-table :data="filteredStaffList" style="width:100%;" class="staff-sortable-table" row-key="id">
              <el-table-column width="40" align="center">
                <template #default>
                  <span class="drag-handle" :class="{ 'is-disabled': hasStaffFilters }" style="font-size:16px; color:var(--color-text-4);" :title="hasStaffFilters ? '清空筛选后可拖动排序' : '拖动排序'">☰</span>
                </template>
              </el-table-column>
              <el-table-column label="姓名" width="100">
                <template #default="{ row }">
                  <span style="font-weight:600; color:var(--color-text-1);">{{ row.name }}</span>
                </template>
              </el-table-column>
              <el-table-column label="手机号码" width="130">
                <template #default="{ row }">
                  <span>{{ row.phone || '' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="角色" width="180">
                <template #default="{ row }">
                  <span class="dt-tag dt-role-tag" :style="roleTagStyle(row.role)">{{ roleLabel(row.role) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="70">
                <template #default="{ row }">
                  <span class="dt-badge" :class="EMPLOYMENT_STATUS_BADGE[normalizedEmploymentStatus(row)] || 'dt-badge-active'">
                    {{ EMPLOYMENT_STATUS_LABEL[normalizedEmploymentStatus(row)] || '在职' }}
                  </span>
                </template>
              </el-table-column>
              <!-- 专属链接列：完整显示，允许折行 -->
              <el-table-column label="专属链接" min-width="320">
                <template #default="{ row }">
                  <a
                    v-if="row.fillToken"
                    class="dt-link-url-full"
                    :href="getFillUrl(row.fillToken)"
                    target="_blank"
                    @click.prevent="openLink(row.fillToken)"
                  >{{ getFillUrl(row.fillToken) }}</a>
                  <span v-else style="color:var(--color-text-4); font-size:13px;">暂无链接</span>
                </template>
              </el-table-column>
              <!-- 链接操作列 -->
              <el-table-column label="链接操作" width="240" align="center">
                <template #default="{ row }">
                  <div class="dt-link-ops">
                    <el-button v-if="authStore.hasPermission('btn:personnel:open_link', 'view')" class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="openLink(row.fillToken)">打开</el-button>
                    <el-button v-if="authStore.hasPermission('btn:personnel:copy_link', 'view')" class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="copyLink(row.fillToken)">复制</el-button>
                    <el-button v-if="authStore.hasPermission('btn:personnel:copy_link', 'view')" class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="copyLinkWithTitle(row)">复制带标题</el-button>
                  </div>
                </template>
              </el-table-column>
              <!-- 管理列 -->
              <el-table-column label="管理" width="270" align="center">
                <template #default="{ row }">
                  <div class="dt-management-ops">
                    <el-select
                      class="dt-status-select"
                      size="small"
                      :model-value="normalizedEmploymentStatus(row)"
                      @change="value => updateStaffStatus(row, value)"
                    >
                      <el-option v-for="item in EMPLOYMENT_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                    <el-button v-if="authStore.hasPermission('btn:personnel:edit', 'view')" type="warning" link size="small" @click="openEdit(row)">编辑</el-button>
                    <el-button v-if="authStore.hasPermission('btn:personnel:transfer', 'view')" type="info" link size="small" @click="openTransfer(row)">交接</el-button>
                    <el-button v-if="authStore.hasPermission('btn:personnel:delete', 'view')" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- ===== Tab 2: AI产品经理 ===== -->
        <el-tab-pane label="AI产品经理" name="pm">
          <el-skeleton v-if="pmStore.loading" :rows="5" animated />
          <div v-else-if="pmStore.list.length === 0" class="dt-empty" style="padding:60px;">
            <div class="dt-empty-icon">👔</div>
            <p class="dt-empty-text">暂无AI产品经理，请点击上方按钮添加</p>
          </div>
          <div v-else class="dt-data-card">
            <el-table :data="pmStore.list" style="width:100%;" class="pm-sortable-table" row-key="id">
              <el-table-column width="40" align="center">
                <template #default>
                  <span class="drag-handle" style="cursor:grab; font-size:16px; color:var(--color-text-4);" title="拖动排序">☰</span>
                </template>
              </el-table-column>
              <el-table-column label="姓名" width="120">
                <template #default="{ row }">
                  <span style="font-weight:600; color:var(--color-text-1);">{{ row.name }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="70">
                <template #default="{ row }">
                  <span class="dt-badge" :class="EMPLOYMENT_STATUS_BADGE[normalizedEmploymentStatus(row)] || 'dt-badge-active'">
                    {{ EMPLOYMENT_STATUS_LABEL[normalizedEmploymentStatus(row)] || '在职' }}
                  </span>
                </template>
              </el-table-column>
              <!-- PM 专属链接列 -->
              <el-table-column label="专属查看链接" min-width="350">
                <template #default="{ row }">
                  <a
                    v-if="row.token"
                    class="dt-link-url-full"
                    :href="getPmViewUrl(row.token)"
                    target="_blank"
                    @click.prevent="openPmLink(row.token)"
                  >{{ getPmViewUrl(row.token) }}</a>
                  <span v-else style="color:var(--color-text-4); font-size:13px;">暂无链接</span>
                </template>
              </el-table-column>
              <!-- PM 链接操作列 -->
              <el-table-column label="链接操作" width="140" align="center">
                <template #default="{ row }">
                  <div class="dt-link-ops">
                    <el-button class="dt-link-op-btn" type="primary" link :disabled="!row.token" @click="openPmLink(row.token)">打开</el-button>
                    <el-button class="dt-link-op-btn" type="primary" link :disabled="!row.token" @click="copyPmLink(row.token)">复制</el-button>
                  </div>
                </template>
              </el-table-column>
              <!-- PM 管理列 -->
              <el-table-column label="管理" width="270" align="center">
                <template #default="{ row }">
                  <div class="dt-management-ops">
                    <el-select
                      class="dt-status-select"
                      size="small"
                      :model-value="normalizedEmploymentStatus(row)"
                      @change="value => updatePmStatus(row, value)"
                    >
                      <el-option v-for="item in EMPLOYMENT_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                    <el-button type="warning" link size="small" @click="openPmEdit(row)">编辑</el-button>
                    <el-button type="info" link size="small" @click="openPmTransfer(row)">交接</el-button>
                    <el-button type="danger" link size="small" @click="handlePmDelete(row)">删除</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 研发人员 新增/编辑弹窗 -->
      <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑研发人员' : '新增研发人员'" width="440px" :close-on-click-modal="false">
        <el-form :model="form" label-width="70px">
          <el-form-item label="姓名">
            <el-input v-model="form.name" placeholder="请输入姓名（2-20字）" maxlength="20" />
          </el-form-item>
          <el-form-item label="手机号码">
            <el-input v-model="form.phone" placeholder="用于钉钉群 webhook @，可为空" maxlength="30" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="form.role" filterable style="width:100%;" placeholder="请选择研发角色">
              <el-option v-for="opt in roleStore.options" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">{{ isEditing ? '保存' : '新增' }}</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="roleConfigVisible" title="研发角色配置" width="720px" :close-on-click-modal="false">
        <div class="dt-role-config-list">
          <div v-for="role in roleDrafts" :key="role.key" class="dt-role-config-row">
            <el-color-picker v-model="role.color" />
            <el-input v-model="role.name" maxlength="30" placeholder="角色完整名称" />
            <el-input v-model="role.short_name" maxlength="12" placeholder="角色简称" />
            <el-button type="primary" :loading="roleSavingKey === role.key" @click="saveRoleConfig(role)">保存</el-button>
          </div>
        </div>
        <div class="dt-role-config-add">
          <div class="dt-role-config-add-title">新增角色</div>
          <div class="dt-role-config-row">
            <el-color-picker v-model="newRole.color" />
            <el-input v-model="newRole.name" maxlength="30" placeholder="角色完整名称" />
            <el-input v-model="newRole.short_name" maxlength="12" placeholder="角色简称" />
            <el-button type="primary" :loading="newRoleSaving" @click="createRoleConfig">新增</el-button>
          </div>
        </div>
        <template #footer>
          <el-button @click="roleConfigVisible = false">关闭</el-button>
        </template>
      </el-dialog>

      <!-- 研发人员 交接弹窗 -->
      <el-dialog
        v-model="transferDialogVisible"
        :title="`数据交接 — ${transferSource?.name}`"
        width="560px"
        :close-on-click-modal="false"
      >
        <el-skeleton v-if="transferLoading" :rows="4" animated />
        <template v-else-if="transferSummary">
          <el-alert
            v-if="transferSummary.totalRecords === 0"
            type="success"
            :closable="false"
            style="margin-bottom:16px;"
          >
            <template #default>「{{ transferSource?.name }}」暂无工时记录，可直接删除。</template>
          </el-alert>
          <template v-else>
            <div class="dt-transfer-tip">
              共有 <strong>{{ transferSummary.totalRecords }}</strong> 条工时记录，涉及以下任务：
            </div>
            <el-table :data="transferSummary.tasks" size="small" border style="margin-bottom:16px;">
              <el-table-column prop="title" label="任务名称" min-width="200">
                <template #default="{ row }">
                  <span style="font-size:12px;">{{ row.title }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <span class="dt-badge" :class="row.status === 'active' ? 'dt-badge-active' : 'dt-badge-closed'" style="font-size:11px;">
                    {{ row.status === 'active' ? '收集中' : '已停止' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="记录数" width="70" align="center">
                <template #default="{ row }"><span style="font-size:12px;">{{ row.recordCount }}</span></template>
              </el-table-column>
              <el-table-column label="总工时" width="70" align="center">
                <template #default="{ row }"><span style="font-size:12px; font-weight:700; color:var(--color-primary);">{{ row.totalHours }}H</span></template>
              </el-table-column>
            </el-table>
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:14px; font-weight:500; white-space:nowrap;">交接给：</span>
              <el-select v-model="transferTargetId" placeholder="请选择交接目标人员" style="flex:1;" filterable>
                <el-option v-for="s in transferTargetOptions" :key="s.id" :label="`${s.name}（${roleLabel(s.role)}）`" :value="s.id" />
              </el-select>
            </div>
          </template>
        </template>
        <template #footer>
          <el-button @click="transferDialogVisible = false">取消</el-button>
          <el-button v-if="transferSummary?.totalRecords > 0" type="primary" :loading="transferSubmitting" :disabled="!transferTargetId" @click="handleTransfer">确认交接</el-button>
        </template>
      </el-dialog>

      <!-- AI产品经理 新增/编辑弹窗 -->
      <el-dialog v-model="pmDialogVisible" :title="pmIsEditing ? '编辑AI产品经理' : '新增AI产品经理'" width="400px" :close-on-click-modal="false">
        <el-form :model="pmForm" label-width="70px">
          <el-form-item label="姓名">
            <el-input v-model="pmForm.name" placeholder="请输入AI产品经理姓名（2-20字）" maxlength="20" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="pmDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handlePmSubmit">{{ pmIsEditing ? '保存' : '新增' }}</el-button>
        </template>
      </el-dialog>

      <!-- AI产品经理 交接弹窗 -->
      <el-dialog
        v-model="pmTransferDialogVisible"
        :title="`PM 数据交接 — ${pmTransferSource?.name}`"
        width="560px"
        :close-on-click-modal="false"
      >
        <el-skeleton v-if="pmTransferLoading" :rows="4" animated />
        <template v-else-if="pmTransferSummary">
          <el-alert
            v-if="pmTransferSummary.totalRecords === 0"
            type="success"
            :closable="false"
            style="margin-bottom:16px;"
          >
            <template #default>「{{ pmTransferSource?.name }}」暂无关联数据，可直接删除。</template>
          </el-alert>
          <template v-else>
            <div class="dt-transfer-tip">
              共有 <strong>{{ pmTransferSummary.totalRecords }}</strong> 条关联工时记录，涉及以下任务：
            </div>
            <el-table :data="pmTransferSummary.tasks" size="small" border style="margin-bottom:16px;">
              <el-table-column prop="title" label="任务名称" min-width="200">
                <template #default="{ row }"><span style="font-size:12px;">{{ row.title }}</span></template>
              </el-table-column>
              <el-table-column label="记录数" width="70" align="center">
                <template #default="{ row }"><span style="font-size:12px;">{{ row.recordCount }}</span></template>
              </el-table-column>
              <el-table-column label="总工时" width="70" align="center">
                <template #default="{ row }"><span style="font-size:12px; font-weight:700; color:var(--color-primary);">{{ row.totalHours }}H</span></template>
              </el-table-column>
            </el-table>
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:14px; font-weight:500; white-space:nowrap;">交接给：</span>
              <el-select v-model="pmTransferTargetId" placeholder="请选择目标AI产品经理" style="flex:1;" filterable>
                <el-option v-for="p in pmTransferTargetOptions" :key="p.id" :label="p.name" :value="p.id" />
              </el-select>
            </div>
          </template>
        </template>
        <template #footer>
          <el-button @click="pmTransferDialogVisible = false">取消</el-button>
          <el-button v-if="pmTransferSummary?.totalRecords > 0" type="primary" :loading="pmTransferSubmitting" :disabled="!pmTransferTargetId" @click="handlePmTransfer">确认交接</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
/* 预设文本区 */
.dt-preset-box {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--color-bg-light, #F7F8FA);
  border: 1px solid var(--color-border-light, #E5E6EB);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 20px;
}
.dt-preset-label {
  font-size: 13px;
  color: var(--color-text-2, #4E5969);
  white-space: nowrap;
  font-weight: 500;
}
.dt-preset-hint {
  font-size: 12px;
  color: var(--color-text-4, #C9CDD4);
}

.dt-staff-filter-bar {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(170px, 1fr) minmax(180px, 1fr) minmax(130px, 0.75fr) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}

/* v1.6.1: 完整链接显示 */
.dt-link-url-full {
  font-size: 12px;
  color: var(--color-primary, #165DFF);
  font-family: var(--font-mono, monospace);
  text-decoration: none;
  word-break: break-all;
  white-space: normal;
  cursor: pointer;
  line-height: 1.5;
}
.dt-link-url-full:hover {
  text-decoration: underline;
}

.dt-role-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 110px;
  white-space: nowrap;
}

.dt-role-config-list {
  display: grid;
  gap: 10px;
}
.dt-role-config-row {
  display: grid;
  grid-template-columns: 40px minmax(200px, 1fr) minmax(120px, 0.6fr) 72px;
  gap: 10px;
  align-items: center;
}
.dt-role-config-add {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light, #E5E6EB);
}
.dt-role-config-add-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
}

/* v1.6.1: 链接操作按钮横排加粗加大 */
.dt-link-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  justify-content: center;
}
.dt-link-op-btn {
  font-size: 14px !important;
  font-weight: 700 !important;
  white-space: nowrap;
  padding: 0 6px !important;
}
.dt-management-ops {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: nowrap;
}
.dt-status-select {
  width: 78px;
  flex: 0 0 78px;
}
.dt-badge-warning {
  background: #FFF7E8;
  color: #D25F00;
}
.dt-badge-warning::before {
  background: #FF7D00;
}

/* 交接弹窗提示 */
.dt-transfer-tip {
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(255, 125, 0, 0.06);
  border-radius: 6px;
  border-left: 3px solid #FF7D00;
}

/* === 拖拽排序 === */
.drag-handle {
  cursor: grab !important;
  user-select: none;
  opacity: 0.4;
  transition: opacity 0.2s, color 0.2s;
}
.drag-handle:hover {
  opacity: 1;
  color: var(--color-primary, #165DFF) !important;
}
.drag-handle:active {
  cursor: grabbing !important;
}
.drag-handle.is-disabled {
  cursor: not-allowed !important;
  opacity: 0.2;
}

@media (max-width: 980px) {
  .dt-staff-filter-bar {
    grid-template-columns: 1fr 1fr;
  }
}

/* Sortable ghost（拖拽占位） */
:deep(.sortable-ghost) {
  background: var(--color-primary-light, #E8F3FF) !important;
  opacity: 0.6;
}
:deep(.sortable-ghost td) {
  background: var(--color-primary-light, #E8F3FF) !important;
}

/* Sortable chosen（选中行） */
:deep(.sortable-chosen) {
  background: #fff !important;
  box-shadow: 0 4px 16px rgba(22, 93, 255, 0.15);
  z-index: 100;
}
:deep(.sortable-chosen td) {
  background: #fff !important;
}
</style>
