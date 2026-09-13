import { describe, expect, it } from 'vitest'
import { toSlackMessage } from './slackMessage'

describe('toSlackMessage', () => {
  const message = { ts: '1788220800.000001', user: 'U123ABC', text: 'hello' }

  it.each([
    { files: [{ id: 'F123', mimetype: 'image/png' }] },
    { files: [{ id: 'F123', file_access: 'check_file_info' }] },
    { files: [{ id: 'F123' }, { id: 'F456' }] },
    { file: { id: 'F123' } },
    { subtype: 'file_share' },
    { x_files: ['F123'] }
  ])('detects file messages from Slack metadata: %j', (metadata) => {
    expect(toSlackMessage('C123ABC', { ...message, ...metadata }).hasFiles).toBe(true)
  })

  it.each([{}, { files: [] }, { file: null }, { x_files: [] }, { subtype: 'thread_broadcast' }])(
    'keeps messages without files: %j', (metadata) => {
      expect(toSlackMessage('C123ABC', { ...message, ...metadata }).hasFiles).toBe(false)
    }
  )

  it('does not treat a link preview as an uploaded file', () => {
    const linkPreview = { ...message, attachments: [{ title: 'A website', image_url: 'https://example.com/image.png' }] }
    expect(toSlackMessage('C123ABC', linkPreview).hasFiles).toBe(false)
  })

  it('retains file metadata for thread replies and handles absent text', () => {
    expect(toSlackMessage('C123ABC', { ts: message.ts, files: [{}] }, true)).toEqual({
      channelId: 'C123ABC', ts: message.ts, userId: '', text: '', isThreadReply: true, hasFiles: true
    })
  })

  it('recognizes a broadcast reply in conversation history', () => {
    expect(toSlackMessage('C123ABC', { ...message, thread_ts: '1788220799.000001' }).isThreadReply).toBe(true)
    expect(toSlackMessage('C123ABC', { ...message, thread_ts: message.ts }).isThreadReply).toBe(false)
  })
})
