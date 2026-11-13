import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  FolderOpen,
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
import { Dialog, IconButton, Menu, Switch } from './components/ui/primitives'
import { Markdown } from './components/markdown'
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
  const [saving, setSaving] = useState(false)
  return (
    <div className="utility-page">
      <div className="page-title-row">
        <div>
          <h1>我的笔记</h1>
          <p className="page-subtitle">收藏回答，记录自己的想法。</p>
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
          <p>收藏一段回答，或从一篇自己的笔记开始。</p>
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
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title={editing?.id ? '编辑笔记' : '新建笔记'}
        description="记录此刻的思考，随时回来继续。"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!editing?.title?.trim()) return
            setSaving(true)
            try {
              const result = await run({
                type: 'saveNote',
                note: { ...editing, title: editing.title, text: editing.text ?? '' },
              })
              if (result) {
                setEditing(null)
                toast.success('笔记已保存')
              }
            } finally {
              setSaving(false)
            }
          }}
        >
          <label className="field-label" htmlFor="note-title">
            标题
          </label>
          <input
            id="note-title"
            className="field"
            autoFocus
            maxLength={200}
            value={editing?.title ?? ''}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
          <label className="field-label" htmlFor="note-text">
            内容 · 支持 Markdown
          </label>
          <textarea
            id="note-text"
            className="field note-editor"
            value={editing?.text ?? ''}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <div className="dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button disabled={saving || !editing?.title?.trim()}>
              {saving && <Loader2 className="spin" />}保存笔记
            </Button>
          </div>
        </form>
      </Dialog>
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
  const [memory, setMemory] = useState(state.settings.memory),
    [saving, setSaving] = useState(false)
  useEffect(() => setMemory(state.settings.memory), [state.settings.memory])
  return (
    <div className="utility-page narrow">
      <h1>学习偏好</h1>
      <p className="page-subtitle">告诉 FlowChat 你喜欢的解释方式和学习背景。</p>
      <div className="setting-row memory-toggle">
        <div>
          <h3>在对话中使用学习偏好</h3>
          <p>开启后，这些偏好会随你的问题一起发送。</p>
        </div>
        <Switch
          label="启用学习偏好"
          checked={state.settings.memoryEnabled}
          disabled={state.busy}
          onCheckedChange={(value) =>
            void run({ type: 'settings', settings: { memoryEnabled: value } })
          }
        />
      </div>
      <label className="field-label" htmlFor="memory">
        我的学习偏好
      </label>
      <textarea
        id="memory"
        className="field memory-editor"
        disabled={state.busy}
        value={memory}
        onChange={(e) => setMemory(e.target.value)}
        placeholder="例如：解释时先给直观的例子，再介绍严格定义……"
      />
      <div className="memory-footer">
        <span>{memory.length} 字 · 由你编辑和管理</span>
        <Button
          disabled={state.busy || saving || memory === state.settings.memory}
          onClick={async () => {
            setSaving(true)
            try {
              if (await run({ type: 'settings', settings: { memory } }))
                toast.success('学习偏好已更新')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? <Loader2 className="spin" /> : <Check />}保存偏好
        </Button>
      </div>
      <div className="quiet-callout">
        <BookOpen size={18} />
        <div>
          <h3>好的偏好，简单具体就好</h3>
          <p>可以写下你的语言、背景、喜欢的解释方式。FlowChat 不会自动收集或改写这些内容。</p>
        </div>
      </div>
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
    [result, setResult] = useState('')
  return (
    <div className="tool-setting">
      <div className="tool-heading">
        <div className="tool-mark">
          {engine === 'Codex' ? 'C' : engine === 'ClaudeCode' ? '✳' : 'O'}
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
            disabled={!tool.path || state.busy}
            onClick={() => {
              void window.flowchat
                .login(engine)
                .then(() => toast.info('已启动工具登录，请完成浏览器或工具中的登录流程'))
                .catch((e) => toast.error(e.message))
            }}
          >
            {engine === 'OpenCode' ? '配置供应商' : '登录工具'}
            <ExternalLink size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
export function SettingsPage({ state, run }: { state: Snapshot; run: RunCommand }) {
  const theme = state.settings.theme
  return (
    <div className="utility-page narrow">
      <h1>设置</h1>
      <p className="page-subtitle">管理外观、对话工具和本地数据。</p>
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
          <span>使用本机工具的已有登录</span>
        </div>
        {(['Codex', 'ClaudeCode', 'OpenCode'] as Engine[]).map((engine) => (
          <ToolSettings key={engine} engine={engine} state={state} run={run} />
        ))}
      </section>
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
        <span>0.2.0 · 用好奇心连接每一次思考</span>
      </footer>
    </div>
  )
}
