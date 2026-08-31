import { ref } from 'vue'
import { clearAgentMessages, listAgentMessages, resumeAgentStream, runAgentStream } from '../api/agent'

const DEFAULT_WELCOME_MESSAGE = '欢迎进入交通仿真智能体工作台。请先上传 5 个 JSON 文件，然后输入创建仿真的指令。'
// SSE reader keeps draining the network stream immediately. This delay only
// controls the pace at which already-received workflow events reach the UI.
const STREAM_STEP_DELAY_MS = 850
const TYPEWRITER_DELAY_MS = 18
const TERMINAL_EVENTS = new Set(['confirmation_required', 'error', 'done'])
const COMPLETED_MESSAGE_EVENTS = new Set(['done', 'error'])
const BUSINESS_OPERATIONS = new Set(['create', 'query', 'delete'])

function mapHistoryRole(message) {
  if (message.event_type === 'confirmation_required') return 'confirm'
  if (message.role === 'user') return 'user'
  return 'agent'
}

function mapHistoryContent(message) {
  if (message.content) return message.content
  if (message.payload?.message) return message.payload.message
  return message.event_type || '消息'
}

function mapHistoryItems(records, activeConfirmationIndex = -1) {
  return records.map((item, index) => ({
    role: mapHistoryRole(item),
    type: 'text',
    content: mapHistoryContent(item),
    eventType: item.event_type,
    isActiveConfirmation: item.event_type === 'confirmation_required' && index === activeConfirmationIndex,
  }))
}

function findPendingConfirmation(records) {
  const completedThreadIds = new Set()

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const item = records[index]

    if (COMPLETED_MESSAGE_EVENTS.has(item.event_type)) {
      completedThreadIds.add(item.thread_id)
      continue
    }

    if (item.event_type === 'confirmation_required' && !completedThreadIds.has(item.thread_id)) {
      return {
        index,
        threadId: item.thread_id,
        confirmation: item.payload?.data?.interrupt?.pending_action || null,
      }
    }
  }

  return null
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getStreamErrorMessage(error) {
  const message = error?.message || ''
  const lowerMessage = message.toLowerCase()

  if (
    lowerMessage === 'network error'
    || lowerMessage.includes('failed to fetch')
    || lowerMessage.includes('incomplete')
    || lowerMessage.includes('terminated')
  ) {
    return '流式连接中断，请检查后端日志、数据库迁移或服务器代理配置。'
  }

  return message || '请求没有正常到达后端'
}

function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted')
}

function buildFinalStepMessage(data, fallback) {
  let content = data?.message || fallback

  if (data?.data?.simulation_id) {
    content += `，simulation_id = ${data.data.simulation_id}`
  }

  if (data?.data?.message && data.data.message !== data.message) {
    content += `，${data.data.message}`
  }

  return content
}

function inferOperationFromStage(stage) {
  if (!stage) return null
  if (stage.startsWith('create_') || stage.includes('create')) return 'create'
  if (stage.startsWith('query_') || stage.includes('query')) return 'query'
  if (stage.startsWith('delete_') || stage.includes('delete')) return 'delete'
  if (stage === 'chat') return 'chat'
  return null
}

function createEventQueue(handler) {
  const queue = []
  let consuming = false
  const waiters = []

  async function drain() {
    if (consuming) return
    consuming = true

    try {
      while (queue.length > 0) {
        const item = queue.shift()
        await sleep(STREAM_STEP_DELAY_MS)
        await handler(item)
      }
    } finally {
      consuming = false
      if (queue.length === 0) {
        while (waiters.length > 0) {
          const resolve = waiters.shift()
          resolve()
        }
      } else {
        void drain()
      }
    }
  }

  return {
    push(item) {
      queue.push(item)
      void drain()
    },
    waitIdle() {
      if (!consuming && queue.length === 0) {
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}

export function useAgentChat() {
  const message = ref('')
  const chatList = ref([
    {
      role: 'agent',
      type: 'text',
      content: DEFAULT_WELCOME_MESSAGE,
      eventType: 'system',
      isActiveConfirmation: false,
    },
  ])
  const threadId = ref('')
  const chatLoading = ref(false)
  const historyLoading = ref(false)
  const hasMoreHistory = ref(false)
  const historyBefore = ref('')
  let activeController = null

  function createRequestController() {
    if (activeController) {
      activeController.abort()
    }

    activeController = new AbortController()
    return activeController
  }

  function appendMessage(role, content, extra = {}) {
    chatList.value.push({
      role,
      type: extra.type || 'text',
      content,
      eventType: extra.eventType || 'message',
      isActiveConfirmation: Boolean(extra.isActiveConfirmation),
    })
  }

  async function appendTypingMessage(role, content, extra = {}) {
    const text = content || ''
    appendMessage(role, '', extra)
    const item = chatList.value[chatList.value.length - 1]

    for (const char of text) {
      item.content += char
      await sleep(TYPEWRITER_DELAY_MS)
    }

    return item
  }

  function appendTaskMessage(title = 'Traffic Agent 正在处理', extra = {}) {
    const task = {
      role: 'agent',
      type: 'task',
      threadId: extra.threadId || '',
      title,
      status: 'running',
      steps: [],
      confirmation: null,
      eventType: 'task',
    }

    chatList.value.push(task)
    return task
  }
  //根据后端任务ID找前端任务卡
  function findTaskByThreadId(targetThreadId){
    if (!targetThreadId) return null

    return chatList.value.find(
      item => item.type === 'task' && item.threadId === targetThreadId
    ) || null
  }
  //将thread_id写入当前卡片
  function syncTaskThreadId(task, data) {
    if (!task || !data?.thread_id) return

    task.threadId = data.thread_id
    threadId.value = data.thread_id
  }
  //获取后端传入信息
  function getPendingAction(data) {
    return data?.data?.interrupt?.pending_action || null
  }
  //将后端传入的确认信息存入任务卡
  function setTaskConfirmation(task, data){
    if (!task) return
    
    task.confirmation = getPendingAction(data)
  }
  //用户确认或取消后，把当前任务卡上的确认状态清除
  function clearTaskConfirmation(task) {
    if (task) {
      task.confirmation = null
    }
  }

  async function cancelPendingConfirmationBeforeNewRequest() {
    if (!threadId.value) return

    const targetThreadId = threadId.value
    const task = findTaskByThreadId(targetThreadId)
    if (task?.confirmation) {
      clearTaskConfirmation(task)
      task.status = 'cancelled'
      addTaskStep(task, '请求已被新的用户请求取消', 'error')
    }

    threadId.value = ''

    try {
      await resumeAgentStream(
        {
          thread_id: targetThreadId,
          approved: false,
        },
        ({ event }) => !TERMINAL_EVENTS.has(event),
      )
    } catch (error) {
      if (task) {
        addTaskStep(task, `旧任务已在前端取消，但后端取消同步失败：${getStreamErrorMessage(error)}`, 'error')
      }
    }
  }

  function addTaskStep(task, text, status = 'done') {
    if (!task || !text) return

    task.steps.push({
      text,
      status,
    })
  }

  function getOperation(data) {
    return (
      data?.operation
      || data?.data?.operation
      || data?.data?.interrupt?.pending_action?.operation
      || inferOperationFromStage(data?.stage)
    )
  }

  function isBusinessOperation(data) {
    return BUSINESS_OPERATIONS.has(getOperation(data))
  }

  function resetConversation() {
    chatList.value = [
      {
        role: 'agent',
        type: 'text',
        content: DEFAULT_WELCOME_MESSAGE,
        eventType: 'system',
        isActiveConfirmation: false,
      },
    ]
    threadId.value = ''
    hasMoreHistory.value = false
    historyBefore.value = ''
  }

  function applyPagination(pagination) {
    hasMoreHistory.value = Boolean(pagination?.has_more)
    historyBefore.value = pagination?.next_before || ''
  }

  function applyPendingConfirmation(pending) {
    if (pending) {
      threadId.value = pending?.threadId || ''
      return
    }

    threadId.value = ''
  }

  async function loadHistory(limit = 50) {
    historyLoading.value = true
    try {
      const data = await listAgentMessages({ limit })
      const records = data.data || []
      applyPagination(data.pagination)

      if (records.length === 0) {
        resetConversation()
        return []
      }

      const pendingConfirmation = findPendingConfirmation(records)
      chatList.value = mapHistoryItems(records, pendingConfirmation?.index)
      applyPendingConfirmation(pendingConfirmation)
      return records
    } finally {
      historyLoading.value = false
    }
  }

  async function loadOlderHistory(limit = 50) {
    if (!hasMoreHistory.value || historyLoading.value || !historyBefore.value) {
      return []
    }

    historyLoading.value = true
    try {
      const data = await listAgentMessages({
        limit,
        before: historyBefore.value,
      })
      const records = data.data || []
      applyPagination(data.pagination)

      if (records.length === 0) {
        return []
      }

      chatList.value = [...mapHistoryItems(records), ...chatList.value]
      return records
    } finally {
      historyLoading.value = false
    }
  }

  async function clearHistory() {
    await clearAgentMessages()
    resetConversation()
  }

  async function sendMessage(options = {}) {
    const text = message.value.trim()
    if (!text) {
      appendMessage('agent', '请输入你的指令。')
      return null
    }

    await cancelPendingConfirmationBeforeNewRequest()
    appendMessage('user', text)
    message.value = ''
    chatLoading.value = true
    const requestController = createRequestController()

    let taskMessage = null
    const pendingTaskSteps = []

    function ensureTaskMessage() {
      if (taskMessage) return taskMessage

      taskMessage = appendTaskMessage('正在处理仿真任务')
      addTaskStep(taskMessage, '已接收到用户请求，请等待后端流式响应', 'running')
      for (const step of pendingTaskSteps) {
        addTaskStep(taskMessage, step.text, step.status)
      }
      pendingTaskSteps.length = 0
      return taskMessage
    }

    let eventQueue

    try {
      const payload = {
        message: text,
      }

      if (options.uploadBatchId) {
        payload.upload_batch_id = options.uploadBatchId
      }

      if (options.threadId) {
        payload.thread_id = options.threadId
      }

      let finalData = null
      eventQueue = createEventQueue(async ({ event, data }) => {
        if (event === 'done' && data?.stage === 'chat') {
          await appendTypingMessage('agent', data.message || '我目前可以帮你处理交通仿真的创建、查询和删除。')
          finalData = data
          return
        }

        if (event === 'status') {
          const step = {
            text: data.message || '正在处理中',
            status: 'done',
          }
          const operation = getOperation(data)

          if (!taskMessage && operation === 'chat') {
            pendingTaskSteps.length = 0
            return
          }

          if (!taskMessage && !isBusinessOperation(data)) {
            pendingTaskSteps.push(step)
            return
          }

          const currentTask = ensureTaskMessage()
          syncTaskThreadId(currentTask, data)
          addTaskStep(currentTask, step.text, step.status)
          return 
        }

        if (!taskMessage && getOperation(data) === 'chat') {
          await appendTypingMessage('agent', data.message || '我目前可以帮你处理交通仿真的创建、查询和删除。')
          finalData = data
          return
        }

        const currentTask = ensureTaskMessage()
        syncTaskThreadId(currentTask, data)
      

        if (event === 'confirmation_required') {
          currentTask.status = 'waiting'
          threadId.value = data.thread_id || ''
          setTaskConfirmation(currentTask, data)
          addTaskStep(currentTask, data.message || '等待用户确认', 'waiting')
          finalData = data
          return
        }

        if (event === 'error') {
          currentTask.status = 'error'
          addTaskStep(currentTask, data.message || '执行失败', 'error')
          finalData = data
          return
        }

        if (event === 'done') {
          currentTask.status = 'done'
          addTaskStep(currentTask, buildFinalStepMessage(data, '处理完成'))
          finalData = data
          return
        }

        addTaskStep(currentTask, data.message || data.raw || '收到事件')
      })

      await runAgentStream(payload, ({ event, data }) => {
        eventQueue.push({ event, data })
        if (TERMINAL_EVENTS.has(event)) {
          return false
        }
        return true
      }, { signal: requestController.signal })

      await eventQueue.waitIdle()
      return finalData
    } catch (error) {
      if (isAbortError(error)) {
        if (taskMessage) {
          taskMessage.status = 'cancelled'
          addTaskStep(taskMessage, '请求已被新的用户请求取消', 'error')
        }
        return null
      }

      const errorData = { message: getStreamErrorMessage(error) }
      if (eventQueue) {
        eventQueue.push({ event: 'error', data: errorData })
        await eventQueue.waitIdle()
      } else {
        const currentTask = ensureTaskMessage()
        currentTask.status = 'error'
        addTaskStep(currentTask, errorData.message, 'error')
      }
      return null
    } finally {
      if (activeController === requestController) {
        activeController = null
        chatLoading.value = false
      }
    }
  }

  async function confirmPendingAction(approved, targetThreadId = threadId.value) {
    if (!targetThreadId) {
      appendMessage('agent', '没有可以恢复的任务。')
      return null
    }

    chatLoading.value = true

    const taskMessage = findTaskByThreadId(targetThreadId)
    if (!taskMessage) {
      appendMessage('agent', '没有找到对应的任务卡，请重新发起任务')
      chatLoading.value = false
      return null
    }

    const requestController = createRequestController()
    clearTaskConfirmation(taskMessage)
    if (approved) {
      taskMessage.status = 'running'
      addTaskStep(taskMessage, '用户已确认,继续执行任务')
    } else {
      taskMessage.status = 'cancelled'
      addTaskStep(taskMessage, '用户已取消操作', 'error')
    }
    let eventQueue

    try {
      const payload = {
        thread_id: targetThreadId,
        approved,
      }

      let finalData = null
      eventQueue = createEventQueue(({ event, data }) => {
        if (event === 'status') {
          addTaskStep(taskMessage, data.message || '正在恢复任务')
          return
        }

        if (event === 'confirmation_required') {
          taskMessage.status = 'waiting'
          addTaskStep(taskMessage, data.message || '等待用户确认', 'waiting')
          threadId.value = data.thread_id || targetThreadId
          setTaskConfirmation(taskMessage, data)
          finalData = data
          return
        }

        if (event === 'error') {
          taskMessage.status = 'error'
          addTaskStep(taskMessage, data.message || '恢复任务失败', 'error')
          finalData = data
          return
        }

        if (event === 'done') {
          taskMessage.status = data.status === 'cancelled' ? 'cancelled' : 'done'
          addTaskStep(taskMessage, buildFinalStepMessage(data, '任务完成'))
          finalData = data
          return
        }

        addTaskStep(taskMessage, data.message || data.raw || '收到事件')
      })

      await resumeAgentStream(payload, ({ event, data }) => {
        eventQueue.push({ event, data })
        if (TERMINAL_EVENTS.has(event)) {
          return false
        }
        return true
      }, { signal: requestController.signal })

      await eventQueue.waitIdle()

      if (threadId.value === targetThreadId && finalData?.status !== 'awaiting_confirmation') {
        threadId.value = ''
      }

      return finalData
    } catch (error) {
      if (isAbortError(error)) {
        taskMessage.status = 'cancelled'
        addTaskStep(taskMessage, '请求已被新的用户请求取消', 'error')
        return null
      }

      const errorData = { message: getStreamErrorMessage(error) }
      if (eventQueue) {
        eventQueue.push({ event: 'error', data: errorData })
        await eventQueue.waitIdle()
      } else {
        taskMessage.status = 'error'
        addTaskStep(taskMessage, errorData.message, 'error')
      }
      return null
    } finally {
      if (activeController === requestController) {
        activeController = null
        chatLoading.value = false
      }
    }
  }

  return {
    message,
    chatList,
    threadId,
    chatLoading,
    historyLoading,
    hasMoreHistory,
    appendMessage,
    loadHistory,
    loadOlderHistory,
    clearHistory,
    sendMessage,
    confirmPendingAction,
  }
}
