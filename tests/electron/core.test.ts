import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  active,
  createConversation,
  defaults,
  fork,
  id,
  memoryStamp,
  promptFor,
} from '../../electron/domain'
import { Store } from '../../electron/store'
import { ClaudeParser, safeError } from '../../electron/harness'
import { Controller } from '../../electron/controller'
import type { Snapshot, Turn } from '../../shared/types'
import { modelStamp } from '../../shared/types'

let root: string
beforeEach(async () => {
  await fs.mkdir(path.resolve('.artifacts'), { recursive: true })
  root = await fs.mkdtemp(path.resolve('.artifacts/test-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
function turn(question: string): Turn {
  return {
    id: id(),
    question,
    answer: question + '的回答',
    status: 'Complete',
    createdAt: new Date().toISOString(),
  }
}
describe('branch context', () => {
  it('freezes ancestors up to the source and excludes later turns and siblings', () => {
    const chat = createConversation(),
      parent = active(chat),
      first = turn('起点'),
      later = turn('之后的内容')
    parent.turns.push(first, later)
    const child = fork(chat, first.id, '选中的概念')
    child.turns.push(turn('兄弟分支'))
    chat.activeBranchId = parent.id
    const sibling = fork(chat, first.id, '')
    parent.turns[0].answer = '修改过的父回答'
    expect(sibling.inheritedTurns.map((t) => t.question)).toEqual(['起点'])
    expect(sibling.inheritedTurns[0].answer).toBe('起点的回答')
    const question = turn('新的问题')
    sibling.turns.push(question)
    const request = promptFor(sibling, question, defaults())
    expect(request.prompt).not.toContain('兄弟分支')
    expect(request.prompt).not.toContain('之后的内容')
    expect(request.sessionId).toBeFalsy()
  })
  it('resumes a matching session and rebuilds context after memory or engine changes', () => {
    const chat = createConversation(),
      branch = active(chat),
      settings = defaults(),
      first = turn('之前'),
      next = turn('现在')
    branch.turns.push(first, next)
    branch.sessionId = 'session'
    branch.sessionEngine = 'Codex'
    branch.sessionMemoryStamp = memoryStamp(settings)
    branch.sessionModelStamp = modelStamp(settings, branch.engine)
    expect(promptFor(branch, next, settings).sessionId).toBe('session')
    expect(promptFor(branch, next, settings).prompt).not.toContain('之前')
    settings.codexModelId = 'different-model'
    expect(promptFor(branch, next, settings).sessionId).toBeNull()
    expect(promptFor(branch, next, settings).prompt).toContain('之前')
    settings.codexModelId = null
    expect(promptFor(branch, next, settings).sessionId).toBe('session')
    settings.memoryEnabled = false
    expect(promptFor(branch, next, settings).sessionId).toBeNull()
    expect(promptFor(branch, next, settings).prompt).toContain('之前')
    expect(promptFor(branch, next, settings).prompt).not.toContain(settings.memory)
  })
})
describe('local persistence', () => {
  it('serializes concurrent saves without losing index entries and rejects traversal', async () => {
    const store = new Store(root)
    await store.init()
    const chats = Array.from({ length: 12 }, () => createConversation())
    await Promise.all(chats.map((chat) => store.save(chat)))
    expect(await store.list()).toHaveLength(12)
    await expect(store.load('../settings')).rejects.toThrow('无效的数据路径')
    await Promise.all([store.delete(chats[0].id), store.save(createConversation())])
    expect(await store.list()).toHaveLength(12)
    await fs.rm(path.join(root, 'index.json'))
    await fs.rm(path.join(root, 'index.json.bak'))
    await store.save(createConversation())
    expect(await store.list()).toHaveLength(13)
  })
  it('uses backups on corrupted JSON, and preserves interrupted partial answers on restart', async () => {
    const store = new Store(root)
    await store.init()
    const chat = createConversation()
    active(chat).turns.push({ ...turn('问题'), status: 'Generating', answer: '部分回答' })
    await store.save(chat)
    await store.save(chat)
    await fs.writeFile(path.join(root, 'conversations', chat.id + '.json'), '{broken')
    const recovered = await store.load(chat.id)
    expect(active(recovered!).turns[0].status).toBe('Interrupted')
    expect(active(recovered!).turns[0].answer).toBe('部分回答')
    expect(
      (await fs.readdir(path.join(root, 'conversations'))).some((f) => f.endsWith('.tmp')),
    ).toBe(false)
  })
  it('round-trips a long conversation and rejects legacy schemas', async () => {
    const store = new Store(root)
    await store.init()
    const chat = createConversation()
    active(chat).turns = Array.from({ length: 1500 }, (_, i) => turn('问题' + i))
    await store.save(chat)
    expect(active((await store.load(chat.id))!).turns).toHaveLength(1500)
    chat.version = 1
    await store.save(chat)
    await expect(store.load(chat.id)).rejects.toThrow('版本')
  })
})
describe('CLI streaming', () => {
  it('replaces Claude snapshots without duplicating streamed text and reports failed results', () => {
    const parser = new ClaudeParser()
    parser.accept({
      type: 'stream_event',
      session_id: 's',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } },
    })
    parser.accept({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '你好，世界' }] },
    })
    parser.accept({ type: 'result', subtype: 'success', result: '你好，世界' })
    expect(parser.text).toBe('你好，世界')
    expect(parser.completed).toBe(true)
    expect(parser.sessionId).toBe('s')
    parser.accept({ type: 'result', subtype: 'error', is_error: true, errors: ['认证失效'] })
    expect(parser.error).toBe('认证失效')
    expect(safeError('api_key=abcdefghijk Bearer secret-token sk-abcdefghijklmnop')).not.toContain(
      'abcdefghijk',
    )
  })
  it('runs the Codex JSON-RPC lifecycle through a local mock process', async () => {
    await fs.mkdir(path.join(root, 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'harness/app-server'),
      `
      import readline from 'node:readline';
      const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
      readline.createInterface({ input: process.stdin }).on('line', line => {
        const m = JSON.parse(line); if (!m.id) return;
        const result = m.method === 'model/list' ? { data: [{ model: 'first-model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low' }] } : m.method === 'thread/start' || m.method === 'thread/resume' ? { thread: { id: 'offline-session' } } : {};
        emit({ id: m.id, result });
        if (m.method === 'turn/start') {
          emit({ method: 'item/agentMessage/delta', params: { threadId: 'offline-session', itemId: 'a', delta: '离线流式回答' } });
          setTimeout(() => emit({ method: 'turn/completed', params: { threadId: 'offline-session', turn: { status: 'completed' } } }), 80);
        }
      });
    `,
    )
    let finish!: (state: Snapshot) => void
    const done = new Promise<Snapshot>((resolve) => {
      finish = resolve
    })
    const controller = new Controller(new Store(root), (type, value) => {
      if (type === 'state') finish(value as Snapshot)
    })
    await controller.execute({ type: 'bootstrap' })
    await controller.execute({ type: 'settings', settings: { codexPath: process.execPath } })
    const state = (await controller.execute({
      type: 'send',
      text: '你好',
      engine: 'Codex',
    })) as Snapshot
    expect(state.busy).toBe(true)
    await expect(controller.execute({ type: 'new' })).rejects.toThrow('停止生成')
    const final = await done
    expect(active(final.conversation).turns[0].error).toBeFalsy()
    expect(active(final.conversation).turns[0].answer).toBe('离线流式回答')
    expect(active(final.conversation).turns[0].status).toBe('Complete')
    await controller.shutdown()
  })
})
describe('command boundaries', () => {
  it('keeps delayed drafts tied to their source and validates settings writes', async () => {
    const controller = new Controller(new Store(root), () => {})
    const first = (await controller.execute({ type: 'new' })) as Snapshot
    const second = (await controller.execute({ type: 'new' })) as Snapshot
    await controller.execute({
      type: 'draft',
      conversationId: first.conversation.id,
      branchId: active(first.conversation).id,
      text: '旧会话草稿',
    })
    expect(
      active(((await controller.execute({ type: 'bootstrap' })) as Snapshot).conversation).draft,
    ).toBe('')
    expect(active((await controller.store.load(first.conversation.id))!).draft).toBe('旧会话草稿')
    expect(second.conversation.id).not.toBe(first.conversation.id)
    await expect(
      controller.execute({ type: 'settings', settings: { lastConversationId: '../../private' } }),
    ).rejects.toThrow()
    await controller.shutdown()
  })
})
