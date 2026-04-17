<script setup>
/**
 * PermissionPage.vue — 权限控制页面（REQ-21）
 * v1.4.3: 页面加载动画
 * 管理访问链接及其权限配置
 */
import { ref, onMounted } from 'vue'
import { usePermissionStore } from '../stores/permission'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'

const permStore = usePermissionStore()
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

/** 新建链接弹窗 */
const createDialogVisible = ref(false)
const newLinkName = ref('')

/** 当前展开编辑的链接 ID */
const expandedLinkId = ref('')

/** 资源中文标签 */
const RESOURCE_LABEL = {
  'page:tasks': '📋 任务收集页',
  'page:report': '📊 需求工时统计页',
  'page:stats': '📈 周期统计页',
  'page:personnel': '👥 团队人员页',
  'page:permissions': '🔐 权限管理页',
  'btn:create_task': '➕ 新建收集按钮',
  'btn:edit_task': '✏️ 编辑任务按钮',
  'btn:delete_task': '🗑️ 删除任务按钮',
  'btn:stop_task': '⏸ 停止收集按钮'
}

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
    await permStore.create(newLinkName.value.trim())
    ElMessage.success('创建成功')
    newLinkName.value = ''
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

/** 切换单个权限 */
async function togglePermission(link, resource, field) {
  const perm = link.permissions?.find(p => p.resource === resource)
  if (!perm) return
  const newVal = !perm[field]
  await permStore.updatePermissions(link.id, [{ resource, [field]: newVal }])
}

/** 获取某链接某资源的权限值 */
function getPermValue(link, resource, field) {
  const perm = link.permissions?.find(p => p.resource === resource)
  return perm ? perm[field] : false
}

/** 查看权限关闭时，禁用增改删开关 */
function isActionDisabled(link, resource) {
  return !getPermValue(link, resource, 'can_view')
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

/** 获取完整访问链接（用于页面展示） */
function getAccessUrl(token) {
  return buildAccessUrl(token)
}
</script>

<template>
  <div>
    <!-- v1.4.3: 页面加载中动画 -->
    <div v-if="pageLoading" class="dt-page-loading">
      <div class="dt-page-spinner"></div>
      <p style="margin-top:16px; color:var(--color-text-3); font-size:14px;">正在加载中...</p>
    </div>
    <template v-else>
    <BackButton to="/tasks" label="← 返回" />

    <div class="dt-page-header flex-between">
      <div>
        <h1 class="dt-page-title">🔐 权限控制</h1>
        <p class="dt-page-description">管理访问链接及权限配置</p>
      </div>
      <div style="display:flex; gap:8px;">
        <el-button circle @click="permStore.fetchAll()" title="刷新数据" style="font-size:16px;">🔄</el-button>
        <el-button type="primary" @click="createDialogVisible = true">+ 新建访问链接</el-button>
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
            <el-button type="primary" link size="small" @click="copyLink(link.token)">复制链接</el-button>
            <el-button type="warning" link size="small" @click="toggleExpand(link.id)">
              {{ expandedLinkId === link.id ? '收起权限' : '编辑权限' }}
            </el-button>
            <el-button :type="link.is_active ? 'info' : 'success'" link size="small" @click="toggleActive(link)">
              {{ link.is_active ? '停用' : '启用' }}
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(link)">删除</el-button>
          </div>
        </div>

        <!-- 完整访问链接显示 -->
        <div class="dt-perm-card-token">
          访问链接：
          <a
            :href="getAccessUrl(link.token)"
            target="_blank"
            rel="noopener noreferrer"
            class="dt-perm-link"
          >
            {{ getAccessUrl(link.token) }}
          </a>
        </div>

        <!-- 展开的权限编辑表格 -->
        <transition name="accordion">
          <div v-if="expandedLinkId === link.id" class="dt-perm-table-wrap">
            <el-table :data="permStore.resources" border size="small" style="width:100%;">
              <el-table-column label="资源" min-width="200">
                <template #default="{ row }">
                  <span style="font-size:13px;">{{ RESOURCE_LABEL[row.resource] || row.resource }}</span>
                </template>
              </el-table-column>
              <el-table-column label="查看" width="80" align="center">
                <template #default="{ row }">
                  <el-switch
                    :model-value="getPermValue(link, row.resource, 'can_view')"
                    @change="togglePermission(link, row.resource, 'can_view')"
                    size="small"
                  />
                </template>
              </el-table-column>
              <el-table-column label="新增" width="80" align="center">
                <template #default="{ row }">
                  <el-switch
                    :model-value="getPermValue(link, row.resource, 'can_create')"
                    @change="togglePermission(link, row.resource, 'can_create')"
                    size="small"
                    :disabled="isActionDisabled(link, row.resource)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="修改" width="80" align="center">
                <template #default="{ row }">
                  <el-switch
                    :model-value="getPermValue(link, row.resource, 'can_update')"
                    @change="togglePermission(link, row.resource, 'can_update')"
                    size="small"
                    :disabled="isActionDisabled(link, row.resource)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="删除" width="80" align="center">
                <template #default="{ row }">
                  <el-switch
                    :model-value="getPermValue(link, row.resource, 'can_delete')"
                    @change="togglePermission(link, row.resource, 'can_delete')"
                    size="small"
                    :disabled="isActionDisabled(link, row.resource)"
                  />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </transition>
      </div>
    </div>

    <!-- 新建弹窗 -->
    <el-dialog v-model="createDialogVisible" title="新建访问链接" width="420px" :close-on-click-modal="false">
      <el-form label-width="80px">
        <el-form-item label="链接名称">
          <el-input v-model="newLinkName" placeholder="如：张三只读" maxlength="100" />
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
  opacity: 1; /* 停用状态也保持操作区不置灰 */
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

.dt-perm-card-token code {
  background: var(--color-bg-2, #F7F8FA);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-3);
  user-select: all;
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
  max-height: 600px;
}
</style>
