import { messageKey } from './ipcValidation'
import type { SlackMessage } from '../types'

export function createPreviewSelection(messages: readonly SlackMessage[]): string[] {
  return [...new Set(messages.map(messageKey))]
}

export function togglePreviewMessage(
  selectedMessageKeys: readonly string[],
  message: Pick<SlackMessage, 'channelId' | 'ts'>
): string[] {
  const key = messageKey(message)
  return selectedMessageKeys.includes(key)
    ? selectedMessageKeys.filter((selectedKey) => selectedKey !== key)
    : [...selectedMessageKeys, key]
}

export function selectAllPreviewMessages(messages: readonly SlackMessage[]): string[] {
  return createPreviewSelection(messages)
}

export function clearPreviewSelection(): string[] {
  return []
}

export function selectedPreviewMessages(
  messages: readonly SlackMessage[],
  selectedMessageKeys: readonly string[]
): SlackMessage[] {
  const selectedKeys = new Set(selectedMessageKeys)
  return messages.filter((message) => selectedKeys.has(messageKey(message)))
}
