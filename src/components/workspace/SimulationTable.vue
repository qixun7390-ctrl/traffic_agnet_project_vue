<script setup>
import { FILE_TYPES } from '../../api/agent'

const props = defineProps({
  runs: { type: Array, required: true },
  listLoading: { type: Boolean, default: false },
  actionLoading: { type: Boolean, default: false },
  listError: { type: String, default: '' },
  downloadingKey: { type: String, default: '' },
  protectedSimulationIds: { type: Array, default: () => [] },
})

const emit = defineEmits(['refresh', 'download', 'delete'])

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readableStatus(status) {
  if (!status) return '未知'
  if (status === 'CREATED') return '已创建'
  return status
}

function shortFileType(fileType) {
  return fileType.replace('_file', '')
}

function isDeleteDisabled(simulationId) {
  return props.actionLoading || props.protectedSimulationIds.includes(simulationId)
}
</script>

<template>
  <div class="simulation-panel panel-card">
    <div class="panel-title-row">
      <div>
        <h2>仿真记录</h2>
        <p>simulation_id、status、上传文件下载与删除。</p>
      </div>
      <button class="ghost-button" :disabled="props.listLoading" @click="emit('refresh')">刷新</button>
    </div>

    <p v-if="props.listError" class="table-error">{{ props.listError }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>simulation_id</th>
            <th>status</th>
            <th>created_at</th>
            <th>上传文件下载</th>
            <th>删除</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="props.listLoading">
            <td colspan="5" class="empty-cell">正在加载仿真记录...</td>
          </tr>
          <tr v-else-if="props.runs.length === 0">
            <td colspan="5" class="empty-cell">暂无仿真记录。上传文件并创建仿真后，这里会出现记录。</td>
          </tr>
          <tr v-for="run in props.runs" v-else :key="run.simulation_id">
            <td class="mono">{{ run.simulation_id }}</td>
            <td><span class="run-status">{{ readableStatus(run.status) }}</span></td>
            <td class="mono">{{ formatDate(run.created_at) }}</td>
            <td>
              <div class="download-buttons">
                <button
                  v-for="fileType in FILE_TYPES"
                  :key="fileType"
                  class="link-button"
                  :disabled="Boolean(props.downloadingKey)"
                  :title="run.files?.[fileType] || fileType"
                  @click="emit('download', run.simulation_id, fileType)"
                >
                  {{ shortFileType(fileType) }}
                </button>
              </div>
            </td>
            <td>
              <button class="danger-button" :disabled="isDeleteDisabled(run.simulation_id)" @click="emit('delete', run.simulation_id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
