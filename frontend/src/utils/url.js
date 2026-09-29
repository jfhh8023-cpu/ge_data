/**
 * URL and clipboard helpers shared by all link entry points.
 * Generated links always use HTTPS for public hosts; only local development hosts keep the page protocol.
 */

const LOCAL_HOST_PATTERN = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/i

export function getPublicOrigin() {
  const { protocol, hostname, host } = window.location
  if (protocol === 'https:' || LOCAL_HOST_PATTERN.test(hostname)) return window.location.origin
  return `https://${host.replace(/:80$/, '')}`
}

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
  return `${getPublicOrigin()}${getBasePath()}${normalizePath(path)}${normalizeQuery(query)}`
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
