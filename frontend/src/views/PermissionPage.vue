<script setup>
/**
 * PermissionPage.vue — 权限控制页面（REQ-21 → v3.0.0 扩展）
 * v3.0.0: 分模块手风琴布局 + 三级全选 + 预设模板
 */
import { ref, computed, onMounted } from 'vue'
import { usePermissionStore } from '../stores/permission'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'
import { useAuthStore } from '../stores/auth'

const permStore = usePermissionStore()
const authStore = useAuthStore()
const pageLoading = ref(true)

/** 新建链接弹窗 */
const createDialogVisible = ref(false)
const newLinkName = ref('')
const newLinkPreset = ref('custom')

const PRESET_OPTIONS = [
  { value: 'readonly', label: '只读访问', desc: '仅查看所有页面，无操作按钮' },
  { value: 'edit',     label: '编辑权限', desc: '可查看+编辑，不可删除' },
  { value: 'full',     label: '完全权限', desc: '全部开启' },
  { value: 'custom',   label: '自定义',   desc: '创建后手动配置' }
]

/** 当前展开编辑的链接 ID */
const expandedLinkId = ref('')

/** 模块展开状态 */
const expandedModules = ref({})

/** 操作列定义 */
const ACTION_COLS = [
  { field: 'can_view',   label: '查看' },
  { field: 'can_create', label: '新增' },
  { field: 'can_update', label: '修改' },
  { field: 'can_delete', label: '删除' }
]

/** 计算分组结构 */
const moduleGroups = computed(() => {
  const resources = permStore.resources || []
  const modules = []
  const moduleMap = {}
  for (const r of resources) {
    const key = r.module || 'unknown'
    if (!moduleMap[key]) {
      moduleMap[key] = { module: key, module_label: r.module_label || key, pages: {}, resources: [] }
      modules.push(moduleMap[key])
    }
    moduleMap[key].resources.push(r)
    const pageKey = r.parent_page || r.resource
    if (!moduleMap[key].pages[pageKey]) {
      moduleMap[key].pages[pageKey] = []
    }
    moduleMap[key].pages[pageKey].push(r)
  }
  return modules
})

onMounted(async () => {
  pageLoading.value = true
  await permStore.fetchAll()
  pageLoading.value = false
})

/** 创建链接 */
async function handleCreate() {
  if (!newLinkName.value.trim()) {
    ElMessage.warning('请输入链接名称')
    return
  }
  try {
    await permStore.create(newLinkName.value.trim(), newLinkPreset.value)
    ElMessage.success('创建成功')
    newLinkName.value = ''
    newLinkPreset.value = 'custom'
    createDialogVisible.value = false
  } catch {
    ElMessage.error('创建失败')
  }
}

/** 删除链接 */
async function handleDelete(link) {
  try {
    await ElMessageBox.confirm(`确认删除访问链接「${link.name}」？关联的权限配置将一并删除。`, '删除链接', {
      confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning'
    })
    await permStore.remove(link.id)
    ElMessage.success('已删除')
  } catch {
    // 取消
  }
}

/** 切换链接启用/停用 */
async function toggleActive(link) {
  await permStore.update(link.id, { is_active: !link.is_active })
  ElMessage.success(link.is_active ? '已停用' : '已启用')
}

/** 展开/收起权限编辑 */
function toggleExpand(linkId) {
  expandedLinkId.value = expandedLinkId.value === linkId ? '' : linkId
}

/** 展开/收起模块 */
function toggleModule(linkId, moduleKey) {
  const key = `${linkId}_${moduleKey}`
  expandedModules.value[key] = !expandedModules.value[key]
}
function isModuleExpanded(linkId, moduleKey) {
  return !!expandedModules.value[`${linkId}_${moduleKey}`]
}

/** 获取某链接某资源的权限值 */
function getPermValue(link, resource, field) {
  const perm = link.permissions?.find(p => p.resource === resource)
  return perm ? (perm[field] === true || perm[field] === 1) : false
}

/** 判断某 action 列对该资源是否有效 */
function isValidAction(res, field) {
  if (!res.valid_actions) return true
  const actionName = field.replace('can_', '')
  return res.valid_actions.includes(actionName)
}

/** 切换单个权限 */
async function togglePermission(link, resource, field) {
  const newVal = !getPermValue(link, resource, field)
  await permStore.updatePermissions(link.id, [{ resource, [field]: newVal }])
}

/** 查看权限关闭时，禁用增改删 */
function isActionDisabled(link, resource) {
  return !getPermValue(link, resource, 'can_view')
}

/* ========== 三级全选 ========== */
/** 计算模块全选状态 */
function getModuleCheckState(link, mod) {
  let total = 0, checked = 0
  for (const r of mod.resources) {
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        total++
        if (getPermValue(link, r.resource, col.field)) checked++
      }
    }
  }
  if (checked === 0) return 'none'
  if (checked === total) return 'all'
  return 'partial'
}

/** 切换模块全选 */
async function toggleModuleAll(link, mod) {
  const state = getModuleCheckState(link, mod)
  const newVal = state !== 'all'
  const perms = []
  for (const r of mod.resources) {
    const p = { resource: r.resource }
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        p[col.field] = newVal
      }
    }
    perms.push(p)
  }
  await permStore.updatePermissions(link.id, perms)
}

/** 计算页面分组全选状态 */
function getPageCheckState(link, pageResources) {
  let total = 0, checked = 0
  for (const r of pageResources) {
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        total++
        if (getPermValue(link, r.resource, col.field)) checked++
      }
    }
  }
  if (checked === 0) return 'none'
  if (checked === total) return 'all'
  return 'partial'
}

/** 切换页面分组全选 */
async function togglePageAll(link, pageResources) {
  const state = getPageCheckState(link, pageResources)
  const newVal = state !== 'all'
  const perms = []
  for (const r of pageResources) {
    const p = { resource: r.resource }
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        p[col.field] = newVal
      }
    }
    perms.push(p)
  }
  await permStore.updatePermissions(link.id, perms)
}

/** 全选全部 */
function getAllCheckState(link) {
  let total = 0, checked = 0
  for (const r of (permStore.resources || [])) {
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        total++
        if (getPermValue(link, r.resource, col.field)) checked++
      }
    }
  }
  if (checked === 0) return 'none'
  if (checked === total) return 'all'
  return 'partial'
}

async function toggleAll(link) {
  const state = getAllCheckState(link)
  const newVal = state !== 'all'
  const perms = []
  for (const r of (permStore.resources || [])) {
    const p = { resource: r.resource }
    for (const col of ACTION_COLS) {
      if (isValidAction(r, col.field)) {
        p[col.field] = newVal
      }
    }
    perms.push(p)
  }
  await permStore.updatePermissions(link.id, perms)
}

/** 构建访问链接基础URL（适配生产子路径） */
function buildAccessUrl(token) {
  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  return `${window.location.origin}${normalizedBase}access?token=${token}`
}

/** 复制链接（适配生产子路径） */
function copyLink(token) {
  const url = buildAccessUrl(token)
  navigator.clipboard.writeText(url).then(() => {
    ElMessage.success('链接已复制到剪贴板')
  }).catch(() => {
    ElMessage.info(`访问地址：${url}`)
  })
}

/** 获取完整访问链接 */
function getAccessUrl(token) {
  return buildAccessUrl(token)
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
        <h1 class="dt-page-title">🔐 权限控制</h1>
        <p class="dt-page-description">管理访问链接及权限配置（按模块/页面/全部维度勾选权限）</p>
      </div>
      <div style="display:flex; gap:8px;">
        <el-button circle @click="permStore.fetchAll()" title="刷新数据" style="font-size:16px;">🔄</el-button>
        <el-button v-if="authStore.hasPermission('btn:permissions:create_link', 'view')" type="primary" @click="createDialogVisible = true">+ 新建访问链接</el-button>
      </div>
    </div>

    <!-- 加载 -->
    <el-skeleton v-if="permStore.loading" :rows="4" animated />

    <!-- 空状态 -->
    <div v-else-if="permStore.links.length === 0" class="dt-empty" style="padding:60px;">
      <div class="dt-empty-icon">🔐</div>
      <p class="dt-empty-text">暂无访问链接，点击上方按钮创建</p>
    </div>

    <!-- 链接列表 -->
    <div v-else class="dt-perm-list">
      <div
        v-for="link in permStore.links"
        :key="link.id"
        class="dt-perm-card"
        :class="{ 'dt-perm-card-inactive': !link.is_active }"
      >
        <!-- 卡片头部 -->
        <div class="dt-perm-card-header">
          <div class="dt-perm-card-info">
            <span class="dt-perm-card-name">{{ link.name }}</span>
            <span class="dt-badge" :class="link.is_active ? 'dt-badge-active' : 'dt-badge-draft'">
              {{ link.is_active ? '启用中' : '已停用' }}
            </span>
          </div>
          <div class="dt-perm-card-actions">
            <el-button v-if="authStore.hasPermission('btn:permissions:copy_link', 'view')" type="primary" link size="small" @click="copyLink(link.token)">复制链接</el-button>
            <el-button v-if="authStore.hasPermission('btn:permissions:edit_perms', 'view')" type="warning" link size="small" @click="toggleExpand(link.id)">
              {{ expandedLinkId === link.id ? '收起权限' : '编辑权限' }}
            </el-button>
            <el-button v-if="authStore.hasPermission('btn:permissions:toggle_link', 'view')" :type="link.is_active ? 'info' : 'success'" link size="small" @click="toggleActive(link)">
              {{ link.is_active ? '停用' : '启用' }}
            </el-button>
            <el-button v-if="authStore.hasPermission('btn:permissions:delete_link', 'view')" type="danger" link size="small" @click="handleDelete(link)">删除</el-button>
          </div>
        </div>

        <!-- 完整访问链接显示 -->
        <div class="dt-perm-card-token">
          访问链接：
          <a :href="getAccessUrl(link.token)" target="_blank" rel="noopener noreferrer" class="dt-perm-link">
            {{ getAccessUrl(link.token) }}
          </a>
        </div>

        <!-- v3.0.0: 展开的权限编辑 — 分模块手风琴 -->
        <transition name="accordion">
          <div v-if="expandedLinkId === link.id" class="dt-perm-table-wrap">
            <!-- 全选全部 -->
            <div class="dt-perm-select-all" @click="toggleAll(link)">
              <el-checkbox
                :model-value="getAllCheckState(link) === 'all'"
                :indeterminate="getAllCheckState(link) === 'partial'"
                @change="toggleAll(link)"
              />
              <span style="font-weight:600; font-size:14px; margin-left:8px;">全选全部</span>
              <span style="font-size:12px; color:var(--color-text-4); margin-left:8px;">
                （{{ permStore.resources?.length || 0 }} 项资源）
              </span>
            </div>

            <!-- 模块手风琴 -->
            <div v-for="mod in moduleGroups" :key="mod.module" class="dt-perm-module">
              <!-- 模块头 -->
              <div class="dt-perm-module-header" @click="toggleModule(link.id, mod.module)">
                <span class="dt-perm-arrow" :class="{ open: isModuleExpanded(link.id, mod.module) }">▶</span>
                <el-checkbox
                  :model-value="getModuleCheckState(link, mod) === 'all'"
                  :indeterminate="getModuleCheckState(link, mod) === 'partial'"
                  @click.stop
                  @change="toggleModuleAll(link, mod)"
                  style="margin-right:8px;"
                />
                <span style="font-weight:600; font-size:14px;">{{ mod.module_label }}</span>
                <span style="font-size:12px; color:var(--color-text-4); margin-left:8px;">
                  （{{ mod.resources.length }} 项）
                </span>
              </div>

              <!-- 模块内容 -->
              <div v-if="isModuleExpanded(link.id, mod.module)" class="dt-perm-module-body">
                <div v-for="(pageResources, pageKey) in mod.pages" :key="pageKey" class="dt-perm-page-group">
                  <!-- 页面分组头 -->
                  <div class="dt-perm-page-header">
                    <el-checkbox
                      :model-value="getPageCheckState(link, pageResources) === 'all'"
                      :indeterminate="getPageCheckState(link, pageResources) === 'partial'"
                      @change="togglePageAll(link, pageResources)"
                      style="margin-right:8px;"
                    />
                    <span style="font-weight:500; font-size:13px; color:var(--color-text-2);">
                      {{ pageResources[0]?.label || pageKey }}
                    </span>
                  </div>

                  <!-- 资源表格 -->
                  <table class="dt-perm-table">
                    <thead>
                      <tr>
                        <th style="text-align:left; min-width:200px;">资源</th>
                        <th v-for="col in ACTION_COLS" :key="col.field" style="width:70px; text-align:center;">{{ col.label }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="res in pageResources" :key="res.resource">
                        <td style="font-size:13px; padding:6px 4px;">{{ res.label }}</td>
                        <td v-for="col in ACTION_COLS" :key="col.field" style="text-align:center; padding:6px 0;">
                          <template v-if="isValidAction(res, col.field)">
                            <el-switch
                              :model-value="getPermValue(link, res.resource, col.field)"
                              @change="togglePermission(link, res.resource, col.field)"
                              size="small"
                              :disabled="col.field !== 'can_view' && isActionDisabled(link, res.resource)"
                            />
                          </template>
                          <span v-else style="color:var(--color-text-4);">—</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- v3.0.0: 新建弹窗（含预设模板） -->
    <el-dialog v-model="createDialogVisible" title="新建访问链接" width="480px" :close-on-click-modal="false">
      <el-form label-width="80px">
        <el-form-item label="链接名称">
          <el-input v-model="newLinkName" placeholder="如：张三只读" maxlength="100" />
        </el-form-item>
        <el-form-item label="权限预设">
          <div class="dt-preset-grid">
            <div
              v-for="opt in PRESET_OPTIONS" :key="opt.value"
              class="dt-preset-item"
              :class="{ 'dt-preset-item-active': newLinkPreset === opt.value }"
              @click="newLinkPreset = opt.value"
            >
              <el-radio :model-value="newLinkPreset" :value="opt.value" @change="newLinkPreset = opt.value">
                <span style="font-weight:600;">{{ opt.label }}</span>
              </el-radio>
              <span class="dt-preset-desc">{{ opt.desc }}</span>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.dt-perm-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dt-perm-card {
  background: var(--color-bg-white, #fff);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid var(--color-border-light, #F2F3F5);
  overflow: hidden;
  transition: all 0.25s ease;
}

.dt-perm-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.dt-perm-card-inactive {
  background: var(--color-bg-2, #F7F8FA);
  border-color: var(--color-border-light, #F2F3F5);
}

.dt-perm-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
}

.dt-perm-card-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dt-perm-card-inactive .dt-perm-card-info,
.dt-perm-card-inactive .dt-perm-card-token {
  opacity: 0.7;
}

.dt-perm-card-actions {
  display: flex;
  gap: 4px;
  opacity: 1;
}

.dt-perm-card-actions :deep(.el-button) {
  font-weight: 700;
  font-size: 14px;
}

.dt-perm-card-actions :deep(.el-button.is-link) {
  padding: 6px 6px;
}

.dt-perm-card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-1, #1D2129);
}

.dt-perm-card-token {
  padding: 0 20px 12px;
  font-size: 12px;
  color: var(--color-text-4, #C9CDD4);
}

.dt-perm-link {
  color: var(--color-primary, #165DFF);
  text-decoration: none;
  word-break: break-all;
}

.dt-perm-link:hover {
  text-decoration: underline;
}

.dt-perm-table-wrap {
  padding: 0 20px 16px;
}

/* v3.0.0: 全选行 */
.dt-perm-select-all {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--color-bg-2, #F7F8FA);
  border-radius: 8px;
  margin-bottom: 12px;
  cursor: pointer;
  user-select: none;
}
.dt-perm-select-all:hover {
  background: var(--color-primary-light, #E8F3FF);
}

/* v3.0.0: 模块手风琴 */
.dt-perm-module {
  border: 1px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}

.dt-perm-module-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--color-bg-2, #F7F8FA);
  cursor: pointer;
  user-select: none;
}
.dt-perm-module-header:hover {
  background: var(--color-primary-light, #E8F3FF);
}

.dt-perm-arrow {
  display: inline-block;
  font-size: 10px;
  color: var(--color-text-4);
  margin-right: 8px;
  transition: transform 0.2s;
}
.dt-perm-arrow.open {
  transform: rotate(90deg);
}

.dt-perm-module-body {
  padding: 8px 12px 12px;
}

/* v3.0.0: 页面分组 */
.dt-perm-page-group {
  margin-bottom: 12px;
}

.dt-perm-page-header {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border-light, #F2F3F5);
  margin-bottom: 4px;
}

/* v3.0.0: 权限表格 */
.dt-perm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.dt-perm-table th {
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text-3);
  padding: 6px 4px;
  border-bottom: 1px solid var(--color-border-light, #F2F3F5);
}
.dt-perm-table td {
  border-bottom: 1px solid var(--color-bg-2, #F7F8FA);
}
.dt-perm-table tr:last-child td {
  border-bottom: none;
}

/* v3.0.0: 预设选项 */
.dt-preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.dt-preset-item {
  border: 2px solid var(--color-border-light, #F2F3F5);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.dt-preset-item:hover {
  border-color: var(--color-primary, #165DFF);
}
.dt-preset-item-active {
  border-color: var(--color-primary, #165DFF);
  background: var(--color-primary-light, #E8F3FF);
}
.dt-preset-desc {
  display: block;
  font-size: 11px;
  color: var(--color-text-4);
  margin-top: 2px;
  padding-left: 24px;
}

/* 过渡动画 */
.accordion-enter-active,
.accordion-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.accordion-enter-from,
.accordion-leave-to {
  opacity: 0;
  max-height: 0;
}
.accordion-enter-to,
.accordion-leave-from {
  opacity: 1;
  max-height: 2000px;
}
</style>
