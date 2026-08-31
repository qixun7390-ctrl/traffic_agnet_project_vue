<script setup>
const props = defineProps({
  username: { type: String, required: true },
  backendStatus: { type: String, required: true },
})

const emit = defineEmits(['logout'])
</script>

<template>
  <main class="dashboard-page">
    <section class="dashboard-top">
      <div>
        <p class="eyebrow">Simulation Workspace</p>
        <h1>仿真任务工作台</h1>
      </div>
      <div class="top-actions">
        <span class="status-pill" :class="{ offline: props.backendStatus !== '后端在线' }">
          {{ props.backendStatus }}
        </span>
        <span class="user-pill">{{ props.username }}</span>
        <button class="ghost-button" @click="emit('logout')">退出</button>
      </div>
    </section>

    <section class="workspace-grid">
      <slot name="chat"></slot>
      <section class="right-column">
        <slot name="upload"></slot>
        <slot name="simulations"></slot>
      </section>
    </section>
  </main>
</template>
