import { ref } from 'vue'
import { deleteSimulation, downloadSimulationFile, listMySimulations } from '../api/simulations'
import { FILE_TYPES } from '../api/agent'

function getErrorMessage(error, fallback) {
  if (error.code === 'ECONNABORTED') {
    return '文件下载超时，请稍后重试或检查文件大小'
  }

  if (error.message === 'Network Error') {
    return '文件下载连接中断，请检查后端下载接口、代理或文件是否过大'
  }

  return error.response?.data?.detail
    || error.response?.data?.message
    || error.message
    || fallback
}

export function useSimulationRuns() {
  const simulationRuns = ref([])
  const listLoading = ref(false)
  const runActionLoading = ref(false)
  const listError = ref('')
  const downloadingKey = ref('')

  async function loadSimulationRuns() {
    listLoading.value = true
    listError.value = ''

    try {
      const data = await listMySimulations()
      simulationRuns.value = data.data || []
    } catch (error) {
      listError.value = getErrorMessage(error, '仿真记录加载失败')
    } finally {
      listLoading.value = false
    }
  }

  async function downloadFile(simulationId, fileType) {
    const key = `${simulationId}:${fileType}`
    if (downloadingKey.value) return

    downloadingKey.value = key

    try {
      const blob = await downloadSimulationFile(simulationId, fileType)
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const run = simulationRuns.value.find((item) => item.simulation_id === simulationId)

      link.href = blobUrl
      link.download = run?.files?.[fileType] || `${simulationId}_${fileType}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (error) {
      throw new Error(getErrorMessage(error, '文件下载失败'))
    } finally {
      downloadingKey.value = ''
    }
  }

  async function deleteRun(simulationId) {
    const confirmed = window.confirm(`确认删除仿真 ${simulationId} 吗？删除后记录和对应 JSON 文件都会移除。`)
    if (!confirmed) return false

    runActionLoading.value = true

    try {
      await deleteSimulation(simulationId)
      return true
    } catch (error) {
      throw new Error(getErrorMessage(error, `仿真 ${simulationId} 删除失败`))
    } finally {
      runActionLoading.value = false
    }
  }

  return {
    FILE_TYPES,
    simulationRuns,
    listLoading,
    runActionLoading,
    listError,
    downloadingKey,
    loadSimulationRuns,
    downloadFile,
    deleteRun,
  }
}
