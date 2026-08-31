<script setup>
const props = defineProps({
  username: { type: String, required: true },
  password: { type: String, required: true },
  authLoading: { type: Boolean, default: false },
  authError: { type: String, default: '' },
})

const emit = defineEmits([
  'update:username',
  'update:password',
  'login',
])
</script>

<template>
  <main class="login-page">
    <section class="login-hero">
      <p class="eyebrow">Traffic Simulation Agent</p>
      <h1>交通仿真智能体</h1>
      <div class="hero-line"></div>
    </section>

    <section class="login-card">
      <div class="login-header">
        <h2>账号登录</h2>
        <p>当前系统暂不开放自助注册，请使用已分配账号登录。</p>
      </div>

      <p v-if="props.authError" class="auth-message">{{ props.authError }}</p>

      <div class="form-stack">
        <label>
          <span>账号 / 邮箱</span>
          <input
            :value="props.username"
            placeholder="请输入账号或邮箱"
            @input="emit('update:username', $event.target.value)"
          />
        </label>
        <label>
          <span>密码</span>
          <input
            :value="props.password"
            type="password"
            placeholder="请输入密码"
            @input="emit('update:password', $event.target.value)"
            @keyup.enter="emit('login')"
          />
        </label>
        <button class="primary-button" :disabled="props.authLoading" @click="emit('login')">
          {{ props.authLoading ? '登录中...' : '进入工作台' }}
        </button>
      </div>
    </section>
  </main>
</template>
