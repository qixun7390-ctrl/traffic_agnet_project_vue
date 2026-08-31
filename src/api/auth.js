import { http } from './http'

export async function loginApi(username, password) {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  const response = await http.post('/api/v1/auth/login', params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  return response.data
}

export async function registerApi(payload) {
  const response = await http.post('/api/v1/auth/register', payload)
  return response.data
}
