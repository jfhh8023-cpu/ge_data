<script setup>
/**
 * PersonnelPage.vue — 团队人员管理页
 * 功能：CRUD 人员名单（姓名 + 角色）
 * 通过 Header 右侧「团」徽章进入
 *
 * v1.1.0 改动：
 *   - REQ-20: 从表格改为卡片式网格布局
 */
import { ref, onMounted } from 'vue'
import { useStaffStore } from '../stores/staff'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackButton from '../components/BackButton.vue'

const staffStore = useStaffStore()
const pageLoading = ref(true)  // v1.4.3: 页面初始加载状态

/** 弹窗状态 */
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const form = ref({ name: '', role: 'frontend' })

/** 角色选项 */
const ROLE_OPTIONS = [
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'test', label: '测试' }
]

/** 角色标签颜色映射 */
const ROLE_TAG_CLASS = {
  frontend: 'dt-tag-blue',
  backend: 'dt-tag-green',
  test: 'dt-tag-orange'
}

const ROLE_LABEL = {
  frontend: '前端',
  backend: '后端',
  test: '测试'
}

const ROLE_AVATAR_COLOR = {
  frontend: '#165DFF',
  backend: '#00B42A',
  test: '#FF7D00'
}

onMounted(async () => {
  pageLoading.value = true
  await staffStore.fetchAll()
  pageLoading.value = false
})

/** 人员头像首字 */
function getInitial(name) {
  return name ? name.charAt(name.length - 1) : '?'
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
  } catch {
    ElMessage.error('操作失败')
  }
}

async function handleDelete(staff) {
  try {
    await ElMessageBox.confirm(`确认删除「${staff.name}」？`, '删除人员', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await staffStore.remove(staff.id)
    ElMessage.success('已删除')
  } catch {
    // 用户取消
  }
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
        <h1 class="dt-page-title">团队人员</h1>
        <p class="dt-page-description">管理研发团队成员名单</p>
      </div>
      <div style="display:flex; gap:8px;">
        <el-button circle @click="staffStore.fetchAll()" title="刷新数据" style="font-size:16px;">🔄</el-button>
        <el-button type="primary" @click="openCreate">+ 新增人员</el-button>
      </div>
    </div>

    <!-- 加载骨架 -->
    <el-skeleton v-if="staffStore.loading" :rows="4" animated />

    <!-- 空状态 -->
    <div v-else-if="staffStore.list.length === 0" class="dt-empty" style="padding:60px;">
      <div class="dt-empty-icon">👥</div>
      <p class="dt-empty-text">暂无团队人员，请点击上方按钮添加</p>
    </div>

    <!-- 卡片式网格布局（REQ-20） -->
    <div v-else class="dt-staff-grid">
      <div
        v-for="staff in staffStore.list"
        :key="staff.id"
        class="dt-staff-card"
      >
        <!-- 卡片右上角操作 -->
        <div class="dt-staff-card-actions">
          <el-button type="primary" link size="small" @click="openEdit(staff)">编辑</el-button>
          <el-button type="danger" link size="small" @click="handleDelete(staff)">删除</el-button>
        </div>

        <!-- 头像 -->
        <div class="dt-staff-card-avatar" :style="{ background: ROLE_AVATAR_COLOR[staff.role] || '#165DFF' }">
          {{ getInitial(staff.name) }}
        </div>

        <!-- 姓名 -->
        <div class="dt-staff-card-name">{{ staff.name }}</div>

        <!-- 角色 Tag -->
        <span class="dt-tag" :class="ROLE_TAG_CLASS[staff.role]" style="font-size:12px;">
          {{ ROLE_LABEL[staff.role] || '-' }}
        </span>

        <!-- 状态徽章 -->
        <span class="dt-badge dt-staff-card-status" :class="staff.is_active ? 'dt-badge-active' : 'dt-badge-draft'">
          {{ staff.is_active ? '在职' : '离职' }}
        </span>
      </div>
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
/* === 卡片网格布局（REQ-20） === */
.dt-staff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.dt-staff-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 20px 20px;
  background: var(--color-bg-white, #fff);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid var(--color-border-light, #F2F3F5);
  transition: all 0.25s cubic-bezier(0.34, 0.69, 0.1, 1);
}

.dt-staff-card:hover {
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
  border-color: var(--color-primary-light, #BEDAFF);
}

/* 右上角操作按钮 */
.dt-staff-card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.dt-staff-card:hover .dt-staff-card-actions {
  opacity: 1;
}

/* 头像 */
.dt-staff-card-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-bottom: 12px;
}

/* 姓名 */
.dt-staff-card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-1, #1D2129);
  margin-bottom: 8px;
}

/* 状态 */
.dt-staff-card-status {
  margin-top: 8px;
  font-size: 11px;
}
</style>
