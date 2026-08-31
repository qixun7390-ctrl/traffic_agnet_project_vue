import { computed, ref } from 'vue'
import { loginApi, registerApi } from '../api/auth'
import { setAuthToken } from '../api/http'

const TOKEN_KEY = 'traffic_agent_token'
const USERNAME_KEY = 'traffic_agent_username'

export function useAuth() {
  const username = ref(localStorage.getItem(USERNAME_KEY) || '')
  const password = ref('')
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')

  const registerEmail = ref('')
  const registerUsername = ref('')
  const registerPassword = ref('')

  const loginMode = ref('login')
  const authLoading = ref(false)
  const authError = ref('')

  const isLoggedIn = computed(() => Boolean(token.value))

  setAuthToken(token.value)

  async function login() {
    authError.value = ''

    if (!username.value || !password.value) {
      authError.value = '请输入账号和密码'
      return false
    }

    authLoading.value = true

    try {
      const data = await loginApi(username.value, password.value)

      token.value = data.access_token
      localStorage.setItem(TOKEN_KEY, token.value)
      localStorage.setItem(USERNAME_KEY, username.value)
      setAuthToken(token.value)
      password.value = ''

      return true
    } catch (error) {
      authError.value = error.response?.data?.detail || '登录失败，请检查账号和密码'
      return false
    } finally {
      authLoading.value = false
    }
  }

  async function register() {
    authError.value = ''

    if (!registerUsername.value || !registerEmail.value || !registerPassword.value) {
      authError.value = '请填写用户名、邮箱和密码'
      return false
    }

    authLoading.value = true

    try {
      await registerApi({
        username: registerUsername.value,
        email: registerEmail.value,
        password: registerPassword.value,
      })

      username.value = registerUsername.value
      password.value = registerPassword.value
      loginMode.value = 'login'
      authError.value = '注册成功，请点击进入工作台'

      return true
    } catch (error) {
      authError.value = error.response?.data?.detail || '注册失败'
      return false
    } finally {
      authLoading.value = false
    }
  }

  function logout() {
    token.value = ''
    password.value = ''
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USERNAME_KEY)
    setAuthToken('')
  }

  return {
    username,
    password,
    token,
    registerEmail,
    registerUsername,
    registerPassword,
    loginMode,
    authLoading,
    authError,
    isLoggedIn,
    login,
    register,
    logout,
  }
}
