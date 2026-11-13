import { randomUUID, createHash } from 'node:crypto'
import type { Branch, Conversation, Settings, Turn } from '../shared/types'
import { modelStamp } from '../shared/types'

export const id = () => randomUUID().replaceAll('-', '')
export const defaults = (): Settings => ({
  version: 2,
  theme: 'System',
  memoryEnabled: true,
  memory: '请用中文回答。解释新概念时先给直观理解，再介绍定义；根据我的追问逐步深入。',
  defaultEngine: 'Codex',
  maximized: false,
  windowWidth: 1440,
  windowHeight: 960,
  sidebarWidth: 264,
})
export function createConversation(engine = defaults().defaultEngine): Conversation {
  const branch: Branch = {
    id: id(),
    title: '新对话',
    quote: '',
    inheritedTurns: [],
    turns: [],
    draft: '',
    engine,
  }
  return {
    version: 2,
    id: id(),
    title: '新对话',
    updatedAt: new Date().toISOString(),
    activeBranchId: branch.id,
    branches: [branch],
  }
}
export function active(chat: Conversation) {
  return chat.branches.find((b) => b.id === chat.activeBranchId) ?? chat.branches[0]
}
export function fork(chat: Conversation, turnId: string, quote: string): Branch {
  const parent = active(chat),
    index = parent.turns.findIndex((t) => t.id === turnId && t.status === 'Complete')
  if (index < 0) throw new Error('只能从已完成的回答创建分支。')
  const branch: Branch = {
    id: id(),
    title: '新追问',
    parentId: parent.id,
    sourceTurnId: turnId,
    quote,
    inheritedTurns: structuredClone(
      [...parent.inheritedTurns, ...parent.turns.slice(0, index + 1)].filter(
        (t) => t.status === 'Complete',
      ),
    ),
    turns: [],
    draft: '',
    engine: parent.engine,
  }
  chat.branches.push(branch)
  chat.activeBranchId = branch.id
  return branch
}
export function memoryStamp(settings: Settings) {
  return createHash('sha256')
    .update(settings.memoryEnabled ? settings.memory : '')
    .digest('hex')
    .toUpperCase()
}
export function promptFor(branch: Branch, turn: Turn, settings: Settings) {
  const resume =
    branch.sessionEngine === branch.engine &&
    branch.sessionMemoryStamp === memoryStamp(settings) &&
    branch.sessionModelStamp === modelStamp(settings, branch.engine)
      ? branch.sessionId
      : null
  const history = resume
    ? ''
    : [
        ...branch.inheritedTurns,
        ...branch.turns.slice(
          0,
          branch.turns.findIndex((t) => t.id === turn.id),
        ),
      ]
        .filter((t) => t.status === 'Complete')
        .map((t) => `用户：${t.question}\n助手：${t.answer}\n`)
        .join('\n')
  return {
    sessionId: resume,
    prompt: `${history}${!resume && branch.quote ? `\n针对这段内容追问：${branch.quote}\n\n` : ''}${turn.question}\n\n请直接回答问题，不操作本机。${settings.memoryEnabled && settings.memory.trim() ? '\n' + settings.memory.trim() : ''}`,
  }
}
