import { API_BASE_URL, http } from './http'

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000
const TOKEN_KEY = 'traffic_agent_token'

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseDownloadError(response) {
  try {
    const data = await response.json()
    return data.detail || data.message || response.statusText
  } catch {
    return response.statusText
  }
}

export async function listMySimulations() {
  const response = await http.get('/api/v1/simulations/my')
  return response.data
}

export async function deleteSimulation(simulationId) {
  const response = await http.delete(`/api/v1/simulations/${simulationId}`)
  return response.data
}

export async function downloadSimulationFile(simulationId, fileType) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort()
  }, DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(apiUrl(`/api/v1/simulations/${simulationId}/files/${fileType}`), {
      method: 'GET',
      headers: authHeaders(),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await parseDownloadError(response))
    }

    return await response.blob()
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('文件下载超时，请稍后重试或检查文件大小')
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}
