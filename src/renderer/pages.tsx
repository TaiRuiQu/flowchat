import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  FolderOpen,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './components/ui/button'
import { Dialog, IconButton, Menu, Select, Switch } from './components/ui/primitives'
import { Markdown } from './components/markdown'
import { NoteEditor } from './components/note-editor'
import { MarkdownEditor } from './components/markdown-editor'
import { IntegrationSettings } from './components/integration-settings'
import { CredentialDialog, credentialSummary } from './components/credential-settings'
import { HarnessIcon } from './components/harness-icon'
import type { Command, Engine, Note, Snapshot } from '../../shared/types'
import { engineNames } from '../../shared/types'

export type RunCommand = (command: Command) => Promise<any>
export function NotesPage({
  state,
  run,
  onSource,
}: {
  state: Snapshot
  run: RunCommand
  onSource: (note: Note) => void
}) {
  const [editing, setEditing] = useState<Partial<Note> | null>(null),
    [deleting, setDeleting] = useState<Note | null>(null)
  return (
    <div className="utility-page">
      <div className="page-title-row">
        <div>
          <h1>我的笔记</h1>
          <p className="page-subtitle">从回答中选一段文字，记下自己的理解，与模型一起完善。</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ title: '', text: '' })}>
          <Plus />
          新建笔记
        </Button>
      </div>
      <div className="section-caption">
        <span>全部笔记</span>
        <span>{state.notes.length} 篇</span>
      </div>
      {!state.notes.length ? (
        <div className="utility-empty">
          <BookOpen />
          <h2>给灵感一个落脚点</h2>
          <p>在对话中选中文字，点击「记笔记」，即可保留原文并写下想法。</p>
          <Button variant="outline" onClick={() => setEditing({ title: '', text: '' })}>
            <Plus />
            写下第一篇笔记
          </Button>
        </div>
      ) : (
        <div className="note-grid">
          {state.notes.map((note) => (
            <article className="note-card" key={note.id}>
              <div className="note-card-top">
                <span>
                  {new Date(note.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <Menu
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={`${note.title}的操作`}>
                      <MoreHorizontal />
                    </Button>
                  }
                  items={[
                    { label: '编辑笔记', icon: <Pencil />, action: () => setEditing(note) },
                    {
                      label: '删除笔记',
                      icon: <Trash2 />,
                      danger: true,
                      action: () => setDeleting(note),
                    },
                  ]}
                />
              </div>
              <button className="note-body" onClick={() => setEditing(note)}>
                <h2>{note.title}</h2>
                <div className="note-preview">
                  <Markdown>{note.text}</Markdown>
                </div>
              </button>
              <div className="note-card-bottom">
                {note.conversationId ? (
                  <button onClick={() => onSource(note)}>
                    回到原对话
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <span>手写笔记</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <NoteEditor note={editing} state={state} run={run} onClose={() => setEditing(null)} />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除这篇笔记？"
        description="删除后无法撤销，原始对话会保留。"
      >
        <div className="dialog-footer">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (deleting && (await run({ type: 'deleteNote', id: deleting.id })))
                setDeleting(null)
            }}
          >
            删除笔记
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
export function MemoryPage({ state, run }: { state: Snapshot; run: RunCommand }) {
  const [instructions, setInstructions] = useState(state.settings.instructions)
  const [memory, setMemory] = useState(state.memory.text),
    [saving, setSaving] = useState(false)
  const [newMemory, setNewMemory] = useState(false),
    [newFile, setNewFile] = useState('')
  const saveMemoryDraft = async () =>
    memory === state.memory.text ||
    !!(await run({ type: 'writeMemory', text: memory, file: state.memory.name }))
  useEffect(() => setInstructions(state.settings.instructions), [state.settings.instructions])
  useEffect(() => setMemory(state.memory.text), [state.memory.text, state.memory.path])
  return (
    <div className="utility-page narrow">
      <h1>指令与记忆</h1>
      <p className="page-subtitle">用户指令由你设定；模型记忆由模型维护，分别保存、独立启用。</p>
      <section className="settings-section">
        <div className="setting-row toggle-row">
          <div>
            <h2>用户指令 · Instruction</h2>
            <p>告诉模型如何回答。这些设置只有你可以修改，不属于模型记忆。</p>
          </div>
          <Switch
            label="启用用户指令"
            checked={state.settings.instructionsEnabled}
            disabled={state.busy}
            onCheckedChange={(value) =>
              void run({ type: 'settings', settings: { instructionsEnabled: value } })
            }
          />
        </div>
        <label className="field-label" htmlFor="instructions">
          我的长期指令
        </label>
        <MarkdownEditor
          id="instructions"
          label="我的长期指令"
          className="memory-editor"
          disabled={state.busy}
          value={instructions}
          onChange={setInstructions}
        />
        <div className="memory-footer">
          <span>由你编辑 · 模型只读</span>
          <Button
            disabled={state.busy || instructions === state.settings.instructions}
            onClick={async () => {
              if (await run({ type: 'settings', settings: { instructions } }))
                toast.success('用户指令已更新')
            }}
          >
            <Check />
            保存指令
          </Button>
        </div>
      </section>
      <section className="settings-section">
        <div className="setting-row toggle-row">
          <div>
            <h2>模型记忆 · memory/</h2>
            <p>
              所有对话共享分类记忆。memory.md 保存简短索引，模型按需读取相关文档，也可以主动整理。
            </p>
          </div>
          <Switch
            label="启用模型记忆"
            checked={state.settings.memoryEnabled}
            disabled={state.busy}
            onCheckedChange={(value) =>
              void run({ type: 'settings', settings: { memoryEnabled: value } })
            }
          />
        </div>
        <div className="memory-documents-toolbar">
          <Select
            label="选择记忆文档"
            value={state.memory.name}
            options={state.memory.files.map((file) => ({
              value: file.name,
              label: file.name === 'memory.md' ? 'memory.md · 索引' : file.name,
            }))}
            disabled={state.busy || saving}
            onValueChange={async (file) => {
              setSaving(true)
              try {
                if (await saveMemoryDraft()) await run({ type: 'readMemory', file })
              } finally {
                setSaving(false)
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={state.busy || saving}
            onClick={() => {
              setNewFile('')
              setNewMemory(true)
            }}
          >
            <Plus />
            新建文档
          </Button>
        </div>
        <p className="data-path memory-file-path">文件位置：{state.memory.path}</p>
        <label className="field-label" htmlFor="memory">
          {state.memory.name === 'memory.md' ? '全局记忆索引' : '分类记忆文档'}
        </label>
        <MarkdownEditor
          id="memory"
          label={state.memory.name === 'memory.md' ? '全局记忆索引' : '分类记忆文档'}
          className="memory-editor"
          disabled={state.busy}
          value={memory}
          onChange={setMemory}
          placeholder="告诉模型「请记住……」，它会直接更新这份文档。"
        />
        <div className="memory-footer">
          <span>
            {state.memory.files.length} 份文档 · 当前 {memory.length} 字
          </span>
          <div className="inline-actions">
            <Button
              variant="ghost"
              disabled={state.busy || saving}
              onClick={() => void run({ type: 'readMemory' })}
            >
              <RefreshCw />
              刷新记忆
            </Button>
            <Button
              disabled={state.busy || saving || memory === state.memory.text}
              onClick={async () => {
                setSaving(true)
                try {
                  if (await run({ type: 'writeMemory', text: memory, file: state.memory.name }))
                    toast.success('模型记忆已保存')
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? <Loader2 className="spin" /> : <Check />}保存记忆
            </Button>
          </div>
        </div>
      </section>
      <Dialog
        open={newMemory}
        onOpenChange={setNewMemory}
        title="新建记忆文档"
        description="按主题保存长期信息，也可以使用子目录，例如 projects/flowchat.md。"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const name = newFile.trim()
            if (!name) return
            setSaving(true)
            try {
              if (
                (await saveMemoryDraft()) &&
                (await run({
                  type: 'createMemory',
                  file: /\.md$/i.test(name) ? name : `${name}.md`,
                }))
              )
                setNewMemory(false)
            } finally {
              setSaving(false)
            }
          }}
        >
          <label className="field-label" htmlFor="memory-file-name">
            文档名称
          </label>
          <input
            id="memory-file-name"
            className="field"
            value={newFile}
            onChange={(event) => setNewFile(event.target.value)}
            placeholder="例如 preferences.md"
            disabled={saving}
            maxLength={1024}
            autoFocus
          />
          <div className="dialog-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNewMemory(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving || !newFile.trim()}>
              {saving ? <Loader2 className="spin" /> : <Plus />}创建文档
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
function ToolSettings({
  engine,
  state,
  run,
}: {
  engine: Engine
  state: Snapshot
  run: RunCommand
}) {
  const tool = state.tools.find((t) => t.engine === engine)!,
    key = engine === 'Codex' ? 'codexPath' : engine === 'ClaudeCode' ? 'claudePath' : 'openCodePath'
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(state.settings[key] ?? ''),
    [checking, setChecking] = useState(false),
    [result, setResult] = useState(''),
    [credentialOpen, setCredentialOpen] = useState(false)
  const credential = state.settings.credentials[engine]
  return (
    <div className="tool-setting">
      <div className="tool-heading">
        <div className="tool-mark">
          <HarnessIcon engine={engine} />
        </div>
        <div>
          <h3>{engineNames[engine]}</h3>
          <span className="tool-status">
            {result ? '已检查 · 详情见下方' : tool.path ? '已检测到 · 尚未检查登录' : '未检测到'}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={checking || state.busy || !tool.path}
          onClick={async () => {
            setChecking(true)
            try {
              const response = await run({ type: 'check', engine })
              if (response?.message) setResult(response.message)
            } finally {
              setChecking(false)
            }
          }}
        >
          {checking ? <Loader2 className="spin" /> : <RefreshCw />}检查状态
        </Button>
      </div>
      <div className="tool-path">{tool.path ?? '安装后自动识别，或手动指定可执行文件。'}</div>
      {result && (
        <div className="tool-result" role="status">
          {result}
        </div>
      )}
      {editing ? (
        <div className="path-editor">
          <label className="sr-only" htmlFor={`path-${engine}`}>
            {engineNames[engine]}路径
          </label>
          <div className="path-input">
            <input
              id={`path-${engine}`}
              className="field"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="可执行文件的完整路径"
            />
            <IconButton
              label="浏览文件"
              onClick={async () => {
                const path = await window.flowchat.pickExecutable()
                if (path) setValue(path)
              }}
            >
              <FolderOpen />
            </IconButton>
          </div>
          <div className="inline-actions">
            <Button
              size="sm"
              disabled={state.busy}
              onClick={async () => {
                const response = await run({
                  type: 'settings',
                  settings: { [key]: value.trim() || null },
                })
                if (response) {
                  setEditing(false)
                  setResult('')
                }
              }}
            >
              保存路径
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="tool-links">
          <button
            disabled={state.busy}
            onClick={() => {
              setValue(state.settings[key] ?? '')
              setEditing(true)
            }}
          >
            更改路径
            <ChevronRight size={12} />
          </button>
          <button
            disabled={state.busy}
            aria-haspopup="dialog"
            onClick={() => setCredentialOpen(true)}
          >
            登录凭证
            <KeyRound size={12} />
          </button>
          <span className="tool-credential">{credentialSummary(credential)}</span>
        </div>
      )}
      <CredentialDialog
        engine={engine}
        open={credentialOpen}
        onOpenChange={setCredentialOpen}
        state={state}
        run={run}
      />
    </div>
  )
}
export function SettingsPage({ state, run }: { state: Snapshot; run: RunCommand }) {
  const theme = state.settings.theme
  return (
    <div className="utility-page narrow">
      <h1>设置</h1>
      <p className="page-subtitle">管理外观、对话工具、标题与语音服务。</p>
      <section className="settings-section">
        <h2>外观</h2>
        <div className="theme-picker" role="group" aria-label="主题">
          {(
            [
              { value: 'Light', label: '浅色', Icon: Sun },
              { value: 'Dark', label: '深色', Icon: Moon },
              { value: 'System', label: '跟随系统', Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              className={theme === value ? 'selected' : ''}
              aria-pressed={theme === value}
              disabled={state.busy}
              onClick={() => void run({ type: 'settings', settings: { theme: value } })}
            >
              <div className={`theme-preview ${value.toLowerCase()}`}>
                <div className="preview-rail" />
                <div className="preview-content">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <span>
                <Icon size={14} />
                {label}
                {theme === value && <Check size={13} />}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <h2>对话工具</h2>
          <span>选择本机已安装的工具与登录方式</span>
        </div>
        {(['Codex', 'ClaudeCode', 'OpenCode'] as Engine[]).map((engine) => (
          <ToolSettings key={engine} engine={engine} state={state} run={run} />
        ))}
      </section>
      <IntegrationSettings state={state} run={run} />
      <section className="settings-section">
        <h2>本地数据</h2>
        <div className="setting-row">
          <div>
            <h3>你的数据，留在本机</h3>
            <p className="data-path">{state.dataDirectory}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void window.flowchat.openDataDirectory()}
          >
            <FolderOpen />
            打开文件夹
          </Button>
        </div>
      </section>
      <footer className="settings-about">
        <span>FlowChat</span>
        <span>
          {state.version ? state.version + ' · 用好奇心连接每一次思考' : '用好奇心连接每一次思考'}
        </span>
      </footer>
    </div>
  )
}
