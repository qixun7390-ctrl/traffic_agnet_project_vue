<script setup>
import { computed } from 'vue'

const props = defineProps({
  confirmation: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

const parameterItems = computed(() => {
  const confirmation = props.confirmation
  const arguments_ = confirmation?.arguments

  if (!arguments_) return []

  if (confirmation.operation === 'delete') {
    return arguments_.simulation_id
      ? [{ label: '仿真 ID', value: arguments_.simulation_id }]
      : []
  }

  const items = [
    { label: '仿真名称', value: arguments_.name || '系统自动生成' },
    { label: '仿真时长', value: `${arguments_.running_time_step ?? 3600} 秒` },
    { label: '随机匹配', value: arguments_.use_random_match === false ? '关闭' : '开启' },
    { label: '成本计算', value: arguments_.use_cost === false ? '关闭' : '开启' },
  ]

  if (arguments_.description) {
    items.splice(2, 0, { label: '描述', value: arguments_.description })
  }

  const attachmentCount = Object.keys(arguments_.attachments || {}).length
  if (attachmentCount > 0) {
    items.push({ label: '已校验文件', value: `${attachmentCount} 类` })
  }

  return items
})
</script>

<template>
  <section v-if="parameterItems.length" class="confirm-summary" aria-label="待确认参数">
    <p class="confirm-summary-title">请确认本次操作参数</p>
    <dl class="confirm-parameter-list">
      <div v-for="item in parameterItems" :key="item.label" class="confirm-parameter-row">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
  </section>

  <div class="confirm-actions">
    <button class="secondary-button" :disabled="props.loading" @click="emit('cancel')">取消</button>
    <button class="primary-button small" :disabled="props.loading" @click="emit('confirm')">确认执行</button>
  </div>
</template>

<style scoped>
.confirm-summary {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #e3cce9;
  border-radius: 6px;
  background: #fbf7fd;
}

.confirm-summary-title {
  margin: 0 0 8px;
  color: #542066;
  font-size: 13px;
  font-weight: 700;
}

.confirm-parameter-list {
  display: grid;
  gap: 6px;
  margin: 0;
}

.confirm-parameter-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.confirm-parameter-row dt {
  color: #7a7280;
}

.confirm-parameter-row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: #2c2630;
}
</style>
