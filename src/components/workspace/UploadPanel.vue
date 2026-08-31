<script setup>
import { FILE_LABELS, FILE_TYPES } from '../../api/agent'

const props = defineProps({
  selectedFileCount: { type: Number, required: true },
  uploadStatus: { type: String, required: true },
  uploadMessage: { type: String, default: '' },
  fileName: { type: Function, required: true },
})

const emit = defineEmits(['file-change', 'file-drop', 'upload'])
</script>

<template>
  <div class="upload-panel panel-card">
    <div class="panel-title-row">
      <div>
        <h2>上传 JSON 文件</h2>
        <p>地图、信号、站点、订单、车辆五类文件。</p>
      </div>
      <div class="file-counter">{{ props.selectedFileCount }}/5</div>
    </div>

    <div class="file-grid">
      <label
        v-for="field in FILE_TYPES"
        :key="field"
        class="file-slot"
        @dragover.prevent
        @drop.prevent="emit('file-drop', $event, field)"
      >
        <input type="file" accept=".json,application/json" @change="emit('file-change', $event, field)" />
        <span class="file-label">{{ FILE_LABELS[field] }}</span>
        <strong>{{ field }}</strong>
        <em>{{ props.fileName(field) }}</em>
      </label>
    </div>

    <div class="upload-footer">
      <p :class="['upload-message', props.uploadStatus]">
        {{ props.uploadMessage || '选择完整 5 个文件后，点击上传并校验。' }}
      </p>
      <button class="primary-button" :disabled="props.uploadStatus === 'uploading'" @click="emit('upload')">
        {{ props.uploadStatus === 'uploading' ? '上传中...' : '上传并校验' }}
      </button>
    </div>
  </div>
</template>
