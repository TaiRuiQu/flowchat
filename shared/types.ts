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
  archived?: boolean
  workingDirectory?: string | null
  titleGenerated?: boolean
}
export interface Entry {
  id: string
  title: string
  updatedAt: string
  archived?: boolean
}
export interface Note {
  id: string
  title: string
  text: string
  updatedAt: string
  conversationId?: string | null
  branchId?: string | null
  turnId?: string | null
  quote?: string
}
export interface CompatibleAPI {
  baseUrl: string
  apiKey: string
  model: string
}
export interface TitleSettings {
  enabled: boolean
  source: 'harness' | 'api'
  engine: Engine
  modelId: string
  providerId: string
  api: CompatibleAPI
}
export interface SpeechSettings {
  enabled: boolean
  asr: CompatibleAPI
  tts: CompatibleAPI & { voice: string; speed: number }
}
export interface Settings {
  version: number
  theme: 'System' | 'Light' | 'Dark'
  memoryEnabled: boolean
  instructions: string
  instructionsEnabled: boolean
  defaultEngine: Engine
  codexModelId?: string | null
  claudeModelId?: string | null
  claudePath?: string | null
  codexPath?: string | null
  openCodePath?: string | null
  openCodeProviderId?: string | null
  openCodeModelId?: string | null
  defaultWorkingDirectory?: string | null
  recentWorkingDirectories?: string[]
  reasoningEfforts?: Record<string, string>
  lastConversationId?: string | null
  maximized: boolean
  windowWidth: number
  windowHeight: number
  sidebarWidth?: number
  titleGeneration: TitleSettings
  speech: SpeechSettings
}
export interface ToolInfo {
  engine: Engine
  path: string | null
}
export interface MemoryFile {
  name: string
  size: number
  modifiedAt: number
}
export interface Snapshot {
  settings: Settings
  entries: Entry[]
  notes: Note[]
  conversation: Conversation
  tools: ToolInfo[]
  busy: boolean
  dataDirectory: string
  memory: { name: string; path: string; text: string; files: MemoryFile[] }
  workingDirectory: string
  defaultWorkingDirectory: string
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
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'workspace'; directory: string | null }
  | { type: 'workspaceDefault'; enabled: boolean }
  | { type: 'readMemory'; file?: string }
  | { type: 'writeMemory'; text: string; file?: string }
  | { type: 'createMemory'; file: string }
  | { type: 'assistNote'; text: string; quote: string; instruction: string; engine: Engine }
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
  openWorkingDirectory(): Promise<void>
  pickExecutable(): Promise<string | null>
  pickDirectory(): Promise<string | null>
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>
  synthesize(text: string): Promise<Uint8Array>
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
