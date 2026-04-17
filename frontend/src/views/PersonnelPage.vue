<script setup>
/**
 * PersonnelPage.vue — 团队人员管理页
 * v1.6.0: 改为 el-table 布局，展示系统级专属链接操作区（复制/打开/复制带标题）
 * v1.1.0: REQ-20 卡片式网格（已废弃，本版改为表格）
 */
import { ref, onMounted } from 'vue'
import { useStaffStore } from '../stores/staff'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'

const staffStore = useStaffStore()
const pageLoading = ref(true)

/** 弹窗状态 */
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const form = ref({ name: '', role: 'frontend' })

/** 预设文本（带标题链接用），可在页面内修改 */
const presetText = ref('请填写上周工作内容，您的专属链接如下：')

/** 角色选项 */
const ROLE_OPTIONS = [
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'test', label: '测试' }
]

const ROLE_TAG_CLASS = {
  frontend: 'dt-tag-blue',
  backend: 'dt-tag-green',
  test: 'dt-tag-orange'
}

const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }

onMounted(async () => {
  pageLoading.value = true
  await staffStore.fetchAll()
  pageLoading.value = false
})

function getFillUrl(token) {
  if (!token) return null
  return `${window.location.origin}/fill/${token}`
}

function openCreate() {
  isEditing.value = false
  editingId.value = ''
  form.value = { name: '', role: 'frontend' }
  dialogVisible.value = true
}

function openEdit(staff) {
  isEditing.value = true
  editingId.value = staff.id
  form.value = { name: staff.name, role: staff.role }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.value.name || form.value.name.trim().length < 2) {
    ElMessage.warning('姓名长度须为 2-20 个字符')
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
  } catch {
    ElMessage.error('操作失败')
  }
}

async function handleDelete(staff) {
  try {
    await ElMessageBox.confirm(`确认删除「${staff.name}」？`, '删除人员', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning'
    })
    await staffStore.remove(staff.id)
    ElMessage.success('已删除')
  } catch { /* 取消 */ }
}

/** 复制纯链接 */
async function copyLink(token) {
  const url = getFillUrl(token)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

/** 复制带标题的链接：姓名同学 + 预设文本 + 换行 + 链接 */
async function copyLinkWithTitle(staff) {
  const url = getFillUrl(staff.fillToken)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  const text = `${staff.name}同学${presetText.value}\n${url}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('带标题链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

/** 打开专属链接 */
function openLink(token) {
  const url = getFillUrl(token)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  window.open(url, '_blank')
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
          <p class="dt-page-description">管理研发团队成员名单，及其系统级专属填写链接</p>
        </div>
        <div style="display:flex; gap:8px;">
          <el-button circle @click="staffStore.fetchAll()" title="刷新数据" style="font-size:16px;">🔄</el-button>
          <el-button type="primary" @click="openCreate">+ 新增人员</el-button>
        </div>
      </div>

      <!-- 预设文本区 -->
      <div class="dt-preset-box">
        <div class="dt-preset-label">复制带标题链接时使用的预设文本：</div>
        <el-input
          v-model="presetText"
          placeholder="请填写预设文本..."
          style="max-width:480px;"
          size="default"
        />
        <span class="dt-preset-hint">点击"复制带标题"会发送：姓名同学 + 此文本 + 换行 + 专属链接</span>
      </div>

      <!-- 加载骨架 -->
      <el-skeleton v-if="staffStore.loading" :rows="5" animated />

      <!-- 空状态 -->
      <div v-else-if="staffStore.list.length === 0" class="dt-empty" style="padding:60px;">
        <div class="dt-empty-icon">👥</div>
        <p class="dt-empty-text">暂无团队人员，请点击上方按钮添加</p>
      </div>

      <!-- 表格列表 -->
      <div v-else class="dt-data-card">
        <el-table :data="staffStore.list" style="width:100%;">
          <el-table-column label="姓名" width="120">
            <template #default="{ row }">
              <span style="font-weight:600; color:var(--color-text-1);">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="90">
            <template #default="{ row }">
              <span class="dt-tag" :class="ROLE_TAG_CLASS[row.role]">{{ ROLE_LABEL[row.role] || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <span class="dt-badge" :class="row.is_active ? 'dt-badge-active' : 'dt-badge-closed'">
                {{ row.is_active ? '在职' : '离职' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="专属链接" min-width="280">
            <template #default="{ row }">
              <div v-if="row.fillToken" class="dt-link-cell">
                <a
                  class="dt-link-url"
                  :href="getFillUrl(row.fillToken)"
                  target="_blank"
                  @click.prevent="openLink(row.fillToken)"
                  :title="getFillUrl(row.fillToken)"
                >
                  {{ getFillUrl(row.fillToken) }}
                </a>
              </div>
              <span v-else style="color:var(--color-text-4); font-size:13px;">暂无链接</span>
            </template>
          </el-table-column>
          <el-table-column label="链接操作" width="220" align="center">
            <template #default="{ row }">
              <el-button
                type="primary" link size="small"
                :disabled="!row.fillToken"
                @click="openLink(row.fillToken)"
              >打开链接</el-button>
              <el-button
                type="primary" link size="small"
                :disabled="!row.fillToken"
                @click="copyLink(row.fillToken)"
              >复制链接</el-button>
              <el-button
                type="primary" link size="small"
                :disabled="!row.fillToken"
                @click="copyLinkWithTitle(row)"
              >复制带标题</el-button>
            </template>
          </el-table-column>
          <el-table-column label="管理" width="120" align="center">
            <template #default="{ row }">
              <el-button type="warning" link size="small" @click="openEdit(row)">编辑</el-button>
              <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 新增/编辑弹窗 -->
      <el-dialog
        v-model="dialogVisible"
        :title="isEditing ? '编辑人员' : '新增人员'"
        width="400px"
        :close-on-click-modal="false"
      >
        <el-form :model="form" label-width="70px">
          <el-form-item label="姓名">
            <el-input v-model="form.name" placeholder="请输入姓名（2-20字）" maxlength="20" />
          </el-form-item>
          <el-form-item label="角色">
            <el-radio-group v-model="form.role">
              <el-radio v-for="opt in ROLE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">{{ isEditing ? '保存' : '新增' }}</el-button>
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

/* 链接单元格 */
.dt-link-cell {
  max-width: 260px;
  overflow: hidden;
}

.dt-link-url {
  font-size: 12px;
  color: var(--color-primary, #165DFF);
  font-family: var(--font-mono, monospace);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  cursor: pointer;
}

.dt-link-url:hover {
  text-decoration: underline;
}
</style>
