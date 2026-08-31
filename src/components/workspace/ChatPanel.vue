<script setup>
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import ConfirmationCard from './ConfirmationCard.vue'

const props = defineProps({
  chatList: { type: Array, required: true },
  message: { type: String, required: true },
  chatLoading: { type: Boolean, default: false },
  historyLoading: { type: Boolean, default: false },
  hasMoreHistory: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:message',
  'send',
  'confirm',
  'cancel',
  'load-more-history',
  'clear-history',
])

const chatListRef = useTemplateRef('chatListRef')
const pendingPrepend = ref(false)
const previousScrollHeight = ref(0)
const previousScrollTop = ref(0)

const taskStatusLabels = {
  running: '执行中',
  waiting: '等待确认',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
}

function taskTitle(item) {
  if (item.status === 'done') return '智能体任务执行完成'
  if (item.status === 'error') return '智能体任务执行失败'
  if (item.status === 'waiting') return '等待用户确认'
  if (item.status === 'cancelled') return '智能体任务已取消'
  return item.title || '正在处理仿真任务'
}

function taskMainIcon(status) {
  if (status === 'done') return '✓'
  if (status === 'error') return 'x'
  if (status === 'waiting') return '⏸'
  if (status === 'cancelled') return '-'
  return ''
}

function roleLabel(role) {
  if (role === 'user') return '用户'
  if (role === 'confirm') return '操作确认'
  return 'Traffic Agent'
}

function taskStatusLabel(status) {
  return taskStatusLabels[status] || '执行中'
}

function stepIcon(status) {
  if (status === 'error') return '×'
  if (status === 'waiting') return '⏸'
  if (status === 'running') return '…'
  return '✓'
}

function handleScroll() {
  const el = chatListRef.value
  if (!el || !props.hasMoreHistory || props.historyLoading) return

  if (el.scrollTop <= 40) {
    previousScrollHeight.value = el.scrollHeight
    previousScrollTop.value = el.scrollTop
    pendingPrepend.value = true
    emit('load-more-history')
  }
}

function scrollToBottom() {
  const el = chatListRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.historyLoading,
  async (loading, previousLoading) => {
    if (previousLoading && !loading && pendingPrepend.value) {
      await nextTick()
      const el = chatListRef.value
      if (el) {
        el.scrollTop = el.scrollHeight - previousScrollHeight.value + previousScrollTop.value
      }
      pendingPrepend.value = false
    }
  },
)

watch(
  () => props.chatList.length,
  async () => {
    if (pendingPrepend.value) return
    await nextTick()
    scrollToBottom()
  },
  { flush: 'post' },
)

watch(
  () => props.chatList.map((item) => item.steps?.length || 0).join(','),
  async () => {
    if (pendingPrepend.value) return
    await nextTick()
    scrollToBottom()
  },
  { flush: 'post' },
)
</script>

<template>
  <aside class="chat-panel panel-card">
    <div class="panel-title-row">
      <div>
        <h2>智能体对话</h2>
        <p>用自然语言创建、查询、删除仿真。</p>
      </div>
      <button class="ghost-button small" :disabled="props.chatLoading || props.historyLoading" @click="emit('clear-history')">
        清空历史
      </button>
    </div>

    <div ref="chatListRef" class="chat-list" @scroll="handleScroll">
      <div v-if="props.hasMoreHistory" class="history-tip">
        {{ props.historyLoading ? '正在加载更早历史...' : '上滑加载更早历史' }}
      </div>
      <div v-else class="history-tip muted">已显示最近历史</div>

      <div v-for="(item, index) in props.chatList" :key="`${item.role}-${index}`" class="chat-item" :class="item.role">
        <div class="chat-role">{{ roleLabel(item.role) }}</div>
        <div class="chat-bubble">
          <div v-if="item.type === 'task'" class="agent-task-card" :class="item.status">
            <div class="agent-task-head">
              <span class="agent-task-title-wrap">
                <span
                  v-if="item.status === 'running'"
                  class="agent-task-spinner"
                  aria-label="执行中">
                </span>
                <span
                  v-else
                  class="agent-task-main-icon"
                  :class="item.status"
                >
                  {{ taskMainIcon(item.status) }}
                </span>
                <span class="agent-task-title">{{ taskTitle(item) }}</span>
              </span>

              <span class="agent-task-status">{{ taskStatusLabel(item.status) }}</span>
              
            </div>

            <ol class="agent-task-steps">
              <li v-for="(step, stepIndex) in item.steps" :key="stepIndex" class="agent-task-step" :class="step.status">
                <span class="agent-task-icon">{{ stepIcon(step.status) }}</span>
                <span>{{ step.text }}</span>
              </li>
            </ol>

            <ConfirmationCard
                v-if="item.confirmation"
                :confirmation="item.confirmation"
                :loading="props.chatLoading"
                @confirm="emit('confirm', item.threadId)"
                @cancel="emit('cancel', item.threadId)"
              />
          </div>

          <template v-else>
            <p>{{ item.content }}</p>
          </template>
        </div>
      </div>
    </div>

    <div class="message-box">
      <textarea
        :value="props.message"
        :disabled="props.chatLoading"
        placeholder="例如：创建一个 zhuzhou 区域的 3600 秒仿真"
        @input="emit('update:message', $event.target.value)"
      />
      <button class="primary-button send-button" :disabled="props.chatLoading" @click="emit('send')">
        {{ props.chatLoading ? '处理中' : '发送' }}
      </button>
    </div>
  </aside>
</template>

<style>
.agent-task-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.agent-task-spinner {
  display: inline-block;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(59, 130, 246, 0.25);
  border-top-color: #3b82f6;
  border-radius: 999px;
  animation: agent-task-spin 0.8s linear infinite;
}

@keyframes agent-task-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
