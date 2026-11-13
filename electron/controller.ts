import path from 'node:path'
import { z } from 'zod'
import { active, createConversation, defaults, fork, id, memoryStamp, promptFor } from './domain'
import { Store } from './store'
import { catalog, checkTool, locate, runHarness, safeError, toolsFor } from './harness'
import type {
  Catalog,
  Command,
  Engine,
  Note,
  Settings,
  Snapshot,
  StreamUpdate,
  Turn,
} from '../shared/types'
import { modelFor, modelStamp } from '../shared/types'
import { availableModels, modelSelection, reasoningFor } from '../shared/models'

const guid = z.string().regex(/^[a-f0-9]{32}$/)
const engine = z.enum(['Codex', 'ClaudeCode', 'OpenCode'])
const text = z.string().max(1_000_000)
const settingsPatch = z
  .object({
    theme: z.enum(['System', 'Light', 'Dark']).optional(),
    memoryEnabled: z.boolean().optional(),
    memory: text.optional(),
    defaultEngine: engine.optional(),
    sidebarWidth: z.number().int().min(244).max(420).optional(),
    codexModelId: z.string().max(512).nullable().optional(),
    claudeModelId: z.string().max(512).nullable().optional(),
    claudePath: z.string().max(4096).nullable().optional(),
    codexPath: z.string().max(4096).nullable().optional(),
    openCodePath: z.string().max(4096).nullable().optional(),
    openCodeProviderId: z.string().max(512).nullable().optional(),
    openCodeModelId: z.string().max(512).nullable().optional(),
    reasoningEfforts: z.record(z.string().max(2048), z.string().min(1).max(512)).optional(),
  })
  .strict()
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['bootstrap', 'new', 'cancel']) }),
  z.object({ type: z.literal('catalog'), engine }),
  z.object({ type: z.enum(['load', 'delete', 'branch', 'deleteNote']), id: guid }),
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('draft'), conversationId: guid, branchId: guid, text }),
  z.object({
    type: z.literal('send'),
    text: text.trim().min(1),
    engine,
    fork: z.object({ turnId: guid, quote: text }).optional(),
  }),
  z.object({ type: z.literal('retry'), turnId: guid }),
  z.object({ type: z.enum(['engine', 'check']), engine }),
  z.object({ type: z.literal('settings'), settings: settingsPatch }),
  z.object({
    type: z.literal('saveNote'),
    note: z
      .object({
        id: guid.optional(),
        title: z.string().trim().min(1).max(200),
        text,
        conversationId: guid.nullable().optional(),
        branchId: guid.nullable().optional(),
        turnId: guid.nullable().optional(),
      })
      .strict(),
  }),
])
export class Controller {
  settings = defaults()
  notes: Note[] = []
  chat = createConversation()
  private abort?: AbortController
  private generating?: Promise<void>
  private commands = Promise.resolve()
  private initialized = false
  private catalogs: Partial<Record<Engine, Catalog>> = {}
  constructor(
    readonly store: Store,
    private emit: (type: 'state' | 'stream', value: Snapshot | StreamUpdate) => void,
  ) {}
  get busy() {
    return !!this.abort
  }
  async snapshot(): Promise<Snapshot> {
    return structuredClone({
      settings: this.settings,
      entries: await this.store.list(),
      notes: this.notes,
      conversation: this.chat,
      tools: toolsFor(this.settings),
      busy: this.busy,
      dataDirectory: this.store.root,
    })
  }
  execute(raw: Command): Promise<Snapshot | Catalog | { message: string }> {
    const op = this.commands.then(() => this.dispatch(schema.parse(raw) as Command))
    this.commands = op.then(
      () => {},
      () => {},
    )
    return op
  }
  private idle() {
    if (this.busy) throw new Error('请先停止生成，再执行此操作。')
  }
  private async prepareModel(engine: Engine, refresh = false) {
    const executable = locate(engine, this.settings)
    if (!executable) throw new Error('未找到所选工具，请在设置中指定路径。')
    const result =
      (!refresh && this.catalogs[engine]) ||
      (await catalog(engine, executable, path.join(this.store.root, 'harness')))
    this.catalogs[engine] = result
    const selection = modelSelection(this.settings, engine, result)
    if (
      Object.entries(selection).some(
        ([key, value]) => this.settings[key as keyof Settings] !== value,
      )
    ) {
      Object.assign(this.settings, selection)
      await this.store.write('settings.json', this.settings)
    }
    return result
  }
  private async save(touch = true) {
    if (touch) this.chat.updatedAt = new Date().toISOString()
    this.settings.lastConversationId = this.chat.id
    await this.store.save(this.chat)
    await this.store.write('settings.json', this.settings)
  }
  private async dispatch(command: Command): Promise<Snapshot | Catalog | { message: string }> {
    if (!this.initialized) {
      await this.store.init()
      this.settings = {
        ...defaults(),
        ...(await this.store.read<Partial<Settings>>('settings.json', {})),
      }
      this.notes = await this.store.read<Note[]>('notes.json', [])
      const entries = await this.store.list(),
        lastId = this.settings.lastConversationId ?? entries[0]?.id
      this.chat =
        (lastId ? await this.store.load(lastId) : null) ??
        createConversation(this.settings.defaultEngine)
      this.initialized = true
    }
    switch (command.type) {
      case 'bootstrap':
        break
      case 'new':
        this.idle()
        this.chat = createConversation(this.settings.defaultEngine)
        await this.save()
        break
      case 'load': {
        this.idle()
        const chat = await this.store.load(command.id)
        if (!chat) throw new Error('未找到这段对话。')
        this.chat = chat
        await this.save(false)
        break
      }
      case 'delete':
        this.idle()
        await this.store.delete(command.id)
        if (this.chat.id === command.id) {
          this.chat = createConversation(this.settings.defaultEngine)
          this.settings.lastConversationId = null
          await this.store.write('settings.json', this.settings)
        }
        break
      case 'rename':
        this.idle()
        this.chat.title = command.title
        if (!active(this.chat).parentId) active(this.chat).title = command.title
        await this.save()
        break
      case 'draft': {
        // Delayed draft saves carry explicit identities; never overwrite a newly selected conversation.
        if (command.conversationId === this.chat.id) {
          const branch = this.chat.branches.find((b) => b.id === command.branchId)
          if (branch) {
            branch.draft = command.text
            await this.save(false)
          }
        } else {
          const chat = await this.store.load(command.conversationId),
            branch = chat?.branches.find((b) => b.id === command.branchId)
          if (chat && branch) {
            branch.draft = command.text
            await this.store.save(chat)
          }
        }
        break
      }
      case 'branch':
        this.idle()
        if (!this.chat.branches.some((b) => b.id === command.id)) throw new Error('未找到分支。')
        this.chat.activeBranchId = command.id
        await this.save(false)
        break
      case 'engine':
        this.idle()
        active(this.chat).engine = command.engine
        this.settings.defaultEngine = command.engine
        await this.save(false)
        break
      case 'settings':
        if (Object.keys(command.settings).some((key) => key !== 'sidebarWidth')) this.idle()
        Object.assign(this.settings, {
          ...command.settings,
          reasoningEfforts: {
            ...this.settings.reasoningEfforts,
            ...command.settings.reasoningEfforts,
          },
        })
        if (command.settings.codexPath !== undefined) delete this.catalogs.Codex
        if (command.settings.claudePath !== undefined) delete this.catalogs.ClaudeCode
        if (command.settings.openCodePath !== undefined) delete this.catalogs.OpenCode
        for (const [engine, result] of Object.entries(this.catalogs))
          Object.assign(this.settings, modelSelection(this.settings, engine as Engine, result))
        await this.store.write('settings.json', this.settings)
        break
      case 'saveNote': {
        const existing = command.note.id
          ? this.notes.find((n) => n.id === command.note.id)
          : undefined
        const note: Note = {
          ...existing,
          ...command.note,
          id: existing?.id ?? id(),
          updatedAt: new Date().toISOString(),
        }
        this.notes = [note, ...this.notes.filter((n) => n.id !== note.id)]
        await this.store.write('notes.json', this.notes)
        break
      }
      case 'deleteNote':
        this.notes = this.notes.filter((n) => n.id !== command.id)
        await this.store.write('notes.json', this.notes)
        break
      case 'catalog': {
        this.idle()
        const result = await this.prepareModel(command.engine, true)
        this.emit('state', await this.snapshot())
        return result
      }
      case 'check': {
        const executable = locate(command.engine, this.settings)
        if (!executable) throw new Error('未找到工具，请先设置可执行文件路径。')
        return {
          message: await checkTool(
            command.engine,
            executable,
            path.join(this.store.root, 'harness'),
          ),
        }
      }
      case 'send': {
        this.idle()
        if (!locate(command.engine, this.settings))
          throw new Error('未找到所选工具，请先在设置中配置。')
        await this.prepareModel(command.engine)
        if (!modelFor(this.settings, command.engine))
          throw new Error('没有可用模型，请刷新模型目录。')
        const branch = command.fork
          ? fork(this.chat, command.fork.turnId, command.fork.quote)
          : active(this.chat)
        branch.engine = command.engine
        branch.draft = ''
        if (!branch.turns.length) {
          branch.title = command.text.slice(0, 32)
          if (!branch.parentId) this.chat.title = branch.title
        }
        const turn: Turn = {
          id: id(),
          question: command.text,
          answer: '',
          status: 'Generating',
          createdAt: new Date().toISOString(),
        }
        branch.turns.push(turn)
        await this.save()
        this.start(turn)
        break
      }
      case 'retry': {
        this.idle()
        const turn = active(this.chat).turns.at(-1)
        if (!turn || turn.id !== command.turnId || !['Failed', 'Interrupted'].includes(turn.status))
          throw new Error('只能重试最后一条未完成的回答。')
        if (!locate(active(this.chat).engine, this.settings))
          throw new Error('未找到工具，请检查设置。')
        await this.prepareModel(active(this.chat).engine)
        if (!modelFor(this.settings, active(this.chat).engine))
          throw new Error('没有可用模型，请刷新模型目录。')
        active(this.chat).sessionId = null
        turn.answer = ''
        turn.error = null
        turn.status = 'Generating'
        await this.save()
        this.start(turn)
        break
      }
      case 'cancel':
        this.abort?.abort()
        break
    }
    return this.snapshot()
  }
  private start(turn: Turn) {
    const chat = this.chat,
      branch = active(chat),
      settings = structuredClone(this.settings)
    const abort = new AbortController()
    this.abort = abort
    const directory = path.join(this.store.root, 'harness'),
      request = promptFor(branch, turn, settings)
    let lastStream = 0,
      lastCheckpoint = Date.now()
    this.generating = (async () => {
      try {
        const result = await runHarness(
          {
            ...request,
            engine: branch.engine,
            executable: locate(branch.engine, settings)!,
            directory,
            providerId: settings.openCodeProviderId,
            modelId: modelFor(settings, branch.engine),
            reasoningEffort: reasoningFor(
              settings,
              branch.engine,
              availableModels(this.catalogs[branch.engine]!, branch.engine, settings).find(
                (model) => model.id === modelFor(settings, branch.engine),
              ),
            ),
          },
          (update) => {
            if (update.text !== undefined) turn.answer = update.text
            if (update.sessionId) {
              branch.sessionId = update.sessionId
              branch.sessionEngine = branch.engine
              branch.sessionMemoryStamp = memoryStamp(settings)
              branch.sessionModelStamp = modelStamp(settings, branch.engine)
            }
            if (Date.now() - lastStream > 45 || update.status) {
              lastStream = Date.now()
              this.emit('stream', {
                conversationId: chat.id,
                branchId: branch.id,
                turnId: turn.id,
                text: turn.answer,
                status: update.status,
              })
            }
            if (Date.now() - lastCheckpoint > 3000) {
              lastCheckpoint = Date.now()
              void this.store.save(chat).catch((e) =>
                this.emit('stream', {
                  conversationId: chat.id,
                  branchId: branch.id,
                  turnId: turn.id,
                  status: `保存失败：${safeError(e)}`,
                }),
              )
            }
          },
          abort.signal,
        )
        turn.answer = result.text
        turn.status = 'Complete'
        branch.sessionId = result.sessionId
        branch.sessionEngine = branch.engine
        branch.sessionMemoryStamp = memoryStamp(settings)
        branch.sessionModelStamp = modelStamp(settings, branch.engine)
      } catch (e) {
        turn.status = abort.signal.aborted ? 'Interrupted' : 'Failed'
        turn.error = abort.signal.aborted ? '已停止生成，可以重试。' : safeError(e)
        branch.sessionId = null
      } finally {
        this.abort = undefined
        try {
          chat.updatedAt = new Date().toISOString()
          await this.store.save(chat)
        } catch (e) {
          turn.error = `回答尚未保存：${safeError(e)}`
        }
        this.emit('state', await this.snapshot())
      }
    })()
  }
  async shutdown() {
    await this.commands
    this.abort?.abort()
    await this.generating
    if (this.initialized) await this.save(false)
  }
}
