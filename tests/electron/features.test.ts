import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Controller } from '../../electron/controller'
import { Store } from '../../electron/store'
import {
  active,
  createConversation,
  defaults,
  id,
  memoryStamp,
  promptFor,
} from '../../electron/domain'
import { complete, endpoint, synthesize, transcribe } from '../../electron/compatible-api'
import { ensureMemory, readMemory, writeMemory } from '../../electron/workspace'
import type { Settings, Snapshot, Turn } from '../../shared/types'

let root: string
beforeEach(async () => {
  await fs.mkdir(path.resolve('.artifacts'), { recursive: true })
  root = await fs.mkdtemp(path.resolve('.artifacts/features-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
const question = (): Turn => ({
  id: id(),
  question: '当前问题',
  answer: '',
  status: 'Generating',
  createdAt: new Date().toISOString(),
})

async function mockAPI(handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    handler(req, res, Buffer.concat(chunks))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

describe('instructions and model memory', () => {
  it('separates their prompts, switches and session invalidation', () => {
    const settings = defaults(),
      branch = active(createConversation()),
      turn = question()
    settings.instructions = '用户要求：用中文回答'
    const memory = '模型记忆：用户在学习物理'
    branch.turns.push(turn)
    const prompt = promptFor(branch, turn, settings, memory).prompt
    expect(prompt).toContain('<user_instructions>\n用户要求：用中文回答\n</user_instructions>')
    expect(prompt).toContain('<memory>\n模型记忆：用户在学习物理\n</memory>')
    const stamp = memoryStamp(settings, memory)
    settings.instructionsEnabled = false
    expect(memoryStamp(settings, memory)).not.toBe(stamp)
    expect(promptFor(branch, turn, settings, memory).prompt).not.toContain(settings.instructions)
    expect(promptFor(branch, turn, settings, memory).prompt).toContain(memory)
    settings.instructionsEnabled = true
    settings.memoryEnabled = false
    expect(promptFor(branch, turn, settings, memory).prompt).toContain(settings.instructions)
    expect(promptFor(branch, turn, settings, memory).prompt).not.toContain(memory)
  })
  it('migrates old learning preferences to user instructions without seeding model memory', async () => {
    const store = new Store(root)
    await store.init()
    await store.write('settings.json', { memory: '旧版学习偏好', memoryEnabled: false })
    const controller = new Controller(store, () => {})
    const state = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    expect(state.settings.instructions).toBe('旧版学习偏好')
    expect(state.settings).not.toHaveProperty('memory')
    expect(state.settings.instructionsEnabled).toBe(false)
    expect(state.memory.text).toBe('')
    await controller.execute({ type: 'writeMemory', text: '# 模型记忆\n用户在学数学' })
    const updated = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    expect(updated.settings.instructions).toBe('旧版学习偏好')
    expect(updated.memory.text).toContain('用户在学数学')
    await controller.shutdown()
  })
  it('shares one global memory across workspaces, new conversations and restarts', async () => {
    const directory = path.join(root, 'project')
    const data = path.join(root, 'data')
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, 'memory.md'), '# 项目自己的文件')
    const controller = new Controller(new Store(data), () => {})
    const initial = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    expect(initial.memory.path).toBe(path.join(data, 'memory', 'memory.md'))
    await controller.execute({ type: 'writeMemory', text: '# 全局记忆' })
    await expect(controller.execute({ type: 'workspace', directory: 'relative' })).rejects.toThrow(
      '完整路径',
    )
    let state = (await controller.execute({ type: 'workspace', directory })) as Snapshot
    expect(state.workingDirectory).toBe(await fs.realpath(directory))
    expect(state.memory.path).toBe(initial.memory.path)
    expect(state.memory.text).toBe('# 全局记忆')
    await fs.writeFile(initial.memory.path, '# 模型刚刚更新')
    state = (await controller.execute({ type: 'readMemory' })) as Snapshot
    expect(state.memory.text).toBe('# 模型刚刚更新')
    const invalidDirectory = path.join(root, 'invalid-project')
    await fs.mkdir(path.join(invalidDirectory, 'memory.md'), { recursive: true })
    state = (await controller.execute({
      type: 'workspace',
      directory: invalidDirectory,
    })) as Snapshot
    expect(state.memory.path).toBe(initial.memory.path)
    expect(state.memory.text).toBe('# 模型刚刚更新')
    await controller.execute({ type: 'writeMemory', text: '# 切换目录后更新的全局记忆' })
    state = (await controller.execute({ type: 'new' })) as Snapshot
    expect(state.memory.text).toBe('# 切换目录后更新的全局记忆')
    expect((await readMemory(directory)).text).toBe('# 项目自己的文件')
    await controller.shutdown()
    const restarted = new Controller(new Store(data), () => {})
    state = (await restarted.execute({ type: 'bootstrap' })) as Snapshot
    expect(state.memory.path).toBe(initial.memory.path)
    expect(state.memory.text).toBe('# 切换目录后更新的全局记忆')
    await restarted.shutdown()
  })
  it('merges and deduplicates legacy workspace memories once, preserving originals and later edits', async () => {
    const store = new Store(path.join(root, 'data'))
    await store.init()
    const legacyDefault = path.join(store.root, 'harness')
    await ensureMemory(legacyDefault, '# 旧默认记忆')
    for (const name of ['project-a', 'project-b']) {
      const directory = path.join(root, name)
      await fs.mkdir(directory)
      await ensureMemory(directory, '# 旧项目记忆')
      await store.save(createConversation('Codex', directory))
    }
    const controller = new Controller(store, () => {})
    const state = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    expect(state.memory.path).toBe(path.join(store.root, 'memory', 'memory.md'))
    expect(state.memory.text).toContain('# 旧默认记忆')
    expect(state.memory.text.match(/# 旧项目记忆/g)).toHaveLength(1)
    expect((await readMemory(legacyDefault)).text).toBe('# 旧默认记忆')
    expect((await readMemory(path.join(root, 'project-a'))).text).toBe('# 旧项目记忆')
    await controller.execute({ type: 'writeMemory', text: '' })
    await controller.shutdown()
    const restarted = new Controller(store, () => {})
    expect(((await restarted.execute({ type: 'bootstrap' })) as Snapshot).memory.text).toBe('')
    await restarted.shutdown()
  })
  it('preserves an existing memory file and refuses directories masquerading as memory', async () => {
    await ensureMemory(root, 'existing')
    await ensureMemory(root, 'replacement')
    expect((await readMemory(root)).text).toBe('existing')
    await writeMemory(root, 'changed')
    expect((await readMemory(root)).text).toBe('changed')
    await fs.rm(path.join(root, 'memory.md'))
    await fs.mkdir(path.join(root, 'memory.md'))
    await expect(writeMemory(root, 'outside')).rejects.toThrow('普通文件')
  })
  it('manages categorized Markdown documents without including their bodies in the index prompt', async () => {
    const controller = new Controller(new Store(path.join(root, 'data')), () => {})
    await controller.execute({ type: 'bootstrap' })
    const index = '# 记忆索引\n\n- [偏好](preferences.md)\n- [项目](projects/flowchat.md)'
    await controller.execute({ type: 'writeMemory', file: 'memory.md', text: index })
    await controller.execute({ type: 'createMemory', file: 'preferences.md' })
    await controller.execute({
      type: 'writeMemory',
      file: 'preferences.md',
      text: '只按需读取的偏好正文',
    })
    await controller.execute({ type: 'createMemory', file: 'projects/flowchat.md' })
    await controller.execute({ type: 'writeMemory', text: '只按需读取的项目正文' })
    let state = (await controller.execute({ type: 'readMemory', file: 'memory.md' })) as Snapshot
    expect(state.memory.files.map((file) => file.name)).toEqual([
      'memory.md',
      'preferences.md',
      'projects/flowchat.md',
    ])
    expect(state.memory.text).toBe(index)
    const prompt = promptFor(
      active(state.conversation),
      question(),
      state.settings,
      index,
      state.memory.path,
      state.memory.files,
    ).prompt
    expect(prompt).toContain('projects/flowchat.md')
    expect(prompt).not.toContain('只按需读取的')
    const oldStamp = memoryStamp(state.settings, index, state.memory.files)
    await controller.execute({
      type: 'writeMemory',
      file: 'projects/flowchat.md',
      text: '修改过的项目正文，索引保持不变',
    })
    state = (await controller.execute({ type: 'readMemory', file: 'memory.md' })) as Snapshot
    expect(memoryStamp(state.settings, index, state.memory.files)).not.toBe(oldStamp)
    for (const file of [
      '../outside.md',
      '/outside.md',
      'C:\\outside.md',
      'notes.txt',
      'projects/../../outside.md',
    ]) {
      await expect(
        controller.execute({ type: 'writeMemory', file, text: 'invalid' }),
      ).rejects.toThrow('Markdown')
    }
    await expect(
      controller.execute({ type: 'createMemory', file: 'preferences.md' }),
    ).rejects.toThrow('已存在')
    expect((await readMemory(controller.memoryDirectory, 'preferences.md')).text).toBe(
      '只按需读取的偏好正文',
    )
    const longPrompt = promptFor(
      active(state.conversation),
      question(),
      state.settings,
      'a'.repeat(20000) + '未自动加载的索引尾部',
      state.memory.path,
      state.memory.files,
    ).prompt
    expect(longPrompt).not.toContain('未自动加载的索引尾部')
    await controller.shutdown()
    await fs.rm(state.memory.path)
    const restarted = new Controller(new Store(path.join(root, 'data')), () => {})
    state = (await restarted.execute({ type: 'bootstrap' })) as Snapshot
    expect(state.memory.text).toBe('')
    expect(state.memory.files.map((file) => file.name)).toContain('projects/flowchat.md')
    await restarted.shutdown()
  })
  it('remembers recent workspaces and applies the default only to new conversations across restarts', async () => {
    const store = new Store(path.join(root, 'data'))
    const controller = new Controller(store, () => {})
    const original = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    const directories = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const directory = path.join(root, `project-${index}`)
        await fs.mkdir(directory)
        return fs.realpath(directory)
      }),
    )
    for (const directory of directories) await controller.execute({ type: 'workspace', directory })
    await controller.execute({ type: 'workspace', directory: directories[4] })
    let state = (await controller.execute({ type: 'workspaceDefault', enabled: true })) as Snapshot
    expect(state.settings.recentWorkingDirectories).toEqual([
      directories[4],
      directories[7],
      directories[6],
      directories[5],
      directories[3],
      directories[2],
    ])
    expect(state.defaultWorkingDirectory).toBe(directories[4])
    const previousId = state.conversation.id
    state = (await controller.execute({ type: 'new' })) as Snapshot
    expect(state.workingDirectory).toBe(directories[4])
    await controller.execute({ type: 'workspace', directory: directories[1] })
    state = (await controller.execute({ type: 'workspaceDefault', enabled: true })) as Snapshot
    expect(state.defaultWorkingDirectory).toBe(directories[1])
    state = (await controller.execute({ type: 'load', id: previousId })) as Snapshot
    expect(state.workingDirectory).toBe(directories[4])
    await controller.shutdown()
    const restarted = new Controller(store, () => {})
    state = (await restarted.execute({ type: 'new' })) as Snapshot
    expect(state.workingDirectory).toBe(directories[1])
    expect(state.settings.recentWorkingDirectories?.[0]).toBe(directories[1])
    await restarted.execute({ type: 'workspaceDefault', enabled: false })
    state = (await restarted.execute({ type: 'new' })) as Snapshot
    expect(state.workingDirectory).toBe(original.defaultWorkingDirectory)
    await restarted.shutdown()
  })
})

describe('archive persistence', () => {
  it('archives all branches, survives index rebuild and restart, and restores the original conversation', async () => {
    const store = new Store(root),
      controller = new Controller(store, () => {})
    const first = (await controller.execute({ type: 'new' })) as Snapshot
    const renamed = (await controller.execute({ type: 'rename', title: '待归档对话' })) as Snapshot
    const state = (await controller.execute({
      type: 'archive',
      id: first.conversation.id,
      archived: true,
    })) as Snapshot
    expect(state.conversation.id).not.toBe(first.conversation.id)
    expect(state.entries.find((entry) => entry.id === first.conversation.id)?.archived).toBe(true)
    await controller.shutdown()
    await fs.rm(path.join(root, 'index.json'))
    await fs.rm(path.join(root, 'index.json.bak'), { force: true })
    expect((await store.list()).find((entry) => entry.id === first.conversation.id)?.archived).toBe(
      true,
    )
    const restarted = new Controller(new Store(root), () => {})
    const boot = (await restarted.execute({ type: 'bootstrap' })) as Snapshot
    expect(boot.conversation.id).not.toBe(first.conversation.id)
    const restored = (await restarted.execute({
      type: 'archive',
      id: first.conversation.id,
      archived: false,
    })) as Snapshot
    expect(restored.entries.find((entry) => entry.id === first.conversation.id)?.archived).toBe(
      false,
    )
    const loaded = (await restarted.execute({
      type: 'load',
      id: first.conversation.id,
    })) as Snapshot
    expect(loaded.conversation.title).toBe('待归档对话')
    expect(loaded.conversation.branches).toEqual(renamed.conversation.branches)
    await restarted.shutdown()
  })
})

describe('compatible API contracts', () => {
  it('normalizes endpoint paths and rejects embedded credentials', () => {
    expect(endpoint('http://localhost:123/v1/', 'chat/completions')).toBe(
      'http://localhost:123/v1/chat/completions',
    )
    expect(endpoint('https://example.com/custom/v1/chat/completions', 'audio/speech')).toBe(
      'https://example.com/custom/v1/audio/speech',
    )
    expect(() => endpoint('file:///etc/passwd', 'audio/speech')).toThrow('HTTP')
    expect(() => endpoint('https://secret@example.com/v1', 'audio/speech')).toThrow('API Key')
  })
  it('sends chat completions, multipart ASR, and TTS with independently configured models', async () => {
    const requests: { url?: string; auth?: string; type?: string; body: Buffer }[] = []
    const api = await mockAPI((req, res, body) => {
      requests.push({
        url: req.url,
        auth: req.headers.authorization,
        type: req.headers['content-type'],
        body,
      })
      if (req.url === '/v1/chat/completions') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: '理解概率' } }] }))
      } else if (req.url === '/v1/audio/transcriptions')
        res.end(JSON.stringify({ text: '这是语音输入' }))
      else {
        res.setHeader('Content-Type', 'audio/mpeg')
        res.end(Buffer.from([0xff, 0xfb, 0x01]))
      }
    })
    try {
      const config = { baseUrl: api.url, apiKey: 'test-only-key', model: 'title-model' }
      expect(await complete(config, '生成标题')).toBe('理解概率')
      const speech = defaults().speech
      speech.enabled = true
      speech.asr = { ...config, apiKey: '', model: 'asr-model' }
      speech.tts = { ...config, model: 'tts-model', voice: 'voice-name', speed: 1.25 }
      expect(await transcribe(speech, new Uint8Array([1, 2, 3]), 'audio/webm;codecs=opus')).toBe(
        '这是语音输入',
      )
      expect(await synthesize(speech, '你好')).toEqual(new Uint8Array([0xff, 0xfb, 0x01]))
      expect(JSON.parse(requests[0].body.toString())).toEqual({
        model: 'title-model',
        stream: false,
        messages: [{ role: 'user', content: '生成标题' }],
      })
      expect(requests[0].auth).toBe('Bearer test-only-key')
      expect(requests[1].auth).toBeUndefined()
      expect(requests[1].type).toContain('multipart/form-data; boundary=')
      expect(requests[1].body.toString()).toContain('filename="recording.webm"')
      expect(requests[1].body.toString()).toContain('asr-model')
      expect(JSON.parse(requests[2].body.toString())).toMatchObject({
        model: 'tts-model',
        input: '你好',
        voice: 'voice-name',
        speed: 1.25,
        response_format: 'mp3',
      })
      speech.enabled = false
      await expect(synthesize(speech, '不要发送')).rejects.toThrow('启用')
      await expect(transcribe(speech, new Uint8Array([1]), 'audio/webm')).rejects.toThrow('启用')
      expect(requests).toHaveLength(3)
    } finally {
      await api.close()
    }
  })
  it('does not echo provider error bodies or continue aborted requests', async () => {
    const api = await mockAPI((_req, res) => {
      res.statusCode = 401
      res.end('private-provider-secret')
    })
    try {
      const config = { baseUrl: api.url, model: 'test', apiKey: '' }
      await expect(complete(config, 'test')).rejects.toThrow('HTTP 401')
      await expect(complete(config, 'test')).rejects.not.toThrow('private-provider-secret')
      const abort = new AbortController()
      abort.abort()
      await expect(complete(config, 'test', abort.signal)).rejects.toThrow()
    } finally {
      await api.close()
    }
  })
  it('encodes credentials on disk and decrypts them on read', async () => {
    const store = new Store(root, {
      encrypt: (value) => Buffer.from(value).toString('base64'),
      decrypt: (value) => Buffer.from(value, 'base64').toString(),
    })
    await store.init()
    const settings = defaults()
    settings.titleGeneration.api.apiKey = 'private-test-title'
    settings.speech.asr.apiKey = 'private-test-asr'
    settings.speech.tts.apiKey = 'private-test-tts'
    await store.write('settings.json', settings)
    const disk = await fs.readFile(path.join(root, 'settings.json'), 'utf8')
    expect(disk).not.toContain('private-test-')
    expect(disk).toContain('encrypted:')
    expect((await store.read<Settings>('settings.json', defaults())).speech.tts.apiKey).toBe(
      'private-test-tts',
    )
  })
})

describe('agent workflow', () => {
  it('uses workspace write tools and memory on disk, isolates note and title requests, and persists generated titles', async () => {
    const store = new Store(root)
    await store.init()
    await fs.writeFile(
      path.join(root, 'harness/app-server'),
      `
      import readline from 'node:readline'; import fs from 'node:fs';
      const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
      readline.createInterface({input:process.stdin}).on('line', line => {
        const m=JSON.parse(line); if(!m.id) return;
        fs.appendFileSync('protocol.jsonl', JSON.stringify(m)+'\\n');
        const result=m.method==='model/list'?{data:[{model:'test-model'}]}:m.method.startsWith('thread/')?{thread:{id:'test-session'}}:{};
        emit({id:m.id,result}); if(m.method!=='turn/start')return;
        if(m.params.input[0].text.includes('hang-note')) return;
        const writable=m.params.sandboxPolicy.type==='workspaceWrite';
        if(writable){fs.writeFileSync(${JSON.stringify(path.join(root, 'memory', 'memory.md'))},'# 记忆索引\\n\\n- [学习偏好](preferences.md)'); fs.writeFileSync(${JSON.stringify(path.join(root, 'memory', 'preferences.md'))}, '# 模型记忆\\n用户喜欢物理'); fs.writeFileSync('created.txt','agent wrote this');}
        const text = writable?'已记录并创建文件':m.params.input[0].text.includes('共同编辑')?'# 协作笔记\\n我的观点加例子':'物理学习笔记';
        emit({method:'item/agentMessage/delta',params:{threadId:'test-session',itemId:'a',delta:text}});
        setTimeout(()=>emit({method:'turn/completed',params:{threadId:'test-session',turn:{status:'completed'}}}),30);
      });
    `,
    )
    const controller = new Controller(store, () => {})
    await controller.execute({ type: 'bootstrap' })
    await controller.execute({
      type: 'writeMemory',
      file: 'memory.md',
      text: '# 记忆索引\n\n- [学习偏好](preferences.md)',
    })
    await controller.execute({
      type: 'writeMemory',
      file: 'preferences.md',
      text: '不应该被自动加载的分类记忆正文',
    })
    const config = defaults().titleGeneration
    config.enabled = true
    config.modelId = 'title-only'
    await controller.execute({
      type: 'settings',
      settings: {
        codexPath: process.execPath,
        titleGeneration: config,
        instructions: '用户固定指令',
      },
    })
    await controller.execute({ type: 'send', text: '请记住我喜欢物理并创建文件', engine: 'Codex' })
    await expect(controller.execute({ type: 'workspace', directory: root })).rejects.toThrow(
      '停止生成',
    )
    await waitIdle(controller)
    const final = (await controller.execute({ type: 'bootstrap' })) as Snapshot
    expect(active(final.conversation).turns[0].status).toBe('Complete')
    expect(final.memory.text).toContain('用户喜欢物理')
    expect(final.settings.instructions).toBe('用户固定指令')
    expect(final.conversation.title).toBe('物理学习笔记')
    expect(await fs.readFile(path.join(root, 'harness/created.txt'), 'utf8')).toBe(
      'agent wrote this',
    )
    await expect(controller.execute({ type: 'workspace', directory: root })).rejects.toThrow(
      '开始前',
    )
    const suggestion = (await controller.execute({
      type: 'assistNote',
      text: '我的观点',
      quote: '物理原文',
      instruction: '补充例子',
      engine: 'Codex',
    })) as { message: string }
    expect(suggestion.message).toContain('协作笔记')
    expect(controller.notes).toHaveLength(0)
    await controller.execute({
      type: 'saveNote',
      note: { title: '我的笔记', text: suggestion.message, quote: '物理原文' },
    })
    expect(controller.notes[0].quote).toBe('物理原文')
    const requests = (await fs.readFile(path.join(root, 'harness/protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const turns = requests.filter((request) => request.method === 'turn/start')
    expect(turns[0].params.sandboxPolicy).toMatchObject({
      type: 'workspaceWrite',
      writableRoots: [path.join(root, 'harness'), path.join(root, 'memory')],
    })
    expect(turns[0].params.input[0].text).toContain(
      JSON.stringify(path.join(root, 'memory', 'memory.md')),
    )
    expect(turns[0].params.input[0].text).not.toContain('不应该被自动加载的分类记忆正文')
    expect(turns[0].params.sandboxPolicy.writableRoots).not.toContain(root)
    await expect(fs.stat(path.join(root, 'harness', 'memory.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(turns[0].params.input[0].text).toContain('<user_instructions>\n用户固定指令')
    expect(turns[1].params.sandboxPolicy.type).toBe('readOnly')
    expect(turns[2].params.sandboxPolicy.type).toBe('readOnly')
    expect(
      requests
        .filter((request) => request.method === 'thread/start')
        .map((request) => request.params.model),
    ).toEqual(['test-model', 'title-only', 'test-model'])
    await controller.execute({ type: 'send', text: '继续学习', engine: 'Codex' })
    await waitIdle(controller)
    const updatedRequests = (await fs.readFile(path.join(root, 'harness/protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const followup = updatedRequests.filter((request) => request.method === 'turn/start').at(-1)
    expect(followup.params.input[0].text).toContain(
      '<memory>\n# 记忆索引\n\n- [学习偏好](preferences.md)\n</memory>',
    )
    const noteOperation = controller
      .execute({
        type: 'assistNote',
        text: '我的笔记',
        quote: '',
        instruction: 'hang-note',
        engine: 'Codex',
      })
      .then(
        (result) =>
          'message' in result && result.message === '' ? 'cancelled' : 'unexpected success',
        () => 'cancelled',
      )
    const deadline = Date.now() + 3000
    while (!controller.busy && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.busy).toBe(true)
    await controller.execute({ type: 'cancel' })
    expect(await noteOperation).toBe('cancelled')
    expect(controller.busy).toBe(false)
    await controller.shutdown()
    const restarted = new Controller(new Store(root), () => {})
    expect(((await restarted.execute({ type: 'bootstrap' })) as Snapshot).conversation.title).toBe(
      '物理学习笔记',
    )
    await restarted.shutdown()
  })
  it('preserves completed answers on title API failures and respects manually named conversations', async () => {
    const store = new Store(root)
    await store.init()
    await fs.writeFile(
      path.join(root, 'harness/app-server'),
      `
      import readline from 'node:readline';
      const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const m=JSON.parse(line); if(!m.id)return;
        emit({id:m.id,result:m.method==='model/list'?{data:[{model:'test'}]}:m.method.startsWith('thread/')?{thread:{id:'title-failure-session'}}:{}});
        if(m.method==='turn/start'){
          emit({method:'item/agentMessage/delta',params:{threadId:'title-failure-session',itemId:'a',delta:'完整回答'}});
          setTimeout(()=>emit({method:'turn/completed',params:{threadId:'title-failure-session',turn:{status:'completed'}}}),30);
        }
      });
    `,
    )
    let calls = 0
    const api = await mockAPI((_req, res) => {
      calls++
      res.statusCode = 401
      res.end('private-error')
    })
    const notices: string[] = []
    const controller = new Controller(store, (type, update) => {
      if (type === 'stream' && 'status' in update && update.status) notices.push(update.status)
    })
    try {
      await controller.execute({ type: 'bootstrap' })
      const titleGeneration = {
        ...defaults().titleGeneration,
        enabled: true,
        source: 'api' as const,
        api: { baseUrl: api.url, apiKey: '', model: 'test' },
      }
      await controller.execute({
        type: 'settings',
        settings: { codexPath: process.execPath, titleGeneration },
      })
      await controller.execute({ type: 'send', text: '失败时保留标题', engine: 'Codex' })
      await waitIdle(controller)
      expect(active(controller.chat).turns[0]).toMatchObject({
        answer: '完整回答',
        status: 'Complete',
      })
      expect(controller.chat.title).toBe('失败时保留标题')
      expect(notices.some((notice) => notice.startsWith('标题生成失败：'))).toBe(true)
      expect(calls).toBe(1)
      await controller.execute({ type: 'new' })
      await controller.execute({ type: 'rename', title: '用户手动设置的标题' })
      await controller.execute({ type: 'send', text: '第一条问题', engine: 'Codex' })
      await waitIdle(controller)
      expect(controller.chat.title).toBe('用户手动设置的标题')
      expect(calls).toBe(1)
    } finally {
      await controller.shutdown()
      await api.close()
    }
  })
})

async function waitIdle(controller: Controller) {
  const deadline = Date.now() + 10_000
  while (controller.busy && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25))
  expect(controller.busy).toBe(false)
}
