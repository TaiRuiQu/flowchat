import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Controller } from './controller'
import { Store } from './store'
import { locate, safeError } from './harness'
import type { Command, Engine } from '../shared/types'
import { synthesize, transcribe } from './compatible-api'
import { resolveWorkspace } from './workspace'

const directory = path.dirname(fileURLToPath(import.meta.url))
const appId = 'com.flowchat.desktop'
let window: BrowserWindow | undefined,
  controller: Controller,
  closing = false,
  preparingClose = false,
  rendererReady = false
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId(appId)
      let icon = path.join(
        app.getAppPath(),
        'assets',
        process.platform === 'win32' ? 'flowchat.ico' : 'flowchat.png',
      )
      if (process.platform === 'win32') {
        const bytes = await fs.readFile(icon)
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
        // Explorer cannot read inside app.asar. A new path also avoids stale shell icon caches.
        const icons = path.join(app.getPath('userData'), 'icons')
        await fs.mkdir(icons, { recursive: true })
        icon = path.join(icons, `flowchat-${hash}.ico`)
        await fs.writeFile(icon, bytes)
      }
      const root = process.env.FLOWCHAT_DATA_DIR ?? path.join(app.getPath('userData'), 'workspace')
      controller = new Controller(
        new Store(root, {
          encrypt: (value) => {
            if (!safeStorage.isEncryptionAvailable())
              throw new Error('系统凭据加密不可用，无法保存 API Key。')
            return safeStorage.encryptString(value).toString('base64')
          },
          decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
        }),
        (event, value) => {
          if (window && !window.isDestroyed()) window.webContents.send(`flowchat:${event}`, value)
        },
      )
      // Loading is done by the renderer so data errors are recoverable inside the window.
      let geometry = { width: 1440, height: 960, maximized: false }
      try {
        const settings = await controller.store.read<any>('settings.json', {})
        geometry = {
          width: Math.max(800, Math.min(2560, settings.windowWidth ?? 1440)),
          height: Math.max(600, Math.min(1600, settings.windowHeight ?? 960)),
          maximized: settings.maximized ?? false,
        }
      } catch {}
      window = new BrowserWindow({
        icon,
        width: geometry.width,
        height: geometry.height,
        minWidth: 420,
        minHeight: 560,
        title: 'FlowChat',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
        show: false,
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      })
      if (process.platform === 'win32')
        window.setAppDetails({
          appId,
          appIconPath: icon,
          relaunchCommand: app.isPackaged
            ? `"${process.execPath}"`
            : `"${process.execPath}" "${app.getAppPath()}"`,
          relaunchDisplayName: 'FlowChat',
        })
      window.removeMenu()
      const isTrusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('无效的请求来源。')
      }
      ipcMain.handle('flowchat:command', async (event, command: Command) => {
        isTrusted(event)
        rendererReady = true
        try {
          const result = await controller.execute(command)
          const theme = controller.settings.theme
          nativeTheme.themeSource =
            theme === 'System' ? 'system' : theme === 'Dark' ? 'dark' : 'light'
          return result
        } catch (e) {
          throw new Error(safeError(e))
        }
      })
      ipcMain.on('flowchat:window', (event, action: string) => {
        isTrusted(event)
        if (action === 'minimize') window?.minimize()
        if (action === 'maximize') window?.isMaximized() ? window.unmaximize() : window?.maximize()
        if (action === 'close') window?.close()
      })
      ipcMain.handle('flowchat:export', async (event, text: unknown, title: unknown) => {
        isTrusted(event)
        if (typeof text !== 'string' || text.length > 20_000_000 || typeof title !== 'string')
          throw new Error('导出内容无效。')
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) + '.md',
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        })
        if (result.canceled || !result.filePath) return false
        await fs.writeFile(result.filePath, text, 'utf8')
        return true
      })
      ipcMain.handle('flowchat:open-data', async (event) => {
        isTrusted(event)
        await shell.openPath(root)
      })
      ipcMain.handle('flowchat:open-workspace', async (event) => {
        isTrusted(event)
        const directory = await resolveWorkspace(controller.workingDirectory)
        const error = await shell.openPath(directory)
        if (error) throw new Error(error)
      })
      ipcMain.handle('flowchat:pick-executable', async (event) => {
        isTrusted(event)
        const result = await dialog.showOpenDialog(window!, {
          properties: ['openFile'],
          filters: [
            { name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
          ],
        })
        return result.filePaths[0] ?? null
      })
      ipcMain.handle('flowchat:pick-directory', async (event) => {
        isTrusted(event)
        const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
        return result.filePaths[0] ?? null
      })
      ipcMain.handle('flowchat:transcribe', async (event, audio: unknown, mimeType: unknown) => {
        isTrusted(event)
        if (
          !(audio instanceof ArrayBuffer) ||
          typeof mimeType !== 'string' ||
          mimeType.length > 100
        )
          throw new Error('无效的录音数据。')
        try {
          return await transcribe(controller.settings.speech, new Uint8Array(audio), mimeType)
        } catch (error) {
          throw new Error(safeError(error))
        }
      })
      ipcMain.handle('flowchat:synthesize', async (event, text: unknown) => {
        isTrusted(event)
        if (typeof text !== 'string') throw new Error('无效的朗读内容。')
        try {
          return await synthesize(controller.settings.speech, text)
        } catch (error) {
          throw new Error(safeError(error))
        }
      })
      ipcMain.handle('flowchat:login', async (event, engine: Engine) => {
        isTrusted(event)
        if (!['Codex', 'ClaudeCode', 'OpenCode'].includes(engine)) throw new Error('未知工具。')
        const executable = locate(engine, controller.settings)
        if (!executable) throw new Error('未找到工具。')
        const args =
          engine === 'Codex'
            ? ['login']
            : engine === 'ClaudeCode'
              ? ['auth', 'login']
              : ['auth', 'login']
        // Launch an intentional interactive console; no untrusted text is passed to a shell.
        const child = spawn(executable, args, {
          windowsHide: false,
          detached: true,
          stdio: 'ignore',
          shell: false,
        })
        child.on('error', () => {})
        child.unref()
      })
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.session.setPermissionRequestHandler(
        (contents, permission, callback, details) =>
          callback(
            contents === window?.webContents &&
              permission === 'media' &&
              controller.settings.speech.enabled &&
              'mediaTypes' in details &&
              details.mediaTypes?.includes('audio') === true &&
              !details.mediaTypes.includes('video'),
          ),
      )
      window.webContents.session.setPermissionCheckHandler(
        (contents, permission, _origin, details) =>
          contents === window?.webContents &&
          permission === 'media' &&
          controller.settings.speech.enabled &&
          details.mediaType === 'audio',
      )
      window.once('ready-to-show', () => {
        if (geometry.maximized) window?.maximize()
        window?.show()
      })
      window.on('close', async (event) => {
        if (closing) return
        event.preventDefault()
        if (preparingClose) return
        preparingClose = true
        try {
          if (controller.busy) {
            const result = await dialog.showMessageBox(window!, {
              type: 'question',
              message: '回答仍在生成，停止并退出？',
              buttons: ['继续对话', '停止并退出'],
              defaultId: 0,
              cancelId: 0,
            })
            if (result.response !== 1) return
          }
          try {
            if (rendererReady)
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  ipcMain.removeListener('flowchat:close-ready', ready)
                  reject(new Error('等待界面保存内容超时。'))
                }, 5000)
                const ready = (event: Electron.IpcMainEvent, error?: string) => {
                  if (event.sender !== window?.webContents) return
                  clearTimeout(timeout)
                  ipcMain.removeListener('flowchat:close-ready', ready)
                  error ? reject(new Error(error)) : resolve()
                }
                ipcMain.on('flowchat:close-ready', ready)
                window!.webContents.send('flowchat:prepare-close')
              })
            const bounds = window!.getNormalBounds()
            controller.settings.windowWidth = bounds.width
            controller.settings.windowHeight = bounds.height
            controller.settings.maximized = window!.isMaximized()
            await controller.shutdown()
            closing = true
            window?.close()
          } catch (e) {
            await dialog.showMessageBox(window!, {
              type: 'error',
              message: '保存失败，窗口已保留',
              detail: safeError(e),
            })
          }
        } finally {
          preparingClose = false
        }
      })
      if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged)
        await window.loadURL(process.env.ELECTRON_RENDERER_URL)
      else await window.loadFile(path.join(directory, '../dist/index.html'))
    })
    .catch((error) => {
      dialog.showErrorBox('FlowChat 启动失败', safeError(error))
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
}
