export type Engine = 'Codex' | 'ClaudeCode' | 'OpenCode'
export type Status = 'Generating' | 'Complete' | 'Failed' | 'Interrupted'
export interface Turn {
  id: string
  question: string
  answer: string
  status: Status
  error?: string | null
  createdAt: string
}
export interface Branch {
  id: string
  title: string
  parentId?: string | null
  sourceTurnId?: string | null
  quote: string
  inheritedTurns: Turn[]
  turns: Turn[]
  draft: string
  engine: Engine
  sessionId?: string | null
  sessionEngine?: Engine | null
  sessionMemoryStamp?: string | null
  sessionModelStamp?: string | null
}
export interface Conversation {
  version: number
  id: string
  title: string
  updatedAt: string
  activeBranchId: string
  branches: Branch[]
}
export interface Entry {
  id: string
  title: string
  updatedAt: string
}
export interface Note {
  id: string
  title: string
  text: string
  updatedAt: string
  conversationId?: string | null
  branchId?: string | null
  turnId?: string | null
}
export interface Settings {
  version: number
  theme: 'System' | 'Light' | 'Dark'
  memoryEnabled: boolean
  memory: string
  defaultEngine: Engine
  codexModelId?: string | null
  claudeModelId?: string | null
  claudePath?: string | null
  codexPath?: string | null
  openCodePath?: string | null
  openCodeProviderId?: string | null
  openCodeModelId?: string | null
  reasoningEfforts?: Record<string, string>
  lastConversationId?: string | null
  maximized: boolean
  windowWidth: number
  windowHeight: number
  sidebarWidth?: number
}
export interface ToolInfo {
  engine: Engine
  path: string | null
}
export interface Snapshot {
  settings: Settings
  entries: Entry[]
  notes: Note[]
  conversation: Conversation
  tools: ToolInfo[]
  busy: boolean
  dataDirectory: string
}
export interface CatalogModel {
  id: string
  providerId: string
  name: string
  enabled: boolean
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
}
export interface Catalog {
  providers: { id: string; name: string; enabled: boolean }[]
  models: CatalogModel[]
}
export interface StreamUpdate {
  conversationId: string
  branchId: string
  turnId: string
  text?: string
  status?: string
}
export type Command =
  | { type: 'bootstrap' | 'new' | 'cancel' }
  | { type: 'catalog'; engine: Engine }
  | { type: 'load' | 'delete'; id: string }
  | { type: 'rename'; title: string }
  | { type: 'draft'; conversationId: string; branchId: string; text: string }
  | { type: 'branch'; id: string }
  | { type: 'send'; text: string; engine: Engine; fork?: { turnId: string; quote: string } }
  | { type: 'retry'; turnId: string }
  | { type: 'engine'; engine: Engine }
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'saveNote'; note: Partial<Note> & { title: string; text: string } }
  | { type: 'deleteNote'; id: string }
  | { type: 'check'; engine: Engine }
export interface DesktopAPI {
  command(command: Command): Promise<Snapshot | Catalog | { message: string }>
  onState(callback: (snapshot: Snapshot) => void): () => void
  onStream(callback: (update: StreamUpdate) => void): () => void
  onPrepareClose(callback: () => Promise<void>): () => void
  window(action: 'minimize' | 'maximize' | 'close'): void
  exportMarkdown(text: string, title: string): Promise<boolean>
  openDataDirectory(): Promise<void>
  pickExecutable(): Promise<string | null>
  login(engine: Engine): Promise<void>
}
export const engineNames: Record<Engine, string> = {
  Codex: 'Codex',
  ClaudeCode: 'Claude Code',
  OpenCode: 'OpenCode',
}
export const modelSettingKeys = {
  Codex: 'codexModelId',
  ClaudeCode: 'claudeModelId',
  OpenCode: 'openCodeModelId',
} as const
export const modelFor = (settings: Settings, engine: Engine) =>
  settings[modelSettingKeys[engine]] ?? null
export const modelStamp = (settings: Settings, engine: Engine) =>
  engine === 'OpenCode'
    ? `${settings.openCodeProviderId ?? ''}/${settings.openCodeModelId ?? ''}`
    : modelFor(settings, engine)
