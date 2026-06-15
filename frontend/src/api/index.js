import axios from 'axios'
import { getApiBasePath } from '../utils/url'

const api = axios.create({
  baseURL: getApiBasePath(),
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
})

/* 响应拦截 — 统一错误处理 */
api.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.message || '网络异常'
    console.error('[API Error]', msg)
    return Promise.reject(err)
  }
)

export default api
