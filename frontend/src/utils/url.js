/**
 * URL and clipboard helpers shared by all link entry points.
 * Keeps generated links protocol-neutral: HTTP pages emit HTTP links, HTTPS pages emit HTTPS links.
 */

export function getBasePath() {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

export function getApiBasePath() {
  if (import.meta.env.MODE !== 'production') return '/api'
  return `${getBasePath()}api`.replace(/\/$/, '')
}

function normalizePath(path) {
  return String(path || '').replace(/^\/+/, '')
}

function normalizeQuery(query) {
  if (!query) return ''
  if (typeof query === 'string') {
    if (!query) return ''
    return query.startsWith('?') ? query : `?${query}`
  }
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function buildAppUrl(path = '', query = null) {
  return `${window.location.origin}${getBasePath()}${normalizePath(path)}${normalizeQuery(query)}`
}

export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('execCommand copy failed')
}
