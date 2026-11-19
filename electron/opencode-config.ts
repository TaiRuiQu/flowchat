import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { CredentialAPI } from '../shared/types'

export const openCodeConfigPath = () =>
  path.join(
    process.env.OPENCODE_CONFIG_DIR?.trim() || path.join(homedir(), '.config', 'opencode'),
    'opencode.json',
  )
const provider = 'flowchat'
function read(): Record<string, any> {
  const file = openCodeConfigPath()
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    return parsed
  } catch {
    throw new Error(`无法解析 ${file}，请先修复该文件再保存 OpenCode 凭证。`)
  }
}
function write(value: Record<string, any>) {
  const file = openCodeConfigPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
  return file
}
/** FlowChat keeps its API-only provider in OpenCode's own config, never in the user's project. */
export function writeOpenCodeProvider(api: CredentialAPI) {
  const config = read(),
    baseUrl = api.baseUrl.trim().replace(/\/+$/, ''),
    model = api.model.trim()
  return write({
    ...config,
    providers: {
      ...(config.providers ?? {}),
      [provider]: {
        name: 'FlowChat API',
        package:
          api.protocol === 'anthropic'
            ? '@opencode/ai/providers/anthropic-compatible'
            : '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: baseUrl, apiKey: api.apiKey.trim() },
        models: { [model]: { name: model } },
      },
    },
  })
}
export function clearOpenCodeProvider() {
  const config = read()
  if (!config.providers || !(provider in config.providers)) return openCodeConfigPath()
  const providers = { ...config.providers }
  delete providers[provider]
  return write({ ...config, providers })
}
export const hasOpenCodeProvider = () => {
  try {
    return !!read().providers?.[provider]
  } catch {
    return false
  }
}
