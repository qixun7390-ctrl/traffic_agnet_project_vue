import { computed, ref } from 'vue'
import { FILE_TYPES, uploadAgentFiles } from '../api/agent'

export function useFileUpload() {
  function createEmptyAttachments() {
    return {
      map_file: null,
      signal_file: null,
      stop_file: null,
      order_file: null,
      bus_file: null,
    }
  }

  const attachments = ref(createEmptyAttachments())
  const uploadedBatchId = ref('')
  const uploadStatus = ref('idle')
  const uploadMessage = ref('')

  const selectedFileCount = computed(() => FILE_TYPES.filter((field) => attachments.value[field]).length)
  const hasAllFiles = computed(() => FILE_TYPES.every((field) => attachments.value[field]))

  function resetUploadedResult(message = '文件已变更，请重新上传并校验') {
    uploadedBatchId.value = ''
    uploadStatus.value = 'idle'
    uploadMessage.value = message
  }

  function setFile(field, file) {
    if (!file) return
    attachments.value[field] = file
    resetUploadedResult()
  }

  function handleFileChange(event, field) {
    setFile(field, event.target.files?.[0])
  }

  function handleDrop(event, field) {
    setFile(field, event.dataTransfer.files?.[0])
  }

  function fileName(field) {
    return attachments.value[field]?.name || '未选择文件'
  }

  async function uploadFiles() {
    if (!hasAllFiles.value) {
      uploadStatus.value = 'failed'
      uploadMessage.value = '请先选择完整的 5 个 JSON 文件'
      return null
    }

    uploadStatus.value = 'uploading'
    uploadMessage.value = '正在上传并校验文件...'

    try {
      const data = await uploadAgentFiles(attachments.value)

      if (data.validation_status !== 'PASSED') {
        uploadStatus.value = 'failed'
        uploadMessage.value = data.error || '文件校验失败'
        return null
      }

      uploadedBatchId.value = data.batch_id
      attachments.value = createEmptyAttachments()
      uploadStatus.value = 'passed'
      uploadMessage.value = '文件上传并校验成功，本次登录可用于创建仿真'
      return data.batch_id
    } catch (error) {
      uploadStatus.value = 'failed'
      uploadMessage.value = error.response?.data?.detail || error.message || '文件上传失败'
      return null
    }
  }

  async function ensureUploadedBatchId() {
    if (uploadedBatchId.value) return uploadedBatchId.value
    if (!hasAllFiles.value) return ''
    return await uploadFiles()
  }

  function consumeUploadedBatchId() {
    const batchId = uploadedBatchId.value
    uploadedBatchId.value = ''

    if (batchId && uploadStatus.value === 'passed') {
      uploadStatus.value = 'idle'
      uploadMessage.value = ''
    }

    return batchId
  }

  function clearUploadNotice() {
    if (uploadStatus.value === 'passed') {
      uploadStatus.value = 'idle'
      uploadMessage.value = ''
    }
  }

  function resetUploadSession() {
    attachments.value = createEmptyAttachments()
    uploadedBatchId.value = ''
    uploadStatus.value = 'idle'
    uploadMessage.value = ''
  }

  return {
    attachments,
    uploadedBatchId,
    uploadStatus,
    uploadMessage,
    selectedFileCount,
    hasAllFiles,
    handleFileChange,
    handleDrop,
    fileName,
    uploadFiles,
    ensureUploadedBatchId,
    consumeUploadedBatchId,
    clearUploadNotice,
    resetUploadSession,
  }
}

