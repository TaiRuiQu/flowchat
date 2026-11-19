import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { CredentialOption, Engine, EngineAuth } from '../shared/types'

export const claudeConfigDirectory = () =>
  process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude')

export function claudeSettings(): Record<string, any> | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(claudeConfigDirectory(), 'settings.json'), 'utf8'),
    )
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
// `--restricted` makes Claude Code ignore user settings files, and most relay setups keep their
// token and base URL in `~/.claude/settings.json` under `env`. Forward that block through the child
// environment so a restricted run authenticates exactly like an interactive `claude` session.
export function claudeSettingsEnv(): Record<string, string> {
  const values = claudeSettings()?.env
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {}
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}
export function mask(value: string) {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`
}
const tokenOf = (source: Record<string, string | undefined> | undefined) =>
  source?.ANTHROPIC_AUTH_TOKEN?.trim() ||
  source?.ANTHROPIC_API_KEY?.trim() ||
  source?.OPENAI_API_KEY?.trim() ||
  ''
const describe = (source: Record<string, string | undefined> | undefined) => {
  const token = tokenOf(source),
    baseUrl = source?.ANTHROPIC_BASE_URL?.trim() || source?.OPENAI_BASE_URL?.trim()
  if (!token) return '未配置令牌'
  return `${mask(token)} · ${baseUrl || '默认官方地址'}`
}
/** A subscription login leaves its own token on disk; a settings token does not. */
function storedOauth() {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(claudeConfigDirectory(), '.credentials.json'), 'utf8'),
    )
    return !!parsed?.claudeAiOauth
  } catch {
    return false
  }
}
function run(executable: string, args: string[], directory: string, timeout = 8000) {
  return new Promise<string | null>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, args, {
        cwd: directory,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      resolve(null)
      return
    }
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, timeout)
    const collect = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-8192)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolve(output.trim() || null)
    })
  })
}
async function claudeStatus(executable: string | null, directory: string) {
  if (!executable) return { loggedIn: false, method: '', subscription: false }
  const output = await run(executable, ['auth', 'status'], directory)
  try {
    const status = JSON.parse(output ?? '')
    const method = typeof status?.authMethod === 'string' ? status.authMethod : ''
    return {
      loggedIn: status?.loggedIn === true,
      method,
      subscription: status?.loggedIn === true && (storedOauth() || status?.loginExpiresAt != null),
    }
  } catch {
    return { loggedIn: false, method: '', subscription: false }
  }
}
async function codexStatus(executable: string | null, directory: string) {
  if (!executable) return { loggedIn: false, detail: '' }
  const output = await run(executable, ['login', 'status'], directory)
  if (!output) return { loggedIn: false, detail: '' }
  const loggedIn = /logged in|chatgpt|api key/i.test(output) && !/not logged in/i.test(output)
  return { loggedIn, detail: output.split('\n')[0].slice(0, 90) }
}
async function openCodeAuth(executable: string | null) {
  if (!executable) return { stored: [] as string[], detail: '' }
  const output = await run(executable, ['auth', 'list'], process.cwd())
  if (!output) return { stored: [] as string[], detail: '' }
  const stored = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /stored|configured|✓/i.test(line))
    .map((line) => line.split(/\s{2,}|\t/)[0])
    .filter(Boolean)
  return { stored, detail: stored.join(' / ').slice(0, 90) }
}
/** Credentials this machine already holds for the engine, described without leaking secrets. */
export async function discoverCredentials(
  engine: Engine,
  executable: string | null,
  directory: string,
): Promise<CredentialOption[]> {
  const settingsEnv = claudeSettingsEnv(),
    environment = process.env as Record<string, string | undefined>
  if (engine === 'ClaudeCode') {
    const settings = claudeSettings(),
      status = await claudeStatus(executable, directory),
      helper = typeof settings?.apiKeyHelper === 'string' ? settings.apiKeyHelper.trim() : ''
    return [
      {
        id: 'auto',
        label: '自动 · 跟随 claude 自己的配置',
        detail: tokenOf(settingsEnv)
          ? `settings.json：${describe(settingsEnv)}`
          : 'settings.json 未配置令牌，将使用系统环境变量',
        available: true,
        restricted: true,
      },
      {
        id: 'settings',
        label: '~/.claude/settings.json 的 env',
        detail: describe(settingsEnv),
        available: !!tokenOf(settingsEnv),
        restricted: true,
      },
      {
        id: 'environment',
        label: '系统环境变量 ANTHROPIC_*',
        detail: describe(environment),
        available: !!tokenOf(environment),
        restricted: true,
      },
      {
        id: 'cli',
        label: 'claude 自身登录（订阅 / apiKeyHelper）',
        detail: helper
          ? `apiKeyHelper：${helper.slice(0, 80)}`
          : status.loggedIn
            ? `已登录${status.method ? ` · ${status.method}` : ''}${status.subscription ? ' · 订阅登录' : ''}`
            : '未检测到 claude 订阅登录',
        available: status.loggedIn || !!helper,
        restricted: false,
        subscription: status.subscription,
      },
    ]
  }
  if (engine === 'Codex') {
    const status = await codexStatus(executable, directory)
    return [
      {
        id: 'auto',
        label: '自动 · codex 登录与系统环境变量',
        detail: tokenOf(environment)
          ? describe(environment)
          : status.loggedIn
            ? `codex 已登录${status.detail ? ` · ${status.detail}` : ''}`
            : '未检测到 codex 登录，也未配置 OPENAI_API_KEY',
        available: true,
        restricted: true,
      },
      {
        id: 'environment',
        label: '系统环境变量 OPENAI_*',
        detail: describe(environment),
        available: !!tokenOf(environment),
        restricted: true,
      },
      {
        id: 'cli',
        label: 'codex 自身登录（订阅 / auth.json）',
        detail: status.loggedIn ? `已登录${status.detail ? ` · ${status.detail}` : ''}` : '未登录',
        available: status.loggedIn,
        restricted: true,
        subscription: status.loggedIn,
      },
    ]
  }
  const auth = await openCodeAuth(executable)
  return [
    {
      id: 'auto',
      label: '自动 · opencode 自己的供应商与登录',
      detail: auth.stored.length
        ? `已保存：${auth.detail}`
        : tokenOf(environment)
          ? describe(environment)
          : '未检测到 opencode 凭证',
      available: true,
      restricted: true,
    },
    {
      id: 'environment',
      label: '系统环境变量（ANTHROPIC_* / OPENAI_*）',
      detail: describe(environment),
      available: !!tokenOf(environment),
      restricted: true,
    },
    {
      id: 'cli',
      label: 'opencode 自身登录（opencode auth）',
      detail: auth.stored.length ? `已保存：${auth.detail}` : '未检测到 opencode 登录',
      available: auth.stored.length > 0,
      restricted: true,
      subscription: auth.stored.length > 0,
    },
  ]
}
/**
 * Environment handed to the CLI, plus whether the run may keep the `--restricted` sandbox.
 * Subscription logins and apiKeyHelper only resolve when the CLI reads its own config, and
 * `--restricted` forbids exactly that, so those sources run without the sandbox.
 */
export function resolveCredentials(
  engine: Engine,
  auth: EngineAuth,
): { env: Record<string, string>; restricted: boolean } {
  if (auth.mode === 'custom') {
    const key = auth.api.apiKey.trim(),
      baseUrl = auth.api.baseUrl.trim().replace(/\/+$/, '')
    if (engine === 'ClaudeCode') {
      const bearer = auth.api.header !== 'api-key',
        env: Record<string, string> = {}
      if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl
      // The unused variable is cleared so an inherited OS value cannot outrank the saved key.
      if (key) {
        env.ANTHROPIC_AUTH_TOKEN = bearer ? key : ''
        env.ANTHROPIC_API_KEY = bearer ? '' : key
      }
      return { env, restricted: true }
    }
    if (engine === 'Codex') {
      if (!key) return { env: {}, restricted: true }
      return {
        env: { OPENAI_API_KEY: key, ...(baseUrl ? { OPENAI_BASE_URL: baseUrl } : {}) },
        restricted: true,
      }
    }
    // OpenCode reads its provider from its own config file, which FlowChat writes on save.
    return { env: {}, restricted: true }
  }
  if (engine === 'ClaudeCode') {
    switch (auth.source) {
      case 'settings':
        return { env: claudeSettingsEnv(), restricted: true }
      case 'environment':
        return { env: {}, restricted: true }
      case 'cli':
        return { env: {}, restricted: false }
      default:
        return { env: claudeSettingsEnv(), restricted: true }
    }
  }
  return { env: {}, restricted: true }
}
export const credentialProblem = (engine: Engine, auth: EngineAuth) => {
  if (auth.mode !== 'custom') return ''
  const { baseUrl, apiKey, model } = auth.api
  if (!apiKey.trim()) return '请填写 API Key。'
  if (baseUrl.trim() && !/^https?:\/\//i.test(baseUrl.trim()))
    return '接口地址需要以 http:// 或 https:// 开头。'
  if (engine === 'OpenCode' && auth.mode === 'custom') {
    if (!baseUrl.trim()) return 'OpenCode 需要填写接口地址。'
    if (!model.trim()) return 'OpenCode 需要填写模型 ID。'
  }
  return ''
}
