<script setup>
/**
 * PersonnelPage.vue — 团队人员管理页
 * v1.6.1: 链接完整显示 + 操作按钮优化 + 数据交接功能
 * v1.6.0: el-table 布局 + 系统级专属链接操作区
 */
import { ref, computed, onMounted } from 'vue'
import { useStaffStore } from '../stores/staff'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'
import api from '../api'

const staffStore = useStaffStore()
const pageLoading = ref(true)

/** 弹窗状态 */
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const form = ref({ name: '', role: 'frontend' })

/** 预设文本（带标题链接用） */
const presetText = ref('请填写上周工作内容，您的专属链接如下：')

/** 角色选项 */
const ROLE_OPTIONS = [
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'test', label: '测试' }
]
const ROLE_TAG_CLASS = { frontend: 'dt-tag-blue', backend: 'dt-tag-green', test: 'dt-tag-orange' }
const ROLE_LABEL = { frontend: '前端', backend: '后端', test: '测试' }

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
  return staffStore.list.filter(s => s.id !== transferSource.value.id && s.is_active)
})

onMounted(async () => {
  pageLoading.value = true
  await staffStore.fetchAll()
  pageLoading.value = false
})

function getFillUrl(token) {
  if (!token) return null
  // 生产环境 base = '/devtracker/'，开发环境 base = '/'
  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  return `${window.location.origin}${normalizedBase}fill/${token}`
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
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制')
  } catch { ElMessage.error('复制失败，请手动复制') }
}

/** 复制带标题的链接 */
async function copyLinkWithTitle(staff) {
  const url = getFillUrl(staff.fillToken)
  if (!url) return ElMessage.warning('该人员暂无专属链接')
  const text = `${staff.name}同学${presetText.value}\n${url}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('带标题链接已复制')
  } catch { ElMessage.error('复制失败，请手动复制') }
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
        <el-input v-model="presetText" placeholder="请填写预设文本..." style="max-width:480px;" size="default" />
        <span class="dt-preset-hint">点击"复制带标题"会发送：姓名同学 + 此文本 + 换行 + 专属链接</span>
      </div>

      <el-skeleton v-if="staffStore.loading" :rows="5" animated />
      <div v-else-if="staffStore.list.length === 0" class="dt-empty" style="padding:60px;">
        <div class="dt-empty-icon">👥</div>
        <p class="dt-empty-text">暂无团队人员，请点击上方按钮添加</p>
      </div>

      <!-- 表格列表 -->
      <div v-else class="dt-data-card">
        <el-table :data="staffStore.list" style="width:100%;">
          <el-table-column label="姓名" width="100">
            <template #default="{ row }">
              <span style="font-weight:600; color:var(--color-text-1);">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="80">
            <template #default="{ row }">
              <span class="dt-tag" :class="ROLE_TAG_CLASS[row.role]">{{ ROLE_LABEL[row.role] || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="70">
            <template #default="{ row }">
              <span class="dt-badge" :class="row.is_active ? 'dt-badge-active' : 'dt-badge-closed'">
                {{ row.is_active ? '在职' : '离职' }}
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
          <!-- 链接操作列：加粗加大，横排不换行 -->
          <el-table-column label="链接操作" width="240" align="center">
            <template #default="{ row }">
              <div class="dt-link-ops">
                <el-button class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="openLink(row.fillToken)">打开</el-button>
                <el-button class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="copyLink(row.fillToken)">复制</el-button>
                <el-button class="dt-link-op-btn" type="primary" link :disabled="!row.fillToken" @click="copyLinkWithTitle(row)">复制带标题</el-button>
              </div>
            </template>
          </el-table-column>
          <!-- 管理列：编辑 + 交接 + 删除 -->
          <el-table-column label="管理" width="160" align="center">
            <template #default="{ row }">
              <el-button type="warning" link size="small" @click="openEdit(row)">编辑</el-button>
              <el-button type="info" link size="small" @click="openTransfer(row)">交接</el-button>
              <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 新增/编辑弹窗 -->
      <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑人员' : '新增人员'" width="400px" :close-on-click-modal="false">
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

      <!-- 交接弹窗 -->
      <el-dialog
        v-model="transferDialogVisible"
        :title="`数据交接 — ${transferSource?.name}`"
        width="560px"
        :close-on-click-modal="false"
      >
        <el-skeleton v-if="transferLoading" :rows="4" animated />
        <template v-else-if="transferSummary">
          <!-- 汇总提示 -->
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
            <!-- 任务汇总列表 -->
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

            <!-- 交接目标选择 -->
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:14px; font-weight:500; white-space:nowrap;">交接给：</span>
              <el-select
                v-model="transferTargetId"
                placeholder="请选择交接目标人员"
                style="flex:1;"
                filterable
              >
                <el-option
                  v-for="s in transferTargetOptions"
                  :key="s.id"
                  :label="`${s.name}（${ROLE_LABEL[s.role] || s.role}）`"
                  :value="s.id"
                />
              </el-select>
            </div>
          </template>
        </template>

        <template #footer>
          <el-button @click="transferDialogVisible = false">取消</el-button>
          <el-button
            v-if="transferSummary?.totalRecords > 0"
            type="primary"
            :loading="transferSubmitting"
            :disabled="!transferTargetId"
            @click="handleTransfer"
          >确认交接</el-button>
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
</style>
