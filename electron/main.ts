import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { messageKey, validateClientId, validateDeleteRequest, validateScanRequest } from '../src/domain/ipcValidation'
import type { ConnectionStatus, ConversationDiagnostic, ConversationListResult, DeleteProgress, DeleteResult, ScanResult, SlackConversation, SlackMessage } from '../src/types'

const callbackPort = 52765
const callbackUrl = `http://127.0.0.1:${callbackPort}/oauth/callback`
const scopes = [
  'chat:write',
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'users:read'
]
const scanSessionTtlMs = 60 * 60 * 1000
const credentialPath = () => join(app.getPath('userData'), 'slack-credential.bin')
const scanSessions = new Map<string, { createdAt: number; messageKeys: Set<string> }>()
let deleteInProgress = false
let cancelCurrentDelete = false
let cancelPendingConnect: (() => void) | undefined

interface Credential {
  clientId: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId: string
  userName: string
  teamName: string
}

interface SlackApiEnvelope {
  ok: boolean
  error?: string
}

interface OAuthAccessResponse extends SlackApiEnvelope {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  team?: { name?: string }
  authed_user?: {
    id?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function createVerifier(): string {
  return base64Url(randomBytes(48))
}

function createChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function genericSlackError(error?: string): Error {
  if (error === 'invalid_auth' || error === 'token_expired' || error === 'account_inactive') {
    return new Error('Slack 연결이 만료되었습니다. 다시 연결해 주세요.')
  }
  if (error === 'ratelimited') return new Error('Slack 요청 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.')
  if (error === 'not_in_channel' || error === 'channel_not_found') return new Error('이 대화를 읽거나 삭제할 권한이 없습니다.')
  if (error === 'cant_delete_message' || error === 'message_not_found') return new Error('Slack에서 이 메시지 삭제를 거부했거나 메시지를 찾을 수 없습니다.')
  return new Error('Slack 요청을 완료하지 못했습니다.')
}

function extractUserToken(data: OAuthAccessResponse): { accessToken: string; refreshToken?: string; expiresAt?: number; userId?: string } {
  const accessToken = data.authed_user?.access_token ?? data.access_token
  if (!accessToken) throw new Error('Slack 사용자 토큰을 받지 못했습니다.')

  const expiresIn = data.authed_user?.expires_in ?? data.expires_in
  return {
    accessToken,
    refreshToken: data.authed_user?.refresh_token ?? data.refresh_token,
    expiresAt: typeof expiresIn === 'number' ? Date.now() + expiresIn * 1000 : undefined,
    userId: data.authed_user?.id
  }
}

async function readCredentialFile(): Promise<Credential | undefined> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    const encrypted = await readFile(credentialPath())
    const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<Credential>
    if (!parsed.clientId || !parsed.accessToken || !parsed.userId || !parsed.userName || !parsed.teamName) return undefined
    return parsed as Credential
  } catch {
    return undefined
  }
}

async function saveCredential(credential: Credential): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.')
  await writeFile(credentialPath(), safeStorage.encryptString(JSON.stringify(credential)))
}

async function removeCredential(): Promise<void> {
  try {
    await unlink(credentialPath())
  } catch {
    // Missing credentials are already disconnected.
  }
}

async function slackForm<T extends SlackApiEnvelope>(method: string, payload: Record<string, string>, retryAttempt = 0): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload)
  })

  if (response.status === 429 && retryAttempt < 3) {
    const retryAfterSeconds = Number(response.headers.get('retry-after') ?? 1)
    await new Promise((resolve) => setTimeout(resolve, Math.min(60, Math.max(1, retryAfterSeconds)) * 1000))
    return slackForm<T>(method, payload, retryAttempt + 1)
  }

  const data = await response.json() as T
  if (!data.ok) throw genericSlackError(data.error)
  return data
}

async function refreshCredential(credential: Credential): Promise<Credential> {
  if (!credential.refreshToken || !credential.expiresAt || credential.expiresAt - Date.now() > 5 * 60 * 1000) return credential

  const refreshed = extractUserToken(await slackForm<OAuthAccessResponse>('oauth.v2.access', {
    client_id: credential.clientId,
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken
  }))
  const nextCredential = {
    ...credential,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? credential.refreshToken,
    expiresAt: refreshed.expiresAt
  }
  await saveCredential(nextCredential)
  return nextCredential
}

async function requireCredential(): Promise<Credential> {
  const credential = await readCredentialFile()
  if (!credential) throw new Error('먼저 Slack 계정을 연결해 주세요.')
  return refreshCredential(credential)
}

async function status(): Promise<ConnectionStatus> {
  const credential = await readCredentialFile()
  return credential
    ? { connected: true, clientId: credential.clientId, userId: credential.userId, userName: credential.userName, teamName: credential.teamName }
    : { connected: false }
}

async function slack<T extends SlackApiEnvelope>(method: string, token: string, payload?: Record<string, unknown>, retryAttempt = 0): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {})
    },
    body: payload ? JSON.stringify(payload) : undefined
  })

  if (response.status === 429 && retryAttempt < 3) {
    const retryAfterSeconds = Number(response.headers.get('retry-after') ?? 1)
    await new Promise((resolve) => setTimeout(resolve, Math.min(60, Math.max(1, retryAfterSeconds)) * 1000))
    return slack<T>(method, token, payload, retryAttempt + 1)
  }

  const data = await response.json() as T
  if (!data.ok) throw genericSlackError(data.error)
  return data
}

async function fetchReplyMessages(token: string, channelId: string, rootTs: string): Promise<SlackMessage[]> {
  const replies: SlackMessage[] = []
  let cursor: string | undefined

  do {
    const data = await slack<SlackApiEnvelope & {
      messages: Array<{ ts: string; user?: string; text?: string }>
      response_metadata?: { next_cursor?: string }
    }>('conversations.replies', token, { channel: channelId, ts: rootTs, limit: 1000, ...(cursor ? { cursor } : {}) })

    replies.push(...data.messages
      .filter((reply) => reply.ts !== rootTs)
      .map((reply) => ({
        channelId,
        ts: reply.ts,
        userId: reply.user ?? '',
        text: reply.text ?? '',
        isThreadReply: true
      })))
    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)

  return replies
}

async function fetchConversationMessages(token: string, channelId: string, request: ReturnType<typeof validateScanRequest>): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = []
  let cursor: string | undefined

  do {
    const data = await slack<SlackApiEnvelope & {
      messages: Array<{ ts: string; user?: string; text?: string; thread_ts?: string; reply_count?: number }>
      response_metadata?: { next_cursor?: string }
    }>('conversations.history', token, {
      channel: channelId,
      oldest: String(Date.parse(request.start) / 1000),
      latest: String(Date.parse(request.end) / 1000),
      inclusive: true,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    })

    messages.push(...data.messages.map((message) => ({
      channelId,
      ts: message.ts,
      userId: message.user ?? '',
      text: message.text ?? '',
      isThreadReply: false
    })))

    if (request.includeThreadReplies) {
      const roots = data.messages.filter((message) => (message.reply_count ?? 0) > 0 || message.thread_ts === message.ts)
      for (const root of roots) messages.push(...await fetchReplyMessages(token, channelId, root.ts))
    }

    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)

  return messages
}

async function connect(clientIdValue: unknown): Promise<ConnectionStatus> {
  cancelPendingConnect?.()
  const clientId = validateClientId(clientIdValue)
  const verifier = createVerifier()
  const state = base64Url(randomBytes(24))
  const authorization = new URL('https://slack.com/oauth/v2/authorize')
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: '',
    user_scope: scopes.join(','),
    state,
    code_challenge: createChallenge(verifier),
    code_challenge_method: 'S256'
  }).toString()

  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (callback: () => void): void => {
      if (finished) return
      finished = true
      cancelPendingConnect = undefined
      server.close()
      callback()
    }
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', callbackUrl)
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (!code || returnedState !== state) {
        response.end('<h2>Slack 연결 실패</h2><p>이 창을 닫고 앱에서 다시 시도해 주세요.</p>')
        finish(() => reject(new Error('Slack 로그인 확인에 실패했습니다.')))
        return
      }

      try {
        const token = extractUserToken(await slackForm<OAuthAccessResponse>('oauth.v2.access', {
          client_id: clientId,
          code,
          redirect_uri: callbackUrl,
          code_verifier: verifier
        }))
        const identity = await slack<SlackApiEnvelope & { user_id: string; user: string; team?: string }>('auth.test', token.accessToken)
        await saveCredential({
          clientId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          userId: identity.user_id,
          userName: identity.user,
          teamName: identity.team ?? 'Slack workspace'
        })

        response.end('<h2>Slack 연결 완료</h2><p>이 창을 닫고 앱으로 돌아가세요.</p>')
        finish(() => { void status().then(resolve) })
      } catch {
        response.end('<h2>Slack 연결 실패</h2><p>이 창을 닫고 앱에서 다시 시도해 주세요.</p>')
        finish(() => reject(new Error('Slack 인증 정보를 저장하지 못했습니다. 관리자 설정을 확인해 주세요.')))
      }
    })

    cancelPendingConnect = () => finish(() => reject(new Error('Slack 인증을 취소했습니다. 다시 시도할 수 있습니다.')))
    server.once('error', () => finish(() => reject(new Error('로그인 수신 포트를 열 수 없습니다. 잠시 후 다시 시도해 주세요.'))))
    server.listen(callbackPort, '127.0.0.1', () => {
      void shell.openExternal(authorization.toString())
    })
  })
}

function pruneScanSessions(): void {
  const expiresBefore = Date.now() - scanSessionTtlMs
  for (const [scanId, session] of scanSessions.entries()) {
    if (session.createdAt < expiresBefore) scanSessions.delete(scanId)
  }
}

function createScanSession(messages: SlackMessage[]): string {
  pruneScanSessions()
  const scanId = randomUUID()
  scanSessions.set(scanId, { createdAt: Date.now(), messageKeys: new Set(messages.map(messageKey)) })
  return scanId
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 780,
    minHeight: 620,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const isDevServer = process.env.VITE_DEV_SERVER_URL && targetUrl.startsWith(process.env.VITE_DEV_SERVER_URL)
    const isPackagedFile = targetUrl.startsWith('file://')
    if (!isDevServer && !isPackagedFile) event.preventDefault()
  })

  void (process.env.VITE_DEV_SERVER_URL
    ? window.loadURL(process.env.VITE_DEV_SERVER_URL)
    : window.loadFile(join(__dirname, '../../dist/index.html')))
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('slack:getStatus', status)
  ipcMain.handle('slack:connect', (_event, clientId: unknown) => connect(clientId))
  ipcMain.handle('slack:cancelConnect', async () => cancelPendingConnect?.())
  ipcMain.handle('slack:disconnect', async () => {
    scanSessions.clear()
    await removeCredential()
  })
  ipcMain.handle('slack:cancelDelete', async () => {
    cancelCurrentDelete = true
  })
  ipcMain.handle('slack:listConversations', async (): Promise<ConversationListResult> => {
    const credential = await requireCredential()
    const conversations: SlackConversation[] = []
    const userNames = new Map<string, string>()
    let userCursor: string | undefined

    try {
      do {
        const users = await slack<SlackApiEnvelope & {
          members: Array<{ id: string; profile?: { display_name?: string; real_name?: string }; real_name?: string }>
          response_metadata?: { next_cursor?: string }
        }>('users.list', credential.accessToken, { limit: 200, ...(userCursor ? { cursor: userCursor } : {}) })
        users.members.forEach((member) => userNames.set(member.id, member.profile?.display_name || member.profile?.real_name || member.real_name || member.id))
        userCursor = users.response_metadata?.next_cursor || undefined
      } while (userCursor)
    } catch {
      // A legacy app may not yet have users:read. Keep loading DM conversations
      // and fall back to the Slack conversation ID until it is reinstalled.
    }

    let cursor: string | undefined

    do {
      const data = await slack<SlackApiEnvelope & {
        channels: Array<{ id: string; name?: string; user?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean }>
        response_metadata?: { next_cursor?: string }
      }>('conversations.list', credential.accessToken, {
        types: 'public_channel,private_channel,im,mpim',
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {})
      })

      conversations.push(...data.channels.map((channel) => ({
        id: channel.id,
        name: channel.is_im ? (userNames.get(channel.user ?? '') ?? `DM ${channel.id}`) : (channel.name ?? `그룹 DM ${channel.id}`),
        kind: channel.is_im ? 'dm' : channel.is_mpim ? 'group_dm' : channel.is_private ? 'private_channel' : 'public_channel'
      } satisfies SlackConversation)))
      cursor = data.response_metadata?.next_cursor || undefined
    } while (cursor)

    const diagnostics: ConversationDiagnostic[] = ([
      { type: 'public_channel', kind: 'public_channel' },
      { type: 'private_channel', kind: 'private_channel' },
      { type: 'im', kind: 'dm' },
      { type: 'mpim', kind: 'group_dm' }
    ] as const).map(({ type, kind }) => ({
      type,
      count: conversations.filter((conversation) => conversation.kind === kind).length
    }))

    return { conversations, diagnostics }
  })
  ipcMain.handle('slack:scan', async (_event, request: unknown): Promise<ScanResult> => {
    const credential = await requireCredential()
    const validatedRequest = validateScanRequest(request)
    const messages: SlackMessage[] = []
    const inaccessibleChannelIds: string[] = []

    for (const channelId of validatedRequest.channelIds) {
      try {
        const channelMessages = await fetchConversationMessages(credential.accessToken, channelId, validatedRequest)
        messages.push(...channelMessages.filter((message) => message.userId === credential.userId))
      } catch {
        inaccessibleChannelIds.push(channelId)
      }
    }

    return { scanId: createScanSession(messages), messages, inaccessibleChannelIds }
  })
  ipcMain.handle('slack:deleteMessages', async (_event, request: unknown): Promise<DeleteResult> => {
    if (deleteInProgress) throw new Error('이미 삭제 작업이 진행 중입니다.')

    const credential = await requireCredential()
    const deleteRequest = validateDeleteRequest(request)
    const scanSession = scanSessions.get(deleteRequest.scanId)
    if (!scanSession) throw new Error('미리보기 결과가 만료되었습니다. 다시 조회해 주세요.')

    deleteInProgress = true
    cancelCurrentDelete = false
    let deleted = 0
    const failures: Array<{ ts: string; reason: string }> = []

    const sendProgress = (processed: number): void => {
      const progress: DeleteProgress = {
        processed,
        total: deleteRequest.messages.length,
        deleted,
        failed: failures.length,
        stopped: cancelCurrentDelete
      }
      _event.sender.send('slack:deleteProgress', progress)
    }

    try {
      for (const [index, message] of deleteRequest.messages.entries()) {
        if (cancelCurrentDelete) break

        if (!scanSession.messageKeys.has(messageKey(message))) {
          failures.push({ ts: message.ts, reason: '미리보기에서 확인하지 않은 메시지는 삭제하지 않습니다.' })
          sendProgress(index + 1)
          continue
        }
        if (message.userId !== credential.userId) {
          failures.push({ ts: message.ts, reason: '본인 메시지만 삭제할 수 있습니다.' })
          sendProgress(index + 1)
          continue
        }

        try {
          await slack('chat.delete', credential.accessToken, { channel: message.channelId, ts: message.ts })
          deleted += 1
        } catch (error) {
          failures.push({ ts: message.ts, reason: error instanceof Error ? error.message : 'Slack에서 삭제를 거부했습니다.' })
        }
        sendProgress(index + 1)
      }

      scanSessions.delete(deleteRequest.scanId)
      return { deleted, failed: failures.length, stopped: cancelCurrentDelete, failures }
    } finally {
      deleteInProgress = false
      cancelCurrentDelete = false
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
