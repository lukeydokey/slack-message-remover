import { describe, expect, it } from 'vitest'
import {
  clearPreviewSelection,
  createPreviewSelection,
  selectedPreviewMessages,
  selectAllPreviewMessages,
  togglePreviewMessage
} from './previewSelection'

const messages = [
  { channelId: 'C123ABC', ts: '1788220800.000001', userId: 'U123ABC', text: 'first', isThreadReply: false, hasFiles: false },
  { channelId: 'C123ABC', ts: '1788220801.000001', userId: 'U123ABC', text: 'second', isThreadReply: false, hasFiles: false },
  { channelId: 'D456DEF', ts: '1788220802.000001', userId: 'U123ABC', text: 'third', isThreadReply: false, hasFiles: false }
]

describe('preview selection', () => {
  it('selects every unique message when a preview is created', () => {
    expect(createPreviewSelection(messages)).toEqual([
      'C123ABC:1788220800.000001',
      'C123ABC:1788220801.000001',
      'D456DEF:1788220802.000001'
    ])
  })

  it('toggles only the requested message without mutating the prior selection', () => {
    const initialSelection = createPreviewSelection(messages)
    const updatedSelection = togglePreviewMessage(initialSelection, messages[1])

    expect(updatedSelection).toEqual(['C123ABC:1788220800.000001', 'D456DEF:1788220802.000001'])
    expect(initialSelection).toHaveLength(3)
  })

  it('clears and restores the complete preview selection', () => {
    const clearedSelection = clearPreviewSelection()

    expect(clearedSelection).toEqual([])
    expect(selectAllPreviewMessages(messages)).toEqual(createPreviewSelection(messages))
  })

  it('returns only selected preview messages in their displayed order', () => {
    const selected = selectedPreviewMessages(messages, [
      'D456DEF:1788220802.000001',
      'C123ABC:1788220800.000001',
      'C123ABC:9999999999.000001'
    ])

    expect(selected.map((message) => message.text)).toEqual(['first', 'third'])
  })

  it('does not retain selections when a new preview is initialized', () => {
    expect(createPreviewSelection([messages[1]])).toEqual(['C123ABC:1788220801.000001'])
  })
})
