import type { DeleteRequest, ScanRequest, SlackMessage } from '../types'

export const maximumDeleteCount = 10_000

const conversationIdPattern = /^[CGD][A-Z0-9]{2,}$/
const userIdPattern = /^U[A-Z0-9]{2,}$/
const timestampPattern = /^\d{10,}\.\d{6}$/
const scanIdPattern = /^[0-9a-f-]{36}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateClientId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+\.\d+$/.test(value.trim())) {
    throw new Error('Slack 앱의 Client ID 형식이 올바르지 않습니다.')
  }
  return value.trim()
}

export function validateScanRequest(value: unknown): ScanRequest {
  if (!isRecord(value)) throw new Error('삭제 대상을 다시 선택해 주세요.')

  const channelIds = value.channelIds
  const start = value.start
  const end = value.end
  const includeThreadReplies = value.includeThreadReplies

  if (!Array.isArray(channelIds) || channelIds.length === 0 || channelIds.length > 100) {
    throw new Error('대화는 1개 이상 100개 이하로 선택해 주세요.')
  }
  if (!channelIds.every((channelId) => typeof channelId === 'string' && conversationIdPattern.test(channelId))) {
    throw new Error('잘못된 대화 ID가 포함되어 있습니다.')
  }
  if (typeof start !== 'string' || typeof end !== 'string') throw new Error('날짜 범위를 다시 확인해 주세요.')

  const startTime = Date.parse(start)
  const endTime = Date.parse(end)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error('날짜 범위를 다시 확인해 주세요.')
  }
  if (endTime - startTime > 366 * 24 * 60 * 60 * 1000) {
    throw new Error('한 번에 조회할 수 있는 기간은 최대 1년입니다.')
  }

  return {
    channelIds: [...new Set(channelIds)],
    start,
    end,
    includeThreadReplies: includeThreadReplies === true
  }
}

export function messageKey(message: Pick<SlackMessage, 'channelId' | 'ts'>): string {
  return `${message.channelId}:${message.ts}`
}

export function validateSlackMessage(value: unknown): SlackMessage {
  if (!isRecord(value)) throw new Error('삭제 요청에 잘못된 메시지가 포함되어 있습니다.')

  const channelId = value.channelId
  const ts = value.ts
  const userId = value.userId
  const text = value.text
  const isThreadReply = value.isThreadReply

  if (
    typeof channelId !== 'string'
    || !conversationIdPattern.test(channelId)
    || typeof ts !== 'string'
    || !timestampPattern.test(ts)
    || typeof userId !== 'string'
    || !userIdPattern.test(userId)
    || typeof text !== 'string'
  ) {
    throw new Error('삭제 요청에 잘못된 메시지가 포함되어 있습니다.')
  }

  return { channelId, ts, userId, text, isThreadReply: isThreadReply === true }
}

export function validateDeleteRequest(value: unknown): DeleteRequest {
  if (!isRecord(value)) throw new Error('삭제 요청을 다시 확인해 주세요.')

  const scanId = value.scanId
  const messages = value.messages
  const confirmedCount = value.confirmedCount

  if (typeof scanId !== 'string' || !scanIdPattern.test(scanId)) throw new Error('미리보기 결과를 다시 생성해 주세요.')
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > maximumDeleteCount) {
    throw new Error(`삭제는 한 번에 1~${maximumDeleteCount}개만 가능합니다.`)
  }
  if (typeof confirmedCount !== 'number' || !Number.isInteger(confirmedCount) || confirmedCount !== messages.length) {
    throw new Error('입력한 삭제 건수와 실제 삭제 대상 수가 다릅니다.')
  }

  const validatedMessages = messages.map(validateSlackMessage)
  if (new Set(validatedMessages.map(messageKey)).size !== validatedMessages.length) {
    throw new Error('삭제 요청에 중복 메시지가 포함되어 있습니다.')
  }

  return { scanId, messages: validatedMessages, confirmedCount }
}
