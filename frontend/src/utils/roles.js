export const ROLE_AI_DEV = 'ai_dev'
export const ROLE_VOIP = 'voip'
export const ROLE_AI_QUALITY = 'ai_quality'

export const ROLE_OPTIONS = [
  { value: ROLE_AI_DEV, label: 'AI开发工程师' },
  { value: ROLE_VOIP, label: 'VOIP工程师' },
  { value: ROLE_AI_QUALITY, label: 'AI质量工程师' }
]

export const ROLE_LABEL = {
  [ROLE_AI_DEV]: 'AI开发工程师',
  [ROLE_VOIP]: 'VOIP工程师',
  [ROLE_AI_QUALITY]: 'AI质量工程师',
  frontend: 'AI开发工程师',
  backend: 'AI开发工程师',
  test: 'AI质量工程师'
}

export const ROLE_SHORT_LABEL = {
  [ROLE_AI_DEV]: 'AI开发',
  [ROLE_VOIP]: 'VOIP',
  [ROLE_AI_QUALITY]: 'AI质量',
  frontend: 'AI开发',
  backend: 'AI开发',
  test: 'AI质量'
}

export const PM_LABEL = 'AI产品经理'
export const PM_SHORT_LABEL = 'AI产品'

export const ROLE_TAG_CLASS = {
  [ROLE_AI_DEV]: 'dt-tag-blue',
  [ROLE_VOIP]: 'dt-tag-green',
  [ROLE_AI_QUALITY]: 'dt-tag-orange',
  frontend: 'dt-tag-blue',
  backend: 'dt-tag-blue',
  test: 'dt-tag-orange'
}

export const ROLE_DOT_COLOR = {
  [ROLE_AI_DEV]: '#165DFF',
  [ROLE_VOIP]: '#00B42A',
  [ROLE_AI_QUALITY]: '#FF7D00',
  frontend: '#165DFF',
  backend: '#165DFF',
  test: '#FF7D00'
}

export function normalizeRole(role, fallback = ROLE_AI_DEV) {
  const value = String(role || '').trim()
  if ([ROLE_AI_DEV, 'frontend', 'backend'].includes(value)) return ROLE_AI_DEV
  if (value === ROLE_VOIP) return ROLE_VOIP
  if ([ROLE_AI_QUALITY, 'test'].includes(value)) return ROLE_AI_QUALITY
  return fallback
}

export function isRole(role, expected) {
  return normalizeRole(role) === normalizeRole(expected)
}
