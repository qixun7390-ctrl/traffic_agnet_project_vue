import { expect, test } from '@playwright/test'

const FILE_FIELDS = ['map_file', 'signal_file', 'stop_file', 'order_file', 'bus_file']
const UPLOAD_OK_MESSAGE = '文件上传并校验成功，本次登录可用于创建仿真'
const MISSING_FILES_MESSAGE = '创建仿真前必须上传所有完整的文件'
const PARAM_ERROR_MESSAGE = '创建参数不合法，请检查仿真时长等参数'
const PLATFORM_ERROR_MESSAGE = 'http异常，请一会儿重试'
const INTENT_ERROR_MESSAGE = '这样的问法有问题，请明确是创建、查询还是删除仿真'
const CHAT_MESSAGE = '我目前可以帮你处理交通仿真的创建、查询和删除。如果你要继续操作，请明确说明要创建、查询还是删除哪一个仿真。'
const QUERY_MISSING_ID_MESSAGE = '缺少有效的simulation_id'
const QUERY_TOOL_ERROR_MESSAGE = '调用查询工具失败，请稍后重试'
const DELETE_PARAM_ERROR_MESSAGE = '参数错误，simulation_id必须是大于0的整数'
const DELETE_PLATFORM_ERROR_MESSAGE = '仿真平台不可用，删除失败，本地文件和记录不会误删'

function jsonFile(name, payload) {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf-8'),
  }
}

function createFiles(area = 'linkong') {
  return {
    map_file: jsonFile(`${area}-map.json`, [{ id: 1, area }]),
    signal_file: jsonFile(`${area}-signal.json`, { signals: [{ id: 1, area }] }),
    stop_file: jsonFile(`${area}-stop.json`, [{ id: 1, area }]),
    order_file: jsonFile(`${area}-order.json`, [{ id: 1, area }]),
    bus_file: jsonFile(`${area}-bus.json`, [{ id: 1, area }]),
  }
}

function createIncompleteFiles(area = 'anningqu') {
  const files = createFiles(area)
  delete files.bus_file
  return files
}

function createAllStopFiles() {
  return Object.fromEntries(
    FILE_FIELDS.map((field) => [field, jsonFile('stop.json', [{ stop_id: 1 }])]),
  )
}

async function addLoginStorage(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('traffic_agent_token', 'e2e-token')
    window.localStorage.setItem('traffic_agent_username', 'admin')
  })
}

function simulationRecord(simulationId, status = 'COMPLETED') {
  return {
    simulation_id: simulationId,
    status,
    created_at: '2026-08-27T10:00:00',
    files: Object.fromEntries(FILE_FIELDS.map((field) => [field, `${simulationId}-${field}.json`])),
  }
}

async function mockBaseApis(page, simulations = []) {
  await page.route('**/api/v1/simulations/my', async (route) => {
    await route.fulfill({ json: { data: simulations } })
  })

  await page.route('**/api/v1/agent/messages**', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: { message: 'cleared' } })
      return
    }
    await route.fulfill({ json: [] })
  })
}

async function mockUploadSuccess(page) {
  let uploadIndex = 0

  await page.route('**/api/v1/agent/upload-files', async (route) => {
    uploadIndex += 1
    await route.fulfill({
      json: {
        message: '文件上传并校验成功',
        validation_status: 'PASSED',
        batch_id: `batch-${uploadIndex}`,
        files: Object.fromEntries(FILE_FIELDS.map((field) => [field, `${field}.json`])),
        attachments: Object.fromEntries(FILE_FIELDS.map((field) => [field, `D:/tmp/${field}.json`])),
      },
    })
  })
}

async function mockUploadFailure(page, errorMessage) {
  await page.route('**/api/v1/agent/upload-files', async (route) => {
    await route.fulfill({
      status: 422,
      json: { detail: errorMessage },
    })
  })
}

async function fulfillSse(route, events) {
  const body = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')

  await route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
    body,
  })
}

async function fulfillDelayedSse(route, events, delayMs = 450) {
  let body = ''

  for (const { event, data } of events) {
    body += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    body += `: wait ${delayMs}\n\n`
  }

  await route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
    body,
  })
}

function confirmationEvent(payload) {
  return {
    event: 'confirmation_required',
    data: {
      status: 'awaiting_confirmation',
      thread_id: payload.thread_id || 'thread-e2e',
      operation: 'create',
      stage: 'create_confirmation',
      message: '创建仿真需要用户确认后再执行',
      data: {
        interrupt: {
          pending_action: {
            operation: 'create',
            arguments: {
              name: 'linkong',
              running_time_step: 3600,
              description: '',
              use_random_match: true,
              use_cost: true,
              attachments: Object.fromEntries(FILE_FIELDS.map((field) => [field, `D:/tmp/${field}.json`])),
            },
          },
        },
      },
    },
  }
}

function deleteConfirmationEvent(payload, simulationId) {
  return {
    event: 'confirmation_required',
    data: {
      status: 'awaiting_confirmation',
      thread_id: payload.thread_id || 'thread-delete-e2e',
      operation: 'delete',
      stage: 'delete_confirmation',
      message: '删除仿真需要用户确认后再执行',
      data: {
        interrupt: {
          pending_action: {
            operation: 'delete',
            arguments: {
              simulation_id: simulationId,
            },
          },
        },
      },
    },
  }
}

async function mockAgentStream(page, resolver) {
  const requests = []

  await page.route('**/api/v1/agent/run/stream', async (route) => {
    const payload = route.request().postDataJSON()
    requests.push(payload)
    const result = resolver(payload)

    if (result?.httpStatus) {
      await route.fulfill({
        status: result.httpStatus,
        json: result.json || { detail: result.message || '请求失败' },
      })
      return
    }

    await fulfillSse(route, result.events)
  })

  return requests
}

function queryOrderSummaryEvents(payload, simulationId = 36) {
  return [
    {
      event: 'status',
      data: {
        status: 'running',
        thread_id: payload.thread_id || 'thread-query-e2e',
        stage: 'intent',
        operation: 'query',
        message: '经过Traffic Agent识别用户的意图为:查询仿真',
      },
    },
    {
      event: 'status',
      data: {
        status: 'running',
        thread_id: payload.thread_id || 'thread-query-e2e',
        stage: 'extract_query_params',
        operation: 'query',
        message: `已提取查询参数：simulation_id=${simulationId}，指标=order_summary`,
      },
    },
    {
      event: 'status',
      data: {
        status: 'running',
        thread_id: payload.thread_id || 'thread-query-e2e',
        stage: 'query_agent',
        operation: 'query',
        message: '智能体准备调用查询工具：get_simulation_order_summary',
      },
    },
    {
      event: 'done',
      data: {
        status: 'completed',
        thread_id: payload.thread_id || 'thread-query-e2e',
        stage: 'query_agent',
        operation: 'query',
        message: `simulation_id=${simulationId} 订单创建数：100，完成数：80，完成率：80%`,
        data: {
          operation: 'query',
          simulation_id: simulationId,
          metric: 'order_summary',
        },
      },
    },
  ]
}

function errorEvents(payload, stage, message, threadId = 'thread-error-e2e') {
  return [
    {
      event: 'error',
      data: {
        status: 'failed',
        thread_id: payload.thread_id || threadId,
        stage,
        operation: stage.includes('delete') ? 'delete' : stage.includes('query') ? 'query' : 'create',
        message,
      },
    },
  ]
}

async function mockCreateStream(page, options = {}) {
  const requests = []

  await page.route('**/api/v1/agent/run/stream', async (route) => {
    const payload = route.request().postDataJSON()
    requests.push(payload)
    const createIntentEvent = {
      event: 'status',
      data: {
        status: 'running',
        thread_id: payload.thread_id || 'thread-e2e',
        stage: 'intent',
        operation: 'create',
        message: '经过Traffic Agent识别用户的意图为:创建仿真',
      },
    }

    // 后端真实链路是先识别意图，再提取创建参数，所以歧义意图要放在缺少 batch 判断前面。
    if (options.intentError) {
      await fulfillSse(route, [
        {
          event: 'error',
          data: {
            status: 'failed',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'intent',
            operation: 'chat',
            message: INTENT_ERROR_MESSAGE,
          },
        },
      ])
      return
    }

    if (options.chat) {
      await fulfillSse(route, [
        {
          event: 'status',
          data: {
            status: 'running',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'intent',
            operation: 'chat',
            message: '经过Traffic Agent识别用户的意图为:普通对话',
          },
        },
        {
          event: 'done',
          data: {
            status: 'completed',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'chat',
            operation: 'chat',
            message: CHAT_MESSAGE,
            data: {
              operation: 'chat',
              message: CHAT_MESSAGE,
            },
          },
        },
      ])
      return
    }

    if (options.platformDown) {
      await route.fulfill({
        status: 500,
        json: { detail: PLATFORM_ERROR_MESSAGE },
      })
      return
    }

    if (payload.message.includes('-1000')) {
      await fulfillSse(route, [
        createIntentEvent,
        {
          event: 'error',
          data: {
            status: 'failed',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'extract_create_params',
            operation: 'create',
            message: PARAM_ERROR_MESSAGE,
          },
        },
      ])
      return
    }

    if (!payload.upload_batch_id) {
      await fulfillSse(route, [
        createIntentEvent,
        {
          event: 'error',
          data: {
            status: 'failed',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'extract_create_params',
            operation: 'create',
            message: MISSING_FILES_MESSAGE,
          },
        },
      ])
      return
    }

    await fulfillSse(route, [createIntentEvent, confirmationEvent(payload)])
  })

  return requests
}

async function mockResume(page, mode = 'cancelled') {
  const requests = []

  await page.route('**/api/v1/agent/resume/stream', async (route) => {
    const payload = route.request().postDataJSON()
    requests.push(payload)

    if (mode === 'completed') {
      await fulfillSse(route, [
        {
          event: 'done',
          data: {
            status: 'completed',
            thread_id: payload.thread_id || 'thread-e2e',
            stage: 'create_execute',
            operation: 'create',
            message: '仿真创建成功',
            data: { simulation_id: 1001 },
          },
        },
      ])
      return
    }

    if (mode === 'delete-platform-down') {
      await fulfillSse(route, [
        {
          event: 'error',
          data: {
            status: 'failed',
            thread_id: payload.thread_id || 'thread-delete-e2e',
            stage: 'delete_execute',
            operation: 'delete',
            message: DELETE_PLATFORM_ERROR_MESSAGE,
          },
        },
      ])
      return
    }

    await fulfillSse(route, [
      {
        event: 'done',
        data: {
          status: 'cancelled',
          thread_id: payload.thread_id || 'thread-e2e',
          stage: 'create_confirmation',
          operation: 'create',
          message: '用户已取消创建仿真',
        },
      },
    ])
  })

  return requests
}

async function openWorkspace(page, options = {}) {
  await addLoginStorage(page)
  await mockBaseApis(page, options.simulations || [])
  await page.goto('/')
  await expect(page.getByText('智能体对话')).toBeVisible()
}

async function selectFiles(page, filesByField) {
  for (const [index, field] of FILE_FIELDS.entries()) {
    if (!filesByField[field]) continue
    await page.locator('input[type="file"]').nth(index).setInputFiles(filesByField[field])
  }
}

async function uploadAndValidate(page, area = 'linkong') {
  await selectFiles(page, createFiles(area))
  await expect(page.getByText('5/5')).toBeVisible()
  await page.getByRole('button', { name: '上传并校验' }).click()
  await expect(page.getByText(UPLOAD_OK_MESSAGE)).toBeVisible()
}

async function sendMessage(page, message) {
  await page.getByPlaceholder('例如：创建一个 zhuzhou 区域的 3600 秒仿真').fill(message)
  await page.getByRole('button', { name: '发送' }).click()
}

async function createAndConfirm(page, area = 'linkong') {
  await uploadAndValidate(page, area)
  await sendMessage(page, `创建一个${area}区域的3600秒的仿真`)
  await expect(page.getByRole('button', { name: '确认执行' })).toBeVisible()
  await page.getByRole('button', { name: '确认执行' }).click()
  await expect(page.getByText('仿真创建成功')).toBeVisible()
}

async function createAndCancel(page, area = 'anningqu') {
  await uploadAndValidate(page, area)
  await sendMessage(page, `创建一个${area}区域的3600秒的仿真`)
  await expect(page.getByRole('button', { name: '取消' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByText(/用户已取消操作|用户已取消创建仿真/)).toBeVisible()
}

test('test001 上传完整的json文件但是不点击校验，不能创建仿真', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)

  await selectFiles(page, createFiles('linkong'))
  await expect(page.getByText('5/5')).toBeVisible()
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
  expect(streamRequests[0].upload_batch_id).toBeUndefined()
})

test('test002 用户请求参数不合理，秒数为负数时不能创建仿真', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  await mockCreateStream(page)

  await uploadAndValidate(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的-1000秒的仿真')

  await expect(page.getByText(PARAM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
})

test('test003 第一次创建成功后再次空跑，应提示必须重新上传完整文件', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)
  await mockResume(page, 'completed')

  await createAndConfirm(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  expect(streamRequests[1].upload_batch_id).toBeUndefined()
})

test('test004 第二批shaoxing完整文件未点击校验时，不能被用于创建仿真', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)
  await mockResume(page, 'completed')

  await createAndConfirm(page, 'linkong')
  await selectFiles(page, createFiles('shaoxing'))
  await expect(page.getByText('5/5')).toBeVisible()
  await sendMessage(page, '创建一个shaoxing区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  expect(streamRequests[1].upload_batch_id).toBeUndefined()
})

test('test005 覆盖完整anningqu文件但未点击校验时，不能直接创建仿真', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)

  await uploadAndValidate(page, 'linkong')
  await selectFiles(page, createFiles('anningqu'))
  await expect(page.getByText('5/5')).toBeVisible()
  await sendMessage(page, '创建一个anningqu区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
  expect(streamRequests[0].upload_batch_id).toBeUndefined()
})

test('test006 覆盖不完整anningqu文件且未点击校验时，不能复用linkong旧批次', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)

  await uploadAndValidate(page, 'linkong')
  await selectFiles(page, createIncompleteFiles('anningqu'))
  await expect(page.getByText('4/5')).toBeVisible()
  await sendMessage(page, '创建一个anningqu区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
  expect(streamRequests[0].upload_batch_id).toBeUndefined()
})

test('test007 文件位置传错，全传入stop.json时前端显示校验失败', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadFailure(page, 'map_file 内容结构不正确，请检查是否误传 stop.json')

  await selectFiles(page, createAllStopFiles())
  await page.getByRole('button', { name: '上传并校验' }).click()

  await expect(page.getByText('map_file 内容结构不正确，请检查是否误传 stop.json')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('test008 取消创建后重新上传完整文件但未点击校验，应提示必须上传完整文件', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)
  await mockResume(page, 'cancelled')

  await createAndCancel(page, 'anningqu')
  await selectFiles(page, createFiles('linkong'))
  await expect(page.getByText('5/5')).toBeVisible()
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  expect(streamRequests[1].upload_batch_id).toBeUndefined()
})

test('test010 取消创建后不重新上传，第二次创建应失败', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)
  await mockResume(page, 'cancelled')

  await createAndCancel(page, 'anningqu')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText(MISSING_FILES_MESSAGE)).toBeVisible()
  expect(streamRequests[1].upload_batch_id).toBeUndefined()
})

test('test011 未确认旧任务时重新发起请求，应自动取消旧请求并等待新确认', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  const streamRequests = await mockCreateStream(page)
  const resumeRequests = await mockResume(page, 'cancelled')

  await uploadAndValidate(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')
  await expect(page.getByRole('button', { name: '确认执行' })).toBeVisible()

  await uploadAndValidate(page, 'shaoxing')
  await sendMessage(page, '创建一个shaoxing区域的3600秒的仿真')

  await expect(page.getByText('请求已被新的用户请求取消')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(resumeRequests[0]).toEqual({
    thread_id: 'thread-e2e',
    approved: false,
  })
  expect(streamRequests[1].message).toContain('shaoxing')
})

test('test012 仿真平台关闭时，应显示http异常并恢复发送按钮', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  await mockCreateStream(page, { platformDown: true })

  await uploadAndValidate(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText(PLATFORM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('test013 用户输入“创建删除一个仿真”时，应识别为普通chat且不进入任务卡', async ({ page }) => {
  await openWorkspace(page)
  await mockCreateStream(page, { chat: true })

  await sendMessage(page, '创建删除一个仿真')

  await expect(page.getByText(CHAT_MESSAGE)).toBeVisible()
  await expect(page.getByText('正在处理仿真任务')).not.toBeVisible()
  await expect(page.getByText('智能体任务执行完成')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('stream_ui 识别为创建仿真后应立即显示任务卡，并按SSE步骤逐条追加', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  await page.route('**/api/v1/agent/run/stream', async (route) => {
    const payload = route.request().postDataJSON()
    await fulfillDelayedSse(route, [
      {
        event: 'status',
        data: {
          status: 'started',
          thread_id: payload.thread_id || 'thread-stream-e2e',
          message: '智能体开始处理请求',
        },
      },
      {
        event: 'status',
        data: {
          status: 'running',
          thread_id: payload.thread_id || 'thread-stream-e2e',
          stage: 'intent',
          operation: 'create',
          message: '经过Traffic Agent识别用户的意图为:创建仿真',
        },
      },
      {
        event: 'status',
        data: {
          status: 'running',
          thread_id: payload.thread_id || 'thread-stream-e2e',
          stage: 'extract_create_params',
          operation: 'create',
          message: '关于用户创建仿真的参数已提取，上传文件也校验通过',
        },
      },
      confirmationEvent(payload),
    ])
  })

  await uploadAndValidate(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByText('正在处理仿真任务')).toBeVisible()
  await expect(page.getByText('经过Traffic Agent识别用户的意图为:创建仿真')).toBeVisible()
  await expect(page.getByText('关于用户创建仿真的参数已提取，上传文件也校验通过')).toBeVisible()
  await expect(page.getByText('等待用户确认')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).toBeVisible()
})

test('stream_ui 发送后等待意图识别期间不显示任务卡，确认业务意图后才显示任务卡', async ({ page }) => {
  await openWorkspace(page)
  await mockUploadSuccess(page)
  await page.route('**/api/v1/agent/run/stream', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    const payload = route.request().postDataJSON()
    await fulfillSse(route, [
      {
        event: 'status',
        data: {
          status: 'started',
          thread_id: payload.thread_id || 'thread-delayed-intent-e2e',
          message: '智能体开始处理请求',
        },
      },
      {
        event: 'status',
        data: {
          status: 'running',
          thread_id: payload.thread_id || 'thread-delayed-intent-e2e',
          stage: 'intent',
          operation: 'create',
          message: '经过Traffic Agent识别用户的意图为:创建仿真',
        },
      },
      confirmationEvent(payload),
    ])
  })

  await uploadAndValidate(page, 'linkong')
  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')

  await expect(page.getByRole('button', { name: '处理中' })).toBeDisabled()
  await expect(page.getByPlaceholder('例如：创建一个 zhuzhou 区域的 3600 秒仿真')).toBeDisabled()
  await expect(page.getByText('正在处理仿真任务')).not.toBeVisible()

  await expect(page.getByText('正在处理仿真任务')).toBeVisible()
  await expect(page.getByText('经过Traffic Agent识别用户的意图为:创建仿真')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).toBeVisible()
})

test('stream_ui 普通chat等待意图识别完成后只显示普通气泡，不显示任务卡', async ({ page }) => {
  await openWorkspace(page)
  await page.route('**/api/v1/agent/run/stream', async (route) => {
    const payload = route.request().postDataJSON()
    await fulfillDelayedSse(route, [
      {
        event: 'status',
        data: {
          status: 'started',
          thread_id: payload.thread_id || 'thread-chat-stream-e2e',
          message: '智能体开始处理请求',
        },
      },
      {
        event: 'status',
        data: {
          status: 'running',
          thread_id: payload.thread_id || 'thread-chat-stream-e2e',
          stage: 'intent',
          operation: 'chat',
          message: '经过Traffic Agent识别用户的意图为:普通对话',
        },
      },
      {
        event: 'done',
        data: {
          status: 'completed',
          thread_id: payload.thread_id || 'thread-chat-stream-e2e',
          stage: 'chat',
          operation: 'chat',
          message: CHAT_MESSAGE,
          data: { operation: 'chat', message: CHAT_MESSAGE },
        },
      },
    ], 250)
  })

  await sendMessage(page, '你好，你可以做什么')

  await expect(page.getByText('正在处理仿真任务')).not.toBeVisible()
  await expect(page.getByText('经过Traffic Agent识别用户的意图为:普通对话')).not.toBeVisible()
  await expect(page.getByText(CHAT_MESSAGE)).toBeVisible()
  await expect(page.getByText('正在处理仿真任务')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
})

test('query002 查询36号仿真订单完成率，应返回订单创建数、完成数和完成率', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: queryOrderSummaryEvents(payload, 36),
  }))

  await sendMessage(page, '查询36号仿真订单完成率')

  await expect(page.getByText('智能体准备调用查询工具：get_simulation_order_summary')).toBeVisible()
  await expect(page.getByText(/订单创建数：100/)).toBeVisible()
  await expect(page.getByText(/完成数：80/)).toBeVisible()
  await expect(page.getByText(/完成率：80%/)).toBeVisible()
})

test('query005 多轮对话查询上一个仿真的完成率，应使用最近成功仿真id', async ({ page }) => {
  await openWorkspace(page)
  const streamRequests = await mockAgentStream(page, (payload) => {
    if (payload.message.includes('上一个仿真')) {
      return { events: queryOrderSummaryEvents(payload, 36) }
    }

    return {
      events: [
        {
          event: 'done',
          data: {
            status: 'completed',
            thread_id: 'thread-create-latest-e2e',
            stage: 'create_execute',
            message: '仿真创建成功',
            data: { simulation_id: 37 },
          },
        },
      ],
    }
  })

  await sendMessage(page, '创建一个linkong区域的3600秒的仿真')
  await expect(page.getByText(/仿真创建成功/)).toBeVisible()
  await sendMessage(page, '上一个仿真的完成率')

  await expect(page.getByText(/simulation_id=36 订单创建数：100/)).toBeVisible()
  await expect(page.getByText(/完成率：80%/)).toBeVisible()
  expect(streamRequests[1].message).toBe('上一个仿真的完成率')
})

test('query_negative002 用户查询语句模糊且没有simulation_id时，应提示缺少有效simulation_id', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_query_params', QUERY_MISSING_ID_MESSAGE),
  }))

  await sendMessage(page, '查询完成率')

  await expect(page.getByText(QUERY_MISSING_ID_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
})

test('query_negative003 查询-1号仿真车辆参与情况，应提示缺少有效simulation_id', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_query_params', QUERY_MISSING_ID_MESSAGE),
  }))

  await sendMessage(page, '查询-1号仿真车辆参与情况')

  await expect(page.getByText(QUERY_MISSING_ID_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
})

test('query_negative006 查询工具失败时，应显示调用工具失败且前端不无限loading', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: [
      {
        event: 'status',
        data: {
          status: 'running',
          thread_id: payload.thread_id || 'thread-query-tool-failed-e2e',
          stage: 'query_agent',
          message: '智能体准备调用查询工具：get_simulation_order_summary',
        },
      },
      ...errorEvents(payload, 'query_agent', QUERY_TOOL_ERROR_MESSAGE, 'thread-query-tool-failed-e2e'),
    ],
  }))

  await sendMessage(page, '查询37号仿真跑了多长时间')

  await expect(page.getByText(QUERY_TOOL_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByText('智能体任务执行失败')).toBeVisible()
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
})

test('query_negative008 按钮删除后立刻发送模糊查询，应提示缺少simulation_id', async ({ page }) => {
  await openWorkspace(page, { simulations: [simulationRecord(88)] })
  await page.route('**/api/v1/simulations/88', async (route) => {
    await route.fulfill({ json: { message: 'deleted' } })
  })
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_query_params', QUERY_MISSING_ID_MESSAGE),
  }))
  page.on('dialog', async (dialog) => {
    await dialog.accept()
  })

  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('仿真 88 已删除。')).toBeVisible()
  await sendMessage(page, '查询完成率')

  await expect(page.getByText(QUERY_MISSING_ID_MESSAGE)).toBeVisible()
})

test('delete006 删除0号仿真，应提示参数错误且不能500', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_delete_params', DELETE_PARAM_ERROR_MESSAGE, 'thread-delete-invalid-e2e'),
  }))

  await sendMessage(page, '删除0号仿真')

  await expect(page.getByText(DELETE_PARAM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByText('智能体任务执行失败')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('delete006 删除-1号仿真，应提示参数错误且不能500', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_delete_params', DELETE_PARAM_ERROR_MESSAGE, 'thread-delete-invalid-e2e'),
  }))

  await sendMessage(page, '删除-1号仿真')

  await expect(page.getByText(DELETE_PARAM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByText('智能体任务执行失败')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('delete006 删除abc号仿真，应提示参数错误且不能500', async ({ page }) => {
  await openWorkspace(page)
  await mockAgentStream(page, (payload) => ({
    events: errorEvents(payload, 'extract_delete_params', DELETE_PARAM_ERROR_MESSAGE, 'thread-delete-invalid-e2e'),
  }))

  await sendMessage(page, '删除abc号仿真')

  await expect(page.getByText(DELETE_PARAM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByText('智能体任务执行失败')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认执行' })).not.toBeVisible()
})

test('delete008 仿真平台不可用时删除失败，前端显示失败且不误删记录', async ({ page }) => {
  await openWorkspace(page, { simulations: [simulationRecord(37)] })
  await mockAgentStream(page, (payload) => ({
    events: [deleteConfirmationEvent(payload, 37)],
  }))
  await mockResume(page, 'delete-platform-down')
  await page.route('**/api/v1/simulations/my', async (route) => {
    await route.fulfill({ json: { data: [simulationRecord(37)] } })
  })

  await sendMessage(page, '删除37号仿真')
  await expect(page.getByRole('button', { name: '确认执行' })).toBeVisible()
  await page.getByRole('button', { name: '确认执行' }).click()

  await expect(page.getByText(DELETE_PLATFORM_ERROR_MESSAGE)).toBeVisible()
  await expect(page.getByRole('cell', { name: '37' })).toBeVisible()
})
