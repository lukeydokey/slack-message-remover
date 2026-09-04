export interface SlackConversation {
  id: string
  name: string
  kind: 'public_channel' | 'private_channel' | 'dm' | 'group_dm'
}

export type SlackConversationType = 'public_channel' | 'private_channel' | 'im' | 'mpim'

export interface ConversationDiagnostic {
  type: SlackConversationType
  count: number
  error?: string
}

export interface ConversationListResult {
  conversations: SlackConversation[]
  diagnostics: ConversationDiagnostic[]
  userDirectoryError?: string
}

export interface SlackMessage {
  channelId: string
  ts: string
  userId: string
  text: string
  isThreadReply: boolean
}

export interface ConnectionStatus {
  connected: boolean
  clientId?: string
  userId?: string
  userName?: string
  teamName?: string
  message?: string
}

export interface ScanRequest {
  channelIds: string[]
  start: string
  end: string
  includeThreadReplies: boolean
}

export interface ScanResult {
  scanId: string
  messages: SlackMessage[]
  inaccessibleChannelIds: string[]
}

export interface DeleteRequest {
  scanId: string
  messages: SlackMessage[]
  confirmedCount: number
}

export interface DeleteResult {
  deleted: number
  failed: number
  stopped: boolean
  failures: Array<{ ts: string; reason: string }>
}

export interface DeleteProgress {
  processed: number
  total: number
  deleted: number
  failed: number
  stopped: boolean
}

declare global {
  interface Window {
    slackCleanup: {
      getStatus: () => Promise<ConnectionStatus>
      connect: (clientId: string) => Promise<ConnectionStatus>
      cancelConnect: () => Promise<void>
      disconnect: () => Promise<void>
      listConversations: () => Promise<ConversationListResult>
      scan: (request: ScanRequest) => Promise<ScanResult>
      deleteMessages: (request: DeleteRequest) => Promise<DeleteResult>
      cancelDelete: () => Promise<void>
      onDeleteProgress: (listener: (progress: DeleteProgress) => void) => () => void
    }
  }
}
