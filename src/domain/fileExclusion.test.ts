import { describe, expect, it } from 'vitest'
import { buildCleanupPlan } from './cleanupPlan'
import { validateScanRequest } from './ipcValidation'

const request = {
  channelIds: ['C123ABC'],
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-02T00:00:00.000Z',
  includeThreadReplies: true
}
const textMessage = {
  channelId: 'C123ABC', ts: '1788220800.000001', userId: 'U123ABC',
  text: 'text', isThreadReply: false, hasFiles: false
}
const fileMessage = { ...textMessage, ts: '1788220801.000001', text: '', hasFiles: true }
const textReply = { ...textMessage, ts: '1788220802.000001', isThreadReply: true }
const fileReply = { ...fileMessage, ts: '1788220803.000001', isThreadReply: true }
const input = {
  connectedUserId: 'U123ABC', range: { start: request.start, end: request.end },
  includeThreadReplies: true, excludeFileMessages: true,
  messages: [textMessage, fileMessage, textReply, fileReply]
}

describe('file exclusion in cleanup plans', () => {
  it('excludes file messages and replies while retaining text messages and replies', () => {
    const plan = buildCleanupPlan(input)
    expect(plan.candidates).toEqual([textMessage, textReply])
    expect(plan.skipped).toEqual([fileMessage, fileReply])
    expect(input.messages).toEqual([textMessage, fileMessage, textReply, fileReply])
  })

  it('allows file messages when the exclusion is explicitly disabled', () => {
    expect(buildCleanupPlan({ ...input, excludeFileMessages: false }).candidates).toEqual(input.messages)
  })

  it('combines file exclusion with thread, author, and date filters', () => {
    const outside = { ...textMessage, ts: '1788307200.000001' }
    const otherUser = { ...textMessage, userId: 'U456DEF' }
    const plan = buildCleanupPlan({ ...input, includeThreadReplies: false, messages: [...input.messages, outside, otherUser] })
    expect(plan.candidates).toEqual([textMessage])
    expect(plan.skipped).toHaveLength(5)
  })

  it('returns no candidates for a scan containing only file messages', () => {
    expect(buildCleanupPlan({ ...input, messages: [fileMessage, fileReply] }).candidates).toEqual([])
  })
})

describe('file exclusion request validation', () => {
  it('defaults to excluding file messages when the option is omitted', () => {
    expect(validateScanRequest(request).excludeFileMessages).toBe(true)
  })

  it.each([true, false])('preserves the explicit option %s', (excludeFileMessages) => {
    expect(validateScanRequest({ ...request, excludeFileMessages }).excludeFileMessages).toBe(excludeFileMessages)
  })

  it.each(['false', 'true', 0, 1, null, {}, []].map((excludeFileMessages) => ({ excludeFileMessages })))('rejects a non-boolean option: $excludeFileMessages', ({ excludeFileMessages }) => {
    expect(() => validateScanRequest({ ...request, excludeFileMessages })).toThrow('파일')
  })
})
