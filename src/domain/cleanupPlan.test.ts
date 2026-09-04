import { describe, expect, it } from 'vitest'
import { buildCleanupPlan, canStartDeletion } from './cleanupPlan'
import { messageKey, validateClientId, validateDeleteRequest, validateScanRequest } from './ipcValidation'

describe('buildCleanupPlan', () => {
  it('includes only the connected user messages inside the selected range by default', () => {
    const plan = buildCleanupPlan({
      connectedUserId: 'U1',
      range: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
      includeThreadReplies: false,
      messages: [
        { channelId: 'C1', ts: '1788220800.000001', userId: 'U1', text: 'keep', isThreadReply: false },
        { channelId: 'C1', ts: '1788307200.000001', userId: 'U1', text: 'outside', isThreadReply: false },
        { channelId: 'C1', ts: '1788220801.000001', userId: 'U2', text: 'other user', isThreadReply: false },
        { channelId: 'C1', ts: '1788220802.000001', userId: 'U1', text: 'thread', isThreadReply: true }
      ]
    })

    expect(plan.candidates.map((message) => message.text)).toEqual(['keep'])
    expect(plan.skipped).toHaveLength(3)
  })
})

describe('canStartDeletion', () => {
  it('requires the exact displayed count and an explicit acknowledgement', () => {
    expect(canStartDeletion({ candidateCount: 3, acknowledgement: true, typedCount: '3' })).toBe(true)
    expect(canStartDeletion({ candidateCount: 3, acknowledgement: true, typedCount: '2' })).toBe(false)
    expect(canStartDeletion({ candidateCount: 3, acknowledgement: false, typedCount: '3' })).toBe(false)
  })
})

describe('IPC validation', () => {
  it('accepts only Slack-style client ids', () => {
    expect(validateClientId('123456789.987654321')).toBe('123456789.987654321')
    expect(() => validateClientId('xoxp-secret')).toThrow('Client ID')
  })

  it('normalizes scan requests and rejects unsafe ranges', () => {
    const scan = validateScanRequest({
      channelIds: ['C123ABC', 'C123ABC', 'D456DEF'],
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-02T00:00:00.000Z',
      includeThreadReplies: true
    })

    expect(scan.channelIds).toEqual(['C123ABC', 'D456DEF'])
    expect(scan.includeThreadReplies).toBe(true)
    expect(() => validateScanRequest({ channelIds: ['C123'], start: '2026-09-02', end: '2026-09-01' })).toThrow('날짜')
  })

  it('requires delete requests to match the confirmed count and contain unique messages', () => {
    const message = { channelId: 'C123ABC', ts: '1788220800.000001', userId: 'U123ABC', text: 'hello', isThreadReply: false }
    const request = validateDeleteRequest({
      scanId: '123e4567-e89b-12d3-a456-426614174000',
      messages: [message],
      confirmedCount: 1
    })

    expect(messageKey(request.messages[0])).toBe('C123ABC:1788220800.000001')
    expect(() => validateDeleteRequest({ scanId: request.scanId, messages: [message, message], confirmedCount: 2 })).toThrow('중복')
    expect(() => validateDeleteRequest({ scanId: request.scanId, messages: [message], confirmedCount: 2 })).toThrow('건수')
  })
})
