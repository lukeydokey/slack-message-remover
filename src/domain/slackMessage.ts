import type { SlackMessage } from '../types'

export interface RawSlackMessage {
  ts: string
  user?: string
  text?: string
  thread_ts?: string
  reply_count?: number
  files?: readonly unknown[]
  file?: unknown
  x_files?: readonly unknown[]
  subtype?: string
}

export function toSlackMessage(
  channelId: string,
  message: RawSlackMessage,
  isThreadReply = Boolean(message.thread_ts && message.thread_ts !== message.ts)
): SlackMessage {
  return {
    channelId,
    ts: message.ts,
    userId: message.user ?? '',
    text: message.text ?? '',
    isThreadReply,
    hasFiles: Boolean(
      message.files?.length
      || message.x_files?.length
      || message.file != null
      || message.subtype === 'file_share'
    )
  }
}
