import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { OpenCode } from '@opencode/client'
import { Service } from '@opencode/client/service'
import type { Catalog, Engine, Settings, ToolInfo } from '../shared/types'

export let clientVersion = '0.0.0'
export const setClientVersion = (value: string) => {
  clientVersion = value
}
export interface Request {
  engine: Engine
  executable: string
  directory: string
  prompt: string
  sessionId?: string | null
  providerId?: string | null
  modelId?: string | null
  reasoningEffort?: string
  fileAccess?: boolean
  memoryDirectory?: string
  /** Credential environment resolved from the user's chosen source. */
  auth?: Record<string, string>
  /** `false` drops `--restricted`, which subscription logins and apiKeyHelper need. */
  restricted?: boolean
}
export interface Update {
  text?: string
  sessionId?: string
  status?: string
}
export const safeError = (error: unknown) =>
  String(error instanceof Error ? error.message : error)
    .replace(
      /sk-[a-z0-9_-]{10,}|Bearer\s+\S+|(?:access_token|refresh_token|api[_-]?key)[\s"':=]+[^\s,"}]+/gi,
      '[已隐藏]',
    )
    .slice(0, 1800)
export function locate(engine: Engine, settings: Settings): string | null {
  const custom =
    engine === 'Codex'
      ? settings.codexPath
      : engine === 'ClaudeCode'
        ? settings.claudePath
        : settings.openCodePath
  if (custom) return existsSync(custom) ? custom : null
  const name =
    (engine === 'Codex' ? 'codex' : engine === 'ClaudeCode' ? 'claude' : 'opencode') +
    (process.platform === 'win32' ? '.exe' : '')
  const directories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((p) => p.replace(/^"|"$/g, ''))
  const candidates = directories.flatMap((p) => [
    path.join(p, name),
    path.join(p, 'node_modules/@opencode/cli/bin', name),
    path.join(p, 'node_modules/opencode-ai/node_modules/opencode-windows-x64/bin', name),
    path.join(
      p,
      'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex',
      name,
    ),
  ])
  candidates.push(
    path.join(homedir(), '.local/bin', name),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs/OpenAI/Codex/bin', name),
  )
  return candidates.find((p) => existsSync(p)) ?? null
}
export const toolsFor = (settings: Settings): ToolInfo[] =>
  (['Codex', 'ClaudeCode', 'OpenCode'] as Engine[]).map((engine) => ({
    engine,
    path: locate(engine, settings),
  }))
function kill(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => child.kill())
    killer.once('exit', (code) => {
      if (code !== 0) child.kill()
    })
  } else child.kill('SIGTERM')
}
function launch(
  executable: string,
  args: string[],
  directory: string,
  signal: AbortSignal,
  environment?: Record<string, string>,
) {
  signal.throwIfAborted()
  const child = spawn(executable, args, {
    cwd: directory,
    windowsHide: true,
    stdio: 'pipe',
    shell: false,
    ...(environment ? { env: { ...process.env, ...environment } } : {}),
  })
  let diagnostic = ''
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let stopping = false
  const stop = () => {
    if (!stopping) {
      stopping = true
      kill(child)
    }
  }
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + String(chunk)).slice(-8192)
  })
  const abort = stop
  signal.addEventListener('abort', abort, { once: true })
  child.once('close', () => signal.removeEventListener('abort', abort))
  return {
    child,
    diagnostic: () => safeError(diagnostic),
    close: async () => {
      signal.removeEventListener('abort', abort)
      if (!child.stdin.destroyed) child.stdin.end()
      stop()
      await exited
    },
  }
}

async function codexCatalog(
  executable: string,
  directory: string,
  env: Record<string, string> = {},
): Promise<Catalog> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const process = launch(
    executable,
    ['app-server', '--listen', 'stdio://'],
    directory,
    controller.signal,
    env,
  )
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  let nextId = 0
  const fail = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const write = (value: unknown) => {
    if (!process.child.stdin.destroyed) process.child.stdin.write(JSON.stringify(value) + '\n')
  }
  const lines = createInterface({ input: process.child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line)
      if (message.id === undefined || message.method) return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(safeError(message.error.message)))
      else request.resolve(message.result)
    } catch {
      return
    }
  })
  process.child.once('error', fail)
  process.child.once('close', () =>
    fail(new Error(process.diagnostic() || 'Codex 模型目录连接已关闭。')),
  )
  const call = (method: string, params: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Codex ${method} 超时。`))
      }, 30_000)
      pending.set(id, { resolve, reject, timer })
      write({ id, method, params })
    })
  try {
    await call('initialize', {
      clientInfo: { name: 'flowchat', title: 'FlowChat', version: clientVersion },
    })
    write({ method: 'initialized', params: {} })
    const result = await call('model/list', { limit: 100, includeHidden: false })
    const models = Array.isArray(result?.data) ? result.data : []
    return {
      providers: [],
      models: models
        .filter((model: any) => model?.model || model?.id)
        .map((model: any) => ({
          id: model.model ?? model.id,
          providerId: 'codex',
          name: model.displayName ?? model.model ?? model.id,
          enabled: true,
          reasoningEfforts: (model.supportedReasoningEfforts ?? [])
            .map((option: any) => option.reasoningEffort)
            .filter((effort: unknown): effort is string => typeof effort === 'string'),
          defaultReasoningEffort: model.defaultReasoningEffort,
        })),
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('读取 Codex 模型目录超时。')
    throw error
  } finally {
    clearTimeout(timeout)
    lines.close()
    await process.close()
    fail(new Error('Codex 模型目录连接已结束。'))
  }
}
export async function runCodex(request: Request, update: (u: Update) => void, signal: AbortSignal) {
  const process = launch(
    request.executable,
    ['app-server', '--listen', 'stdio://'],
    request.directory,
    signal,
    request.auth,
  )
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  let nextId = 0,
    sessionId = '',
    complete = false
  const texts = new Map<string, string>()
  let resolveDone!: () => void, rejectDone!: (e: Error) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  void done.catch(() => {})
  const fail = (error: Error) => {
    rejectDone(error)
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    pending.clear()
  }
  const write = (value: unknown) => {
    if (!process.child.stdin.destroyed) process.child.stdin.write(JSON.stringify(value) + '\n')
  }
  process.child.stdin.on('error', () => fail(new Error('Codex 输入连接已关闭。')))
  process.child.once('error', (e) => fail(e))
  process.child.once('close', () => {
    if (!complete)
      fail(
        new Error(signal.aborted ? '已停止生成。' : process.diagnostic() || 'Codex 连接提前关闭。'),
      )
  })
  const lines = createInterface({ input: process.child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    let message: any
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.id !== undefined && !message.method) {
      const p = pending.get(message.id)
      if (p) {
        pending.delete(message.id)
        clearTimeout(p.timer)
        message.error
          ? p.reject(new Error(safeError(message.error.message)))
          : p.resolve(message.result)
      }
      return
    }
    if (message.id !== undefined) {
      write(
        message.method?.endsWith('requestApproval')
          ? { id: message.id, result: { decision: 'decline' } }
          : {
              id: message.id,
              error: { code: -32601, message: 'Interactive tools are disabled in FlowChat.' },
            },
      )
      return
    }
    const data = message.params
    if (!data || data.threadId !== sessionId) return
    if (message.method === 'item/agentMessage/delta') {
      texts.set(data.itemId, (texts.get(data.itemId) ?? '') + data.delta)
      update({ text: [...texts.values()].join('\n\n'), status: '正在回答' })
    }
    if (message.method === 'item/started' && data.item?.type === 'fileChange')
      update({ status: '正在编辑文件' })
    if (message.method === 'item/started' && data.item?.type === 'commandExecution')
      update({ status: '正在操作工作目录' })
    if (message.method === 'item/completed' && data.item?.type === 'agentMessage') {
      texts.set(data.item.id, data.item.text)
      update({ text: [...texts.values()].join('\n\n') })
    }
    if (message.method === 'turn/completed') {
      if (data.turn?.status === 'completed') {
        complete = true
        resolveDone()
      } else fail(new Error(safeError(data.turn?.error?.message ?? 'Codex 请求已中断。')))
    }
    if (message.method === 'error' && !data.willRetry)
      fail(new Error(safeError(data.error?.message ?? 'Codex 请求失败。')))
  })
  const call = (method: string, params: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Codex ${method} 超时。`))
      }, 90_000)
      pending.set(id, { resolve, reject, timer })
      write({ id, method, params })
    })
  try {
    await call('initialize', {
      clientInfo: { name: 'flowchat', title: 'FlowChat', version: clientVersion },
    })
    write({ method: 'initialized', params: {} })
    const params = {
      cwd: request.directory,
      approvalPolicy: 'never',
      sandbox: request.fileAccess ? 'workspace-write' : 'read-only',
      ...(request.modelId ? { model: request.modelId } : {}),
    }
    const result = request.sessionId
      ? await call('thread/resume', { ...params, threadId: request.sessionId, excludeTurns: true })
      : await call('thread/start', params)
    sessionId = result.thread?.id
    if (!sessionId) throw new Error('Codex 未能创建会话。')
    update({ sessionId, status: '正在思考' })
    await call('turn/start', {
      threadId: sessionId,
      input: [{ type: 'text', text: request.prompt }],
      approvalPolicy: 'never',
      // Codex 0.17x dropped workspaceWrite.readOnlyAccess; sending it fails the whole turn/start.
      sandboxPolicy: request.fileAccess
        ? {
            type: 'workspaceWrite',
            writableRoots: [
              ...new Set([
                request.directory,
                ...(request.memoryDirectory ? [request.memoryDirectory] : []),
              ]),
            ],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          }
        : { type: 'readOnly' },
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
    })
    await done
    signal.throwIfAborted()
    return { sessionId, text: [...texts.values()].join('\n\n') }
  } finally {
    lines.close()
    await process.close()
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Codex 会话已结束。'))
    }
    pending.clear()
  }
}

export class ClaudeParser {
  text = ''
  sessionId = ''
  error = ''
  completed = false
  accept(message: any): Update {
    if (message.session_id) this.sessionId = message.session_id
    if (
      message.type === 'stream_event' &&
      message.event?.type === 'content_block_delta' &&
      message.event.delta?.type === 'text_delta'
    )
      this.text += message.event.delta.text
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      const text = message.message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
      if (text) this.text = text
    }
    if (message.type === 'result') {
      this.completed = true
      if (message.is_error || message.subtype !== 'success')
        this.error = safeError(
          message.errors?.join('\n') || message.result || 'Claude Code 请求失败。',
        )
      else if (message.result) this.text = message.result
    }
    const tool =
      message.type === 'assistant' &&
      message.message?.content?.find((part: any) => part.type === 'tool_use')
    return {
      text: this.text,
      sessionId: this.sessionId || undefined,
      ...(tool ? { status: `正在使用文件工具：${tool.name}` } : {}),
    }
  }
}
// `--restricted` makes Claude Code ignore user settings files, so credentials must reach the child
// process as environment variables; the controller resolves them from the source the user picked.
const claudeLoginFailure =
  'Claude Code 未登录：请先在终端运行 claude 完成登录，或在 ~/.claude/settings.json 的 env 中配置 ANTHROPIC_AUTH_TOKEN。'
export async function runClaude(
  request: Request,
  update: (u: Update) => void,
  signal: AbortSignal,
) {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    request.fileAccess ? 'Read,Edit,Write,Glob,Grep' : '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--settings',
    '{"disableAllHooks":true}',
  ]
  if (request.fileAccess && request.restricted !== false)
    args.push('--restricted', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep')
  else if (request.fileAccess) args.push('--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep')
  if (request.fileAccess && request.memoryDirectory) args.push('--add-dir', request.memoryDirectory)
  if (request.modelId) args.push('--model', request.modelId)
  if (request.reasoningEffort) args.push('--effort', request.reasoningEffort)
  if (request.sessionId) args.push('--resume', request.sessionId)
  const process = launch(request.executable, args, request.directory, signal, {
      ...request.auth,
      ...(request.reasoningEffort ? { CLAUDE_CODE_EFFORT_LEVEL: request.reasoningEffort } : {}),
    }),
    parser = new ClaudeParser()
  const exit = new Promise<number | null>((resolve, reject) => {
    process.child.once('error', reject)
    process.child.once('close', resolve)
  })
  void exit.catch(() => {})
  process.child.stdin.on('error', () => {})
  process.child.stdin.end(request.prompt)
  try {
    for await (const line of createInterface({
      input: process.child.stdout,
      crlfDelay: Infinity,
    })) {
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      update(parser.accept(message))
    }
    const code = await exit
    signal.throwIfAborted()
    if (code !== 0 || parser.error) {
      const failure = parser.error || process.diagnostic() || 'Claude Code 请求失败，请检查登录。'
      throw new Error(
        /not logged in|authentication[_ ]failed|please run \/login/i.test(failure)
          ? claudeLoginFailure
          : failure,
      )
    }
    if (!parser.completed || !parser.sessionId) throw new Error('Claude Code 未返回完整结果。')
    return { text: parser.text, sessionId: parser.sessionId }
  } finally {
    await process.close()
  }
}

async function openCode(executable: string, env: Record<string, string> = {}) {
  const endpoint = await Service.ensure({
    command: [executable, 'serve', '--service'],
    env,
  })
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
}
async function openCodeCatalog(
  executable: string,
  directory: string,
  env: Record<string, string> = {},
): Promise<Catalog> {
  const client = await openCode(executable, env),
    location = { directory }
  const options = { signal: AbortSignal.timeout(30_000) }
  const [providers, models] = await Promise.all([
    client.provider.list({ location }, options),
    client.model.list({ location, types: ['chat'] }, options),
  ])
  return {
    providers: providers.data.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.activation !== 'disabled',
    })),
    models: models.data.map((m) => ({
      id: m.id,
      name: m.name,
      providerId: m.providerID,
      enabled: m.enabled && m.status !== 'deprecated',
      reasoningEfforts: m.variants
        .filter(
          (variant) =>
            /^(none|minimal|low|medium|high|xhigh|max|ultra)$/.test(variant.id) ||
            Object.keys({ ...variant.settings, ...variant.body }).some((key) =>
              /reasoning|thinking/i.test(key),
            ),
        )
        .map((variant) => variant.id),
      defaultReasoningEffort: m.variants.find(
        (variant) =>
          variant.settings?.reasoningEffort &&
          variant.settings.reasoningEffort === m.settings?.reasoningEffort,
      )?.id,
    })),
  }
}
export async function catalog(
  engine: Engine,
  executable: string,
  directory: string,
  env: Record<string, string> = {},
): Promise<Catalog> {
  if (engine === 'Codex') return codexCatalog(executable, directory, env)
  if (engine === 'ClaudeCode')
    return {
      providers: [],
      models: [
        {
          id: 'opus',
          providerId: 'claude',
          name: 'Opus',
          enabled: true,
          reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultReasoningEffort: 'medium',
        },
        {
          id: 'sonnet',
          providerId: 'claude',
          name: 'Sonnet',
          enabled: true,
          reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultReasoningEffort: 'medium',
        },
        {
          id: 'haiku',
          providerId: 'claude',
          name: 'Haiku',
          enabled: true,
          reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultReasoningEffort: 'medium',
        },
      ],
    }
  return openCodeCatalog(executable, directory, env)
}
export async function runOpenCode(
  request: Request,
  update: (u: Update) => void,
  signal: AbortSignal,
) {
  const client = await openCode(request.executable, request.auth)
  signal.throwIfAborted()
  if (!request.providerId || !request.modelId) throw new Error('请先选择 OpenCode 的供应商和模型。')
  const model = {
    providerID: request.providerId,
    id: request.modelId,
    ...(request.reasoningEffort ? { variant: request.reasoningEffort } : {}),
  }
  let sessionId = request.sessionId
  if (sessionId) await client.session.switchModel({ sessionID: sessionId, model }, { signal })
  else
    sessionId = (
      await client.session.create(
        {
          location: { directory: request.directory },
          model,
          title: 'FlowChat',
          permissions: [
            { action: '*', resource: '*', effect: 'deny' },
            ...(request.fileAccess
              ? ['read', 'edit', 'write', 'glob', 'grep', 'list'].map((action) => ({
                  action,
                  resource: '*',
                  effect: 'allow' as const,
                }))
              : []),
            { action: 'external_directory', resource: '*', effect: 'deny' },
            ...(request.fileAccess && request.memoryDirectory
              ? [
                  request.memoryDirectory.replaceAll('\\', '/'),
                  request.memoryDirectory.replaceAll('\\', '/') + '/**',
                ].map((resource) => ({
                  action: 'external_directory',
                  resource,
                  effect: 'allow' as const,
                }))
              : []),
          ],
        },
        { signal },
      )
    ).id
  update({ sessionId, status: '正在思考' })
  const eventAbort = new AbortController()
  const abort = () => {
    void client.session.interrupt({ sessionID: sessionId! }).catch(() => {})
    eventAbort.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  const texts = new Map<string, string>()
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const events = (async () => {
    for await (const event of client.event.subscribe({ signal: eventAbort.signal })) {
      if (event.type === 'server.connected') {
        resolveReady()
        continue
      }
      const data = event.data as any
      if (data?.sessionID !== sessionId) continue
      if (event.type === 'session.text.delta') {
        const key = `${data.assistantMessageID}:${data.ordinal}`
        texts.set(key, (texts.get(key) ?? '') + data.delta)
        update({ text: [...texts.values()].join('\n\n') })
      }
      if (event.type === 'session.tool.called') update({ status: '正在操作工作目录' })
      if (event.type === 'session.text.ended') {
        texts.set(`${data.assistantMessageID}:${data.ordinal}`, data.text)
        update({ text: [...texts.values()].join('\n\n') })
      }
      if (event.type === 'permission.asked')
        await client.permission.reply({
          sessionID: sessionId!,
          requestID: data.id,
          decision: 'reject',
        })
      if (event.type === 'session.execution.failed')
        throw new Error(data.error?.message ?? 'OpenCode 生成失败。')
      if (event.type === 'session.execution.interrupted') throw new Error('已停止生成。')
      if (event.type === 'session.execution.succeeded') return
    }
    throw new Error('OpenCode 事件连接提前关闭。')
  })()
  void events.catch(() => {})
  try {
    await Promise.race([ready, events])
    signal.throwIfAborted()
    await client.session.prompt({ sessionID: sessionId!, text: request.prompt }, { signal })
    await events
    signal.throwIfAborted()
    const text = [...texts.values()].join('\n\n')
    if (!text.trim()) throw new Error('OpenCode 未返回文本回答。')
    return { sessionId: sessionId!, text }
  } finally {
    signal.removeEventListener('abort', abort)
    eventAbort.abort()
  }
}
export const runHarness = (request: Request, update: (u: Update) => void, signal: AbortSignal) =>
  (request.engine === 'Codex'
    ? runCodex
    : request.engine === 'ClaudeCode'
      ? runClaude
      : runOpenCode)(request, update, signal)
export async function checkTool(
  engine: Engine,
  executable: string,
  directory: string,
  env: Record<string, string> = {},
) {
  if (engine === 'OpenCode') {
    const result = await openCodeCatalog(executable, directory, env)
    return result.models.some((m) => m.enabled)
      ? '已连接，可用模型目录已读取。'
      : '工具可用，请先在 OpenCode 配置供应商。'
  }
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15_000)
  const process = launch(
    executable,
    engine === 'Codex' ? ['login', 'status'] : ['auth', 'status'],
    directory,
    controller.signal,
  )
  let output = ''
  process.child.stdout.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-8192)
  })
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      process.child.on('error', reject)
      process.child.on('close', resolve)
    })
    if (code !== 0 || controller.signal.aborted)
      throw new Error(process.diagnostic() || '登录检查失败或超时。')
    return safeError(output || process.diagnostic() || '登录状态检查完成。')
  } finally {
    clearTimeout(timer)
    await process.close()
  }
}
