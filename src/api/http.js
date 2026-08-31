import axios from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
})

export function setAuthToken(token) {
  if (token) {
    http.defaults.headers.common.Authorization = `Bearer ${token}`
    return
  }

  delete http.defaults.headers.common.Authorization
}
