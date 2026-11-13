import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Conversation, Entry } from '../shared/types'
import { id } from './domain'

export class Store {
  private queue = Promise.resolve()
  constructor(readonly root: string) {}
  async init() {
    await fs.mkdir(path.join(this.root, 'conversations'), { recursive: true })
    await fs.mkdir(path.join(this.root, 'harness'), { recursive: true })
  }
  private file(name: string) {
    if (!/^(?:settings|notes|index)\.json$|^conversations\/[a-f0-9]{32}\.json$/.test(name))
      throw new Error('无效的数据路径。')
    return path.join(this.root, name)
  }
  async read<T>(name: string, fallback: T): Promise<T> {
    await this.queue
    return this.readUnlocked(name, fallback)
  }
  private async readUnlocked<T>(name: string, fallback: T): Promise<T> {
    let failure: unknown
    for (const file of [this.file(name), this.file(name) + '.bak']) {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8')) as T
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') failure = e
      }
    }
    if (failure) throw new Error(`无法读取 ${name}，原文件已保留。`)
    return fallback
  }
  private async writeFile(name: string, value: unknown) {
    const file = this.file(name),
      temp = `${file}.${id()}.tmp`
    try {
      const handle = await fs.open(temp, 'wx')
      try {
        await handle.writeFile(JSON.stringify(value, null, 2), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await fs.copyFile(file, file + '.bak')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      await fs.rename(temp, file)
    } finally {
      await fs.rm(temp, { force: true })
    }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(work)
    this.queue = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
  write(name: string, value: unknown) {
    const snapshot = structuredClone(value)
    return this.enqueue(() => this.writeFile(name, snapshot))
  }
  async list(): Promise<Entry[]> {
    await this.queue
    return this.listUnlocked()
  }
  private async listUnlocked(): Promise<Entry[]> {
    const index = await this.readUnlocked<Entry[] | null>('index.json', null)
    if (index) return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const entries: Entry[] = []
    for (const name of await fs.readdir(path.join(this.root, 'conversations'))) {
      if (!/^[a-f0-9]{32}\.json$/.test(name)) continue
      const chat = await this.readUnlocked<Conversation | null>(`conversations/${name}`, null)
      if (chat?.branches?.length)
        entries.push({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt })
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async load(chatId: string) {
    const chat = await this.read<Conversation | null>(`conversations/${chatId}.json`, null)
    if (!chat) return null
    if (chat.version !== 2 || !chat.branches?.length) throw new Error('无法读取此版本的对话。')
    for (const branch of chat.branches)
      for (const turn of branch.turns)
        if (turn.status === 'Generating') {
          turn.status = 'Interrupted'
          turn.error = '上次生成已中断，可以重试。'
          branch.sessionId = null
        }
    return chat
  }
  async save(chat: Conversation) {
    // Enqueue the entire conversation/index transaction so simultaneous draft/checkpoint writes cannot lose entries.
    const snapshot = structuredClone(chat)
    return this.enqueue(async () => {
      await this.writeFile(`conversations/${snapshot.id}.json`, snapshot)
      const entries = await this.listUnlocked()
      await this.writeFile('index.json', [
        { id: snapshot.id, title: snapshot.title, updatedAt: snapshot.updatedAt },
        ...entries.filter((e) => e.id !== snapshot.id),
      ])
    })
  }
  async delete(chatId: string) {
    await this.enqueue(async () => {
      const entries = await this.listUnlocked()
      const file = this.file(`conversations/${chatId}.json`)
      await fs.rm(file, { force: true })
      await fs.rm(file + '.bak', { force: true })
      await this.writeFile(
        'index.json',
        entries.filter((e) => e.id !== chatId),
      )
    })
  }
}
