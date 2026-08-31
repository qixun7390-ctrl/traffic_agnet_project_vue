import { http } from './http'

export const FILE_TYPES = ['map_file', 'signal_file', 'stop_file', 'order_file', 'bus_file']

export const FILE_LABELS = {
  map_file: '地图文件',
  signal_file: '信号文件',
  stop_file: '站点文件',
  order_file: '订单文件',
  bus_file: '车辆文件',
}

const TOKEN_KEY = 'traffic_agent_token'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const TERMINAL_EVENTS = new Set(['confirmation_required', 'error', 'done'])

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json()
    return data.detail || data.message || response.statusText
  } catch {
    return response.statusText
  }
}

function parseSseChunk(chunk) {
  const lines = chunk.split('\n')
  let eventName = 'message'
  const dataLines = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }

  if (dataLines.length === 0) return null

  const rawData = dataLines.join('\n')
  let data
  try {
    data = JSON.parse(rawData)
  } catch {
    data = { raw: rawData }
  }

  return { event: eventName, data }
}

export async function readSseStream(response, onEvent) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('当前浏览器不支持读取流式响应')
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let hasTerminalEvent = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''

    for (const chunk of chunks) {
      const event = parseSseChunk(chunk)
      if (event) {
        if (TERMINAL_EVENTS.has(event.event)) {
          hasTerminalEvent = true
        }

        const shouldContinue = onEvent(event)
        if (shouldContinue === false) {
          await reader.cancel()
          return
        }
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseChunk(buffer)
    if (event) {
      if (TERMINAL_EVENTS.has(event.event)) {
        hasTerminalEvent = true
      }
      onEvent(event)
    }
  }

  if (!hasTerminalEvent) {
    throw new Error('流式响应异常结束，未收到任务完成、失败或等待确认事件')
  }
}

export async function uploadAgentFiles(files) {
  const formData = new FormData()

  FILE_TYPES.forEach((field) => {
    formData.append(field, files[field])
  })

  const response = await http.post('/api/v1/agent/upload-files', formData)
  return response.data
}

export async function runAgent(payload) {
  const response = await http.post('/api/v1/agent/run', payload)
  return response.data
}

export async function resumeAgent(payload) {
  const response = await http.post('/api/v1/agent/resume', payload)
  return response.data
}

export async function runAgentStream(payload, onEvent, options = {}) {
  const response = await fetch(apiUrl('/api/v1/agent/run/stream'), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  })

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response))
  }

  await readSseStream(response, onEvent)
}

export async function resumeAgentStream(payload, onEvent, options = {}) {
  const response = await fetch(apiUrl('/api/v1/agent/resume/stream'), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  })

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response))
  }

  await readSseStream(response, onEvent)
}

export async function listAgentMessages(params = {}) {
  const response = await http.get('/api/v1/agent/messages', {
    params,
  })
  return response.data
}

export async function clearAgentMessages() {
  const response = await http.delete('/api/v1/agent/messages')
  return response.data
}
