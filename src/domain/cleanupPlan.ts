import type { SlackMessage } from '../types'

export type CleanupMessage = SlackMessage

export interface CleanupPlanInput {
  connectedUserId: string
  range: { start: string; end: string }
  includeThreadReplies: boolean
  excludeFileMessages: boolean
  messages: readonly CleanupMessage[]
}

export interface CleanupPlan {
  candidates: readonly CleanupMessage[]
  skipped: readonly CleanupMessage[]
}

function isWithinRange(timestamp: string, start: string, end: string): boolean {
  const time = Number(timestamp.split('.')[0]) * 1000
  return time >= Date.parse(start) && time < Date.parse(end)
}

export function buildCleanupPlan(input: CleanupPlanInput): CleanupPlan {
  const candidates = input.messages.filter((message) => (
    message.userId === input.connectedUserId
      && isWithinRange(message.ts, input.range.start, input.range.end)
      && (input.includeThreadReplies || !message.isThreadReply)
      && (!input.excludeFileMessages || !message.hasFiles)
  ))

  return {
    candidates,
    skipped: input.messages.filter((message) => !candidates.includes(message))
  }
}

export function canStartDeletion(input: {
  selectedCount: number
  acknowledgement: boolean
  typedCount: string
}): boolean {
  return input.selectedCount > 0
    && input.acknowledgement
    && input.typedCount.trim() === String(input.selectedCount)
}
