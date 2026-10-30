import { contextBridge, ipcRenderer } from 'electron'
import type { ApiChannel, ApiRequest, WindowApi } from '../shared/api'

const api: WindowApi = {
  invoke: <K extends ApiChannel>(channel: K, payload?: ApiRequest<K>) =>
    ipcRenderer.invoke('api:invoke', channel, payload),
  chooseResumeFile: () => ipcRenderer.invoke('system:choose-resume'),
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  openPath: (path: string) => ipcRenderer.invoke('system:open-path', path),
  openWebRun: (applicationId: number, url: string) => ipcRenderer.invoke('system:open-web-run', applicationId, url),
  exportData: (kind) => ipcRenderer.invoke('system:export', kind),
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  },
  onDataChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:data-changed', listener)
    return () => ipcRenderer.removeListener('app:data-changed', listener)
  },
  onNavigate: (callback: (path: string) => void) => {
    const listener = (_event: unknown, path: string): void => callback(path)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
