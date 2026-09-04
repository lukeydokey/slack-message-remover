import { contextBridge, ipcRenderer } from 'electron'
import type { DeleteProgress, DeleteRequest, ScanRequest } from '../src/types'

contextBridge.exposeInMainWorld('slackCleanup', {
  getStatus: () => ipcRenderer.invoke('slack:getStatus'),
  connect: (clientId: string) => ipcRenderer.invoke('slack:connect', clientId),
  cancelConnect: () => ipcRenderer.invoke('slack:cancelConnect'),
  disconnect: () => ipcRenderer.invoke('slack:disconnect'),
  listConversations: () => ipcRenderer.invoke('slack:listConversations'),
  scan: (request: ScanRequest) => ipcRenderer.invoke('slack:scan', request),
  deleteMessages: (request: DeleteRequest) => ipcRenderer.invoke('slack:deleteMessages', request),
  cancelDelete: () => ipcRenderer.invoke('slack:cancelDelete'),
  onDeleteProgress: (listener: (progress: DeleteProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DeleteProgress) => listener(progress)
    ipcRenderer.on('slack:deleteProgress', handler)
    return () => ipcRenderer.off('slack:deleteProgress', handler)
  }
})
