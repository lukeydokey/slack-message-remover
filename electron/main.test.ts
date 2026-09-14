import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: { send: ReturnType<typeof vi.fn> } }, request?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const browserWindow = vi.fn(function MockBrowserWindow(this: {
    webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
  }) {
    this.webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    this.loadFile = vi.fn()
    this.loadURL = vi.fn()
  })

  return {
    handlers,
    appWhenReady: vi.fn(() => Promise.resolve()),
    appOn: vi.fn(),
    appQuit: vi.fn(),
    getPath: vi.fn(() => 'C:\\test-user-data'),
    browserWindow,
    ipcHandle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    decryptString: vi.fn(),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    isEncryptionAvailable: vi.fn(() => true),
    openExternal: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    whenReady: mocks.appWhenReady,
    on: mocks.appOn,
    quit: mocks.appQuit,
    getPath: mocks.getPath
  },
  BrowserWindow: mocks.browserWindow,
  ipcMain: {
    handle: mocks.ipcHandle
  },
  safeStorage: {
    decryptString: mocks.decryptString,
    encryptString: mocks.encryptString,
    isEncryptionAvailable: mocks.isEncryptionAvailable
  },
  shell: {
    openExternal: mocks.openExternal
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  unlink: mocks.unlink,
  writeFile: mocks.writeFile
}))

interface SlackCall {
  method: string
  body: string
}

interface SlackMessageFixture {
  channelId: string
  ts: string
  userId: string
  text: string
  isThreadReply: boolean
  hasFiles: boolean
}

const credential = {
  clientId: '123456789.987654321',
  accessToken: 'xoxp-test-token',
  userId: 'U123ABC',
  userName: 'test-user',
  teamName: 'test-team'
}

const scanRequest = {
  channelIds: ['C123ABC'],
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-02T00:00:00.000Z',
  includeThreadReplies: true
}

const textMessage: SlackMessageFixture = {
  channelId: 'C123ABC',
  ts: '1788220800.000001',
  userId: credential.userId,
  text: 'plain text',
  isThreadReply: false,
  hasFiles: false
}

const fileMessage: SlackMessageFixture = {
  channelId: 'C123ABC',
  ts: '1788220801.000001',
  userId: credential.userId,
  text: '',
  isThreadReply: false,
  hasFiles: true
}

function slackResponse(data: unknown): Response {
  return {
    status: 200,
    headers: { get: vi.fn() },
    json: vi.fn(async () => data)
  } as unknown as Response
}

async function loadMain(responses: Record<string, unknown[]>): Promise<{
  calls: SlackCall[]
  scan: (request?: Record<string, unknown>) => Promise<{ scanId: string; messages: SlackMessageFixture[] }>
  deleteMessages: (request: Record<string, unknown>) => Promise<{ deleted: number; failed: number; failures: Array<{ ts: string; reason: string }> }>
}> {
  const calls: SlackCall[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/').pop() ?? ''
    const body = String(init?.body ?? '')
    calls.push({ method, body })

    if (method === 'chat.delete') return slackResponse({ ok: true })

    const queue = responses[method]
    const next = queue?.shift()
    if (!next) throw new Error(`Unexpected Slack API call: ${method}`)
    return slackResponse(next)
  })
  vi.stubGlobal('fetch', fetchMock)

  await import('./main')
  await Promise.resolve()
  await Promise.resolve()

  const scanHandler = mocks.handlers.get('slack:scan')
  const deleteHandler = mocks.handlers.get('slack:deleteMessages')
  if (!scanHandler || !deleteHandler) throw new Error('Slack IPC handlers were not registered')

  return {
    calls,
    scan: async (request = scanRequest) => scanHandler({ sender: { send: vi.fn() } }, request) as Promise<{ scanId: string; messages: SlackMessageFixture[] }>,
    deleteMessages: async (request) => deleteHandler({ sender: { send: vi.fn() } }, request) as Promise<{ deleted: number; failed: number; failures: Array<{ ts: string; reason: string }> }>
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  mocks.handlers.clear()
  mocks.appWhenReady.mockClear()
  mocks.appOn.mockClear()
  mocks.appQuit.mockClear()
  mocks.getPath.mockClear()
  mocks.browserWindow.mockClear()
  mocks.ipcHandle.mockClear()
  mocks.decryptString.mockReset()
  mocks.encryptString.mockClear()
  mocks.isEncryptionAvailable.mockClear()
  mocks.openExternal.mockClear()
  mocks.readFile.mockReset()
  mocks.unlink.mockReset()
  mocks.writeFile.mockReset()

  mocks.appWhenReady.mockResolvedValue(undefined)
  mocks.getPath.mockReturnValue('C:\\test-user-data')
  mocks.decryptString.mockReturnValue(JSON.stringify(credential))
  mocks.readFile.mockResolvedValue(Buffer.from('encrypted-credential'))
  mocks.unlink.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('slack:scan file exclusion', () => {
  it('excludes file messages from history and replies by default while scanning paginated history', async () => {
    const { calls, scan } = await loadMain({
      'conversations.history': [
        {
          ok: true,
          messages: [
            { ts: textMessage.ts, user: credential.userId, text: textMessage.text },
            { ts: fileMessage.ts, user: credential.userId, files: [{ id: 'F123' }] },
            { ts: '1788220802.000001', user: credential.userId, text: 'thread root', reply_count: 2, thread_ts: '1788220802.000001' }
          ],
          response_metadata: { next_cursor: 'NEXT' }
        },
        {
          ok: true,
          messages: [
            { ts: '1788220805.000001', user: credential.userId, text: 'second page text' },
            { ts: '1788220806.000001', user: credential.userId, subtype: 'file_share' }
          ],
          response_metadata: {}
        }
      ],
      'conversations.replies': [
        {
          ok: true,
          messages: [
            { ts: '1788220802.000001', user: credential.userId, text: 'thread root' },
            { ts: '1788220803.000001', user: credential.userId, text: 'reply text' },
            { ts: '1788220804.000001', user: credential.userId, file: { id: 'F456' } }
          ],
          response_metadata: {}
        }
      ]
    })

    const result = await scan()

    expect(result.messages.map((message) => message.ts)).toEqual([
      textMessage.ts,
      '1788220802.000001',
      '1788220803.000001',
      '1788220805.000001'
    ])
    expect(result.messages.every((message) => message.hasFiles === false)).toBe(true)
    expect(calls.filter((call) => call.method === 'conversations.history')).toHaveLength(2)
    expect(calls.filter((call) => call.method === 'conversations.history').at(-1)?.body).toContain('cursor=NEXT')
    expect(calls.filter((call) => call.method === 'conversations.replies')).toHaveLength(1)
  })

  it('keeps file messages when file exclusion is explicitly disabled', async () => {
    const { scan } = await loadMain({
      'conversations.history': [
        {
          ok: true,
          messages: [
            { ts: textMessage.ts, user: credential.userId, text: textMessage.text },
            { ts: fileMessage.ts, user: credential.userId, files: [{ id: 'F123' }] }
          ],
          response_metadata: {}
        }
      ]
    })

    const result = await scan({ ...scanRequest, includeThreadReplies: false, excludeFileMessages: false })

    expect(result.messages).toEqual([textMessage, fileMessage])
  })

  it('rejects a forged file-message deletion through the scan allowlist while deleting text messages', async () => {
    const { calls, scan, deleteMessages } = await loadMain({
      'conversations.history': [
        {
          ok: true,
          messages: [
            { ts: textMessage.ts, user: credential.userId, text: textMessage.text },
            { ts: fileMessage.ts, user: credential.userId, files: [{ id: 'F123' }] }
          ],
          response_metadata: {}
        }
      ]
    })
    const scanResult = await scan({ ...scanRequest, includeThreadReplies: false })
    const forgedFileMessage = { ...fileMessage, hasFiles: false }

    const result = await deleteMessages({
      scanId: scanResult.scanId,
      messages: [scanResult.messages[0], forgedFileMessage],
      confirmedCount: 2
    })

    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ ts: fileMessage.ts, reason: '미리보기에서 확인하지 않은 메시지는 삭제하지 않습니다.' }])
    expect(calls.filter((call) => call.method === 'chat.delete').map((call) => call.body)).toEqual([
      `channel=${textMessage.channelId}&ts=${textMessage.ts}`
    ])
  })
  it('deletes only the selected subset of a valid preview', async () => {
    const secondTextMessage = { ...textMessage, ts: '1788220802.000001', text: 'second text' }
    const thirdTextMessage = { ...textMessage, ts: '1788220803.000001', text: 'third text' }
    const { calls, scan, deleteMessages } = await loadMain({
      'conversations.history': [
        {
          ok: true,
          messages: [
            { ts: textMessage.ts, user: credential.userId, text: textMessage.text },
            { ts: secondTextMessage.ts, user: credential.userId, text: secondTextMessage.text },
            { ts: thirdTextMessage.ts, user: credential.userId, text: thirdTextMessage.text }
          ],
          response_metadata: {}
        }
      ]
    })
    const scanResult = await scan({ ...scanRequest, includeThreadReplies: false })

    const result = await deleteMessages({
      scanId: scanResult.scanId,
      messages: [scanResult.messages[0], scanResult.messages[2]],
      confirmedCount: 2
    })

    expect(result).toMatchObject({ deleted: 2, failed: 0 })
    expect(calls.filter((call) => call.method === 'chat.delete').map((call) => call.body)).toEqual([
      `channel=${textMessage.channelId}&ts=${textMessage.ts}`,
      `channel=${thirdTextMessage.channelId}&ts=${thirdTextMessage.ts}`
    ])
  })
})
