import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defaults } from '../../electron/domain'
import { locate, runCodex } from '../../electron/harness'

// 默认跳过：只有显式要求时才调用真实模型和真实 Codex，避免 CI 依赖订阅额度。
// 用法：FLOWCHAT_LIVE_CODEX=1 npm test
const executable = process.env.FLOWCHAT_LIVE_CODEX === '1' ? locate('Codex', defaults()) : null

let root: string
beforeEach(async () => {
  await fs.mkdir(path.resolve('.artifacts'), { recursive: true })
  root = await fs.mkdtemp(path.resolve('.artifacts/live-codex-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const run = (prompt: string, directory: string, memoryDirectory: string) =>
  runCodex(
    {
      engine: 'Codex',
      executable: executable!,
      directory,
      memoryDirectory,
      fileAccess: true,
      reasoningEffort: 'low',
      prompt,
    },
    () => {},
    new AbortController().signal,
  )

describe.skipIf(!executable)('live Codex app-server', () => {
  it('accepts the workspace write sandbox policy and answers', async () => {
    const directory = path.join(root, 'harness'),
      memory = path.join(root, 'memory')
    await fs.mkdir(directory, { recursive: true })
    await fs.mkdir(memory, { recursive: true })
    const result = await run('只回复两个字：收到。不要调用任何工具。', directory, memory)
    expect(result.text.trim()).toBe('收到')
    expect(result.sessionId).not.toBe('')
  }, 180_000)

  it('writes a file inside the workspace through tools', async () => {
    const directory = path.join(root, 'harness'),
      memory = path.join(root, 'memory')
    await fs.mkdir(directory, { recursive: true })
    await fs.mkdir(memory, { recursive: true })
    await run('在工作目录创建 live-ok.txt，内容只有一行 pong。完成后回复 done。', directory, memory)
    expect((await fs.readFile(path.join(directory, 'live-ok.txt'), 'utf8')).trim()).toBe('pong')
  }, 240_000)
})
