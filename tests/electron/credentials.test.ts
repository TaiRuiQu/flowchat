import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  claudeSettingsEnv,
  credentialProblem,
  discoverCredentials,
  mask,
  resolveCredentials,
} from '../../electron/credentials'
import type { EngineAuth } from '../../shared/types'
import { defaults } from '../../electron/domain'

let root: string,
  previousConfig: string | undefined,
  previousToken: string | undefined,
  previousKey: string | undefined
beforeEach(async () => {
  await fs.mkdir(path.resolve('.artifacts'), { recursive: true })
  root = await fs.mkdtemp(path.resolve('.artifacts/credentials-'))
  previousConfig = process.env.CLAUDE_CONFIG_DIR
  previousToken = process.env.ANTHROPIC_AUTH_TOKEN
  previousKey = process.env.ANTHROPIC_API_KEY
  process.env.CLAUDE_CONFIG_DIR = root
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(async () => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restore('CLAUDE_CONFIG_DIR', previousConfig)
  restore('ANTHROPIC_AUTH_TOKEN', previousToken)
  restore('ANTHROPIC_API_KEY', previousKey)
  await fs.rm(root, { recursive: true, force: true })
})
const writeSettings = (value: unknown) =>
  fs.writeFile(path.join(root, 'settings.json'), JSON.stringify(value))
const auth = (value: Partial<EngineAuth> = {}): EngineAuth => ({
  ...defaults().credentials.ClaudeCode,
  ...value,
})

describe('engine credentials', () => {
  it('masks long tokens without hiding their identity', () => {
    expect(mask('sk-ant-1234567890abcdef')).toBe('sk-a••••cdef')
    expect(mask('short')).toBe('••••')
  })
  it('reads the claude settings env and forwards it for the auto and settings sources', async () => {
    await writeSettings({
      env: { ANTHROPIC_AUTH_TOKEN: 'relay-token', ANTHROPIC_BASE_URL: 'https://relay.invalid' },
    })
    expect(claudeSettingsEnv()).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'relay-token',
      ANTHROPIC_BASE_URL: 'https://relay.invalid',
    })
    expect(resolveCredentials('ClaudeCode', auth({ source: 'auto' }))).toEqual({
      env: { ANTHROPIC_AUTH_TOKEN: 'relay-token', ANTHROPIC_BASE_URL: 'https://relay.invalid' },
      restricted: true,
    })
    expect(resolveCredentials('ClaudeCode', auth({ source: 'settings' })).restricted).toBe(true)
    expect(resolveCredentials('ClaudeCode', auth({ source: 'environment' }))).toEqual({
      env: {},
      restricted: true,
    })
    // Subscription logins and apiKeyHelper only resolve when the CLI reads its own config.
    expect(resolveCredentials('ClaudeCode', auth({ source: 'cli' }))).toEqual({
      env: {},
      restricted: false,
    })
  })
  it('turns a saved API key into the matching auth variable', () => {
    const bearer = resolveCredentials(
      'ClaudeCode',
      auth({
        mode: 'custom',
        api: { ...auth().api, baseUrl: 'https://relay.invalid/', apiKey: 'sk-abc' },
      }),
    )
    expect(bearer).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://relay.invalid',
        ANTHROPIC_AUTH_TOKEN: 'sk-abc',
        ANTHROPIC_API_KEY: '',
      },
      restricted: true,
    })
    const official = resolveCredentials(
      'ClaudeCode',
      auth({
        mode: 'custom',
        api: { ...auth().api, baseUrl: '', apiKey: 'sk-ant', header: 'api-key' },
      }),
    )
    expect(official.env).toEqual({ ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_API_KEY: 'sk-ant' })
    expect(resolveCredentials('ClaudeCode', auth({ mode: 'custom' })).env).toEqual({})
  })
  it('hands codex the openai variables and leaves opencode to its own config', () => {
    const codex = resolveCredentials(
      'Codex',
      auth({
        mode: 'custom',
        api: { ...auth().api, baseUrl: 'https://relay.invalid/v1/', apiKey: 'sk-x' },
      }),
    )
    expect(codex).toEqual({
      env: { OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'https://relay.invalid/v1' },
      restricted: true,
    })
    expect(resolveCredentials('Codex', auth({ source: 'cli' }))).toEqual({
      env: {},
      restricted: true,
    })
    expect(
      resolveCredentials(
        'OpenCode',
        auth({ mode: 'custom', api: { ...auth().api, baseUrl: 'https://x.invalid', apiKey: 'k' } }),
      ),
    ).toEqual({ env: {}, restricted: true })
  })
  it('validates the custom API form per engine and lists machine credentials', async () => {
    expect(credentialProblem('ClaudeCode', auth({ mode: 'custom' }))).toContain('API Key')
    expect(
      credentialProblem(
        'ClaudeCode',
        auth({ mode: 'custom', api: { ...auth().api, baseUrl: 'relay.invalid', apiKey: 'k' } }),
      ),
    ).toContain('http')
    expect(
      credentialProblem('OpenCode', auth({ mode: 'custom', api: { ...auth().api, apiKey: 'k' } })),
    ).toContain('接口地址')
    expect(
      credentialProblem(
        'OpenCode',
        auth({ mode: 'custom', api: { ...auth().api, apiKey: 'k', baseUrl: 'https://x.invalid' } }),
      ),
    ).toContain('模型')
    expect(credentialProblem('Codex', auth({ mode: 'system' }))).toBe('')

    await writeSettings({ env: { ANTHROPIC_AUTH_TOKEN: 'relay-token' } })
    const options = await discoverCredentials('ClaudeCode', null, root)
    expect(options.map((option) => option.id)).toEqual(['auto', 'settings', 'environment', 'cli'])
    expect(options[0].available).toBe(true)
    expect(options[1]).toMatchObject({ available: true, restricted: true })
    expect(options[1].detail).toContain('••••')
    expect(options[2].available).toBe(false)
    expect(options[3]).toMatchObject({ available: false, restricted: false })

    const codex = await discoverCredentials('Codex', null, root)
    expect(codex.map((option) => option.id)).toEqual(['auto', 'environment', 'cli'])
    expect(codex[2].available).toBe(false)
    const opencode = await discoverCredentials('OpenCode', null, root)
    expect(opencode.map((option) => option.id)).toEqual(['auto', 'environment', 'cli'])
    expect(opencode[0].available).toBe(true)
  })
})
