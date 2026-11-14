import { promises as fs } from 'node:fs'
import path from 'node:path'
import { id } from './domain'
import type { MemoryFile } from '../shared/types'

export async function resolveWorkspace(directory: string) {
  if (!path.isAbsolute(directory)) throw new Error('请选择本地目录的完整路径。')
  const real = await fs.realpath(directory)
  if (!(await fs.stat(real)).isDirectory()) throw new Error('工作路径必须是文件夹。')
  return real
}

async function memoryPath(directory: string, name = 'memory.md', createParents = false) {
  const parts = name.replaceAll('\\', '/').split('/')
  if (
    !/\.md$/i.test(name) ||
    parts.some((part) => !part || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part))
  )
    throw new Error('记忆文档必须是 memory 目录内的 Markdown 文件。')
  let parent = directory
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part)
    try {
      if (createParents) await fs.mkdir(parent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    try {
      const stat = await fs.lstat(parent)
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('记忆目录必须是普通文件夹。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const file = path.join(directory, ...parts)
  try {
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('记忆文档必须是普通文件。')
    if (stat.size > 1_000_000) throw new Error('记忆文档超过 1 MB，请先精简记忆。')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return file
}

export async function readMemory(directory: string, name = 'memory.md') {
  const file = await memoryPath(directory, name)
  try {
    return { path: file, text: await fs.readFile(file, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { path: file, text: '' }
  }
}

export async function listMemoryFiles(directory: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = []
  const scan = async (relative = '') => {
    const entries = await fs
      .readdir(path.join(directory, relative), { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await scan(name)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const stat = await fs
          .lstat(path.join(directory, name))
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
        if (stat?.isFile() && !stat.isSymbolicLink())
          files.push({ name, size: stat.size, modifiedAt: stat.mtimeMs })
      }
    }
  }
  await scan()
  return files.sort((a, b) =>
    a.name === b.name
      ? 0
      : a.name === 'memory.md'
        ? -1
        : b.name === 'memory.md'
          ? 1
          : a.name.localeCompare(b.name),
  )
}

export async function createMemory(directory: string, name: string) {
  const file = await memoryPath(directory, name, true)
  try {
    await fs.writeFile(file, `# ${path.basename(name, path.extname(name))}\n\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('同名记忆文档已存在。')
    throw error
  }
}

export async function ensureMemory(directory: string, seed = '') {
  const file = await memoryPath(directory)
  try {
    await fs.writeFile(file, seed, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function initializeGlobalMemory(
  directory: string,
  legacyDirectories: () => Promise<string[]>,
) {
  await fs.mkdir(directory, { recursive: true })
  const file = await memoryPath(directory)
  try {
    await fs.lstat(file)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const imported = new Map<string, string>()
  if ((await listMemoryFiles(directory)).length) {
    await ensureMemory(directory)
    return
  }
  const sources = new Set<string>()
  for (const legacy of await legacyDirectories()) {
    const key = process.platform === 'win32' ? legacy.toLowerCase() : legacy
    if (sources.has(key)) continue
    sources.add(key)
    const { text } = await readMemory(legacy)
    if (text.trim() && !imported.has(text.trim())) imported.set(text.trim(), legacy)
  }
  const seed =
    imported.size > 1
      ? '# 全局记忆\n\n' +
        [...imported].map(([text, source]) => `## 从 ${source} 导入\n\n${text}`).join('\n\n')
      : ([...imported.keys()][0] ?? '')
  if (Buffer.byteLength(seed, 'utf8') > 1_000_000)
    throw new Error('合并后的旧记忆超过 1 MB，请先精简原记忆文件。原文件均已保留。')
  await ensureMemory(directory, seed)
}

export async function writeMemory(directory: string, text: string, name = 'memory.md') {
  if (Buffer.byteLength(text, 'utf8') > 1_000_000)
    throw new Error('记忆文档超过 1 MB，请先精简记忆。')
  const file = await memoryPath(directory, name, true),
    temp = `${file}.${id()}.tmp`
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
