export interface CleanupMessage {
  channelId: string
  ts: string
  userId: string
  text: string
  isThreadReply: boolean
}

export interface CleanupPlanInput {
  connectedUserId: string
  range: { start: string; end: string }
  includeThreadReplies: boolean
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
  ))

  return {
    candidates,
    skipped: input.messages.filter((message) => !candidates.includes(message))
  }
}

export function canStartDeletion(input: {
  candidateCount: number
  acknowledgement: boolean
  typedCount: string
}): boolean {
  return input.candidateCount > 0
    && input.acknowledgement
    && input.typedCount.trim() === String(input.candidateCount)
}
