export const ROLE_AI_DEV = 'ai_dev'
export const ROLE_VOIP = 'voip'
export const ROLE_AI_QUALITY = 'ai_quality'
export const ROLE_EMBEDDED = 'embedded'

export const DEFAULT_ROLE_DEFINITIONS = [
  { key: ROLE_AI_DEV, name: 'AI开发工程师', short_name: 'AI开发', color: '#165DFF', sort_order: 10, is_system: true, is_active: true },
  { key: ROLE_VOIP, name: 'VOIP工程师', short_name: 'VOIP', color: '#00B42A', sort_order: 20, is_system: true, is_active: true },
  { key: ROLE_AI_QUALITY, name: 'AI质量工程师', short_name: 'AI质量', color: '#FF7D00', sort_order: 30, is_system: true, is_active: true },
  { key: ROLE_EMBEDDED, name: '嵌入式软件工程师', short_name: '嵌入式', color: '#14B8A6', sort_order: 40, is_system: true, is_active: true }
]

export const ROLE_OPTIONS = []
export const ROLE_LABEL = {}
export const ROLE_SHORT_LABEL = {}
export const ROLE_TAG_CLASS = {}
export const ROLE_DOT_COLOR = {}

let currentDefinitions = []

function roleClassForKey(key) {
  if (key === ROLE_AI_DEV) return 'dt-tag-blue'
  if (key === ROLE_VOIP) return 'dt-tag-green'
  if (key === ROLE_AI_QUALITY) return 'dt-tag-orange'
  return 'dt-tag-dynamic'
}

export function setRoleDefinitions(definitions = []) {
  const source = Array.isArray(definitions) && definitions.length ? definitions : DEFAULT_ROLE_DEFINITIONS
  currentDefinitions = source
    .filter(role => role && role.key && role.is_active !== false)
    .map(role => ({
      key: String(role.key),
      name: String(role.name || role.key),
      short_name: String(role.short_name || role.name || role.key),
      color: /^#[0-9a-f]{6}$/i.test(String(role.color || '')) ? String(role.color).toUpperCase() : '#86909C',
      sort_order: Number(role.sort_order || 0),
      is_system: Boolean(role.is_system),
      is_active: role.is_active !== false
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  ROLE_OPTIONS.splice(0, ROLE_OPTIONS.length, ...currentDefinitions.map(role => ({ value: role.key, label: role.name })))
  for (const target of [ROLE_LABEL, ROLE_SHORT_LABEL, ROLE_TAG_CLASS, ROLE_DOT_COLOR]) {
    for (const key of Object.keys(target)) delete target[key]
  }
  for (const role of currentDefinitions) {
    ROLE_LABEL[role.key] = role.name
    ROLE_SHORT_LABEL[role.key] = role.short_name
    ROLE_TAG_CLASS[role.key] = roleClassForKey(role.key)
    ROLE_DOT_COLOR[role.key] = role.color
  }
  const aliases = { frontend: ROLE_AI_DEV, backend: ROLE_AI_DEV, test: ROLE_AI_QUALITY }
  for (const [legacy, canonical] of Object.entries(aliases)) {
    ROLE_LABEL[legacy] = ROLE_LABEL[canonical]
    ROLE_SHORT_LABEL[legacy] = ROLE_SHORT_LABEL[canonical]
    ROLE_TAG_CLASS[legacy] = ROLE_TAG_CLASS[canonical]
    ROLE_DOT_COLOR[legacy] = ROLE_DOT_COLOR[canonical]
  }
  return getRoleDefinitions()
}

export function getRoleDefinitions() {
  return currentDefinitions.map(role => ({ ...role }))
}

export function normalizeRole(role, fallback = ROLE_AI_DEV) {
  const value = String(role || '').trim()
  if (!value) return fallback
  if (value === 'frontend' || value === 'backend') return ROLE_AI_DEV
  if (value === 'test') return ROLE_AI_QUALITY
  return value
}

export function roleLabel(role, compact = false) {
  const key = normalizeRole(role, '')
  if (!key) return '-'
  return (compact ? ROLE_SHORT_LABEL[key] : ROLE_LABEL[key]) || key
}

export function roleColor(role) {
  return ROLE_DOT_COLOR[normalizeRole(role, '')] || '#86909C'
}

export function roleTagStyle(role) {
  const color = roleColor(role)
  return {
    color,
    borderColor: `${color}33`,
    backgroundColor: `${color}14`,
    whiteSpace: 'nowrap'
  }
}

export function isRole(role, expected) {
  return normalizeRole(role) === normalizeRole(expected)
}

setRoleDefinitions(DEFAULT_ROLE_DEFINITIONS)

export const PM_LABEL = 'AI产品经理'
export const PM_SHORT_LABEL = 'AI产品'
