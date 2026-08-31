<script setup>
import { onMounted, ref } from 'vue'
import { http } from './api/http'
import ChatPanel from './components/workspace/ChatPanel.vue'
import LoginPanel from './components/workspace/LoginPanel.vue'
import SimulationTable from './components/workspace/SimulationTable.vue'
import UploadPanel from './components/workspace/UploadPanel.vue'
import WorkspaceShell from './components/workspace/WorkspaceShell.vue'
import { useAgentChat } from './composables/useAgentChat'
import { useAuth } from './composables/useAuth'
import { useFileUpload } from './composables/useFileUpload'
import { useSimulationRuns } from './composables/useSimulationRuns'

const backendStatus = ref('未检测')
const protectedSimulationIds = ref([])
let protectionTimer = null

const {
  username,
  password,
  authLoading,
  authError,
  isLoggedIn,
  login,
  logout,
} = useAuth()

const {
  uploadStatus,
  uploadMessage,
  selectedFileCount,
  handleFileChange,
  handleDrop,
  fileName,
  uploadFiles,
  consumeUploadedBatchId,
  resetUploadSession,
} = useFileUpload()

const {
  message,
  chatList,
  chatLoading,
  historyLoading,
  hasMoreHistory,
  loadHistory,
  loadOlderHistory,
  clearHistory,
  appendMessage,
  sendMessage,
  confirmPendingAction,
} = useAgentChat()

const {
  simulationRuns,
  listLoading,
  runActionLoading,
  listError,
  downloadingKey,
  loadSimulationRuns,
  downloadFile,
  deleteRun,
} = useSimulationRuns()

async function checkBackend() {
  try {
    const response = await http.get('/api/v1/simulations/my', {
      timeout: 3000,
      validateStatus: () => true,
    })
    backendStatus.value = response.status < 500 ? '后端在线' : '后端异常'
  } catch {
    backendStatus.value = '后端未连接'
  }
}

async function handleLogin() {
  const ok = await login()
  if (ok) {
    await loadInitialHistory()
    appendMessage('agent', `登录成功，欢迎 ${username.value}。`)
    await loadSimulationRuns()
  }
}

async function loadInitialHistory() {
  try {
    await loadHistory(50)
  } catch (error) {
    appendMessage('agent', error.response?.data?.detail || error.message || '历史记录加载失败')
  }
}

async function handleLogout() {
  // Conversation history belongs to the account and must survive logout.
  resetUploadSession()
  clearProtectedSimulations()
  logout()
}

async function handleClearHistory() {
  try {
    await clearHistory()
  } catch (error) {
    appendMessage('agent', error.response?.data?.detail || error.message || '清空历史失败')
  }
}

async function handleSendMessage() {
  const batchId = consumeUploadedBatchId()
  const result = await sendMessage({ uploadBatchId: batchId || undefined })

  protectCreatedSimulation(result)

  if (result && result.status !== 'awaiting_confirmation') {
    await loadSimulationRuns()
  }
}

async function handleConfirm(approved, targetThreadId) {
  const result = await confirmPendingAction(approved, targetThreadId)
  resetUploadSession()
  protectCreatedSimulation(result)

  if (result) {
    await loadSimulationRuns()
  }
}

async function handleDelete(simulationId) {
  try {
    const deleted = await deleteRun(simulationId)
    if (deleted) {
      appendMessage('agent', `仿真 ${simulationId} 已删除。`)
      resetUploadSession()
      await loadSimulationRuns()
    }
  } catch (error) {
    appendMessage('agent', error.message || '删除失败')
  }
}

async function handleDownload(simulationId, fileType) {
  try {
    await downloadFile(simulationId, fileType)
  } catch (error) {
    appendMessage('agent', error.response?.data?.detail || error.message || '文件下载失败')
  }
}

function protectCreatedSimulation(result) {
  if (result?.stage !== 'create_execute') return

  const simulationId = result?.data?.simulation_id
  if (!simulationId) return

  protectedSimulationIds.value = [simulationId]

  if (protectionTimer) {
    window.clearTimeout(protectionTimer)
  }

  protectionTimer = window.setTimeout(() => {
    protectedSimulationIds.value = []
    protectionTimer = null
  }, 15000)
}

function clearProtectedSimulations() {
  protectedSimulationIds.value = []

  if (protectionTimer) {
    window.clearTimeout(protectionTimer)
    protectionTimer = null
  }
}

onMounted(async () => {
  await checkBackend()
  if (isLoggedIn.value) {
    await loadInitialHistory()
    await loadSimulationRuns()
  }
})
</script>

<template>
  <div class="page-shell">
    <LoginPanel
      v-if="!isLoggedIn"
      v-model:username="username"
      v-model:password="password"
      :auth-loading="authLoading"
      :auth-error="authError"
      @login="handleLogin"
    />

    <WorkspaceShell
      v-else
      :username="username"
      :backend-status="backendStatus"
      @logout="handleLogout"
    >
      <template #chat>
        <ChatPanel
          v-model:message="message"
          :chat-list="chatList"
          :chat-loading="chatLoading"
          :history-loading="historyLoading"
          :has-more-history="hasMoreHistory"
          @send="handleSendMessage"
          @confirm="handleConfirm(true, $event)"
          @cancel="handleConfirm(false, $event)"
          @load-more-history="loadOlderHistory"
          @clear-history="handleClearHistory"
        />
      </template>

      <template #upload>
        <UploadPanel
          :selected-file-count="selectedFileCount"
          :upload-status="uploadStatus"
          :upload-message="uploadMessage"
          :file-name="fileName"
          @file-change="handleFileChange"
          @file-drop="handleDrop"
          @upload="uploadFiles"
        />
      </template>

      <template #simulations>
        <SimulationTable
          :runs="simulationRuns"
          :list-loading="listLoading"
          :action-loading="runActionLoading || chatLoading || Boolean(downloadingKey)"
          :list-error="listError"
          :downloading-key="downloadingKey"
          :protected-simulation-ids="protectedSimulationIds"
          @refresh="loadSimulationRuns"
          @download="handleDownload"
          @delete="handleDelete"
        />
      </template>
    </WorkspaceShell>
  </div>
</template>
