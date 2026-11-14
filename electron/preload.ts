import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/types'

const api: DesktopAPI = {
  onPrepareClose: (callback) => {
    const handler = async () => {
      try {
        await callback()
        ipcRenderer.send('flowchat:close-ready')
      } catch {
        ipcRenderer.send('flowchat:close-ready', '内容保存失败，请重试。')
      }
    }
    ipcRenderer.on('flowchat:prepare-close', handler)
    return () => {
      ipcRenderer.removeListener('flowchat:prepare-close', handler)
    }
  },
  command: (command) => ipcRenderer.invoke('flowchat:command', command),
  onState: (callback) => {
    const handler = (_event: unknown, value: any) => callback(value)
    ipcRenderer.on('flowchat:state', handler)
    return () => {
      ipcRenderer.removeListener('flowchat:state', handler)
    }
  },
  onStream: (callback) => {
    const handler = (_event: unknown, value: any) => callback(value)
    ipcRenderer.on('flowchat:stream', handler)
    return () => {
      ipcRenderer.removeListener('flowchat:stream', handler)
    }
  },
  window: (action) => ipcRenderer.send('flowchat:window', action),
  exportMarkdown: (text, title) => ipcRenderer.invoke('flowchat:export', text, title),
  openDataDirectory: () => ipcRenderer.invoke('flowchat:open-data'),
  openWorkingDirectory: () => ipcRenderer.invoke('flowchat:open-workspace'),
  pickExecutable: () => ipcRenderer.invoke('flowchat:pick-executable'),
  pickDirectory: () => ipcRenderer.invoke('flowchat:pick-directory'),
  transcribe: (audio, mimeType) => ipcRenderer.invoke('flowchat:transcribe', audio, mimeType),
  synthesize: (text) => ipcRenderer.invoke('flowchat:synthesize', text),
  login: (engine) => ipcRenderer.invoke('flowchat:login', engine),
}
contextBridge.exposeInMainWorld('flowchat', api)
