import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CircleHelp,
  Copy,
  CornerDownLeft,
  Download,
  GitBranch,
  Mic,
  Volume2,
  Lightbulb,
  Loader2,
  MessageCircle,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './components/ui/button'
import { ContextMenu, Dialog, IconButton, Select } from './components/ui/primitives'
import { Markdown } from './components/markdown'
import { ReasoningControl } from './components/reasoning-control'
import { SourceSelect } from './components/source-select'
import { WorkspaceSelect } from './components/workspace-select'
import { NoteEditor } from './components/note-editor'
import { useSpeech } from './lib/use-speech'
import { prepareWindowClose } from './lib/prepare-close'
import { MemoryPage, NotesPage, SettingsPage } from './pages'
import { cn } from './lib/utils'
import type { Branch, Catalog, Command, Engine, Note, Snapshot } from '../../shared/types'
import { engineNames, modelFor, modelSettingKeys } from '../../shared/types'
import { availableModels, reasoningFor, reasoningKey } from '../../shared/models'

type Page = 'chat' | 'notes' | 'memory' | 'settings'
type Quote = { turnId: string; quote: string }
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={cn('brand-mark', small && 'small')} aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M9 18V6M9 13h1a5 5 0 0 0 5-5V7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9" cy="6" r="1.7" fill="currentColor" />
        <circle cx="15" cy="6" r="1.7" fill="currentColor" />
        <circle cx="9" cy="18" r="1.7" fill="currentColor" />
      </svg>
    </span>
  )
}
function dateGroup(date: string) {
  const now = new Date(),
    value = new Date(date)
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()) /
      86400000,
  )
  return days === 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '过去 7 天' : '更早'
}
function branchDepth(branch: Branch, branches: Branch[]) {
  let depth = 0,
    current = branch
  const visited = new Set([branch.id])
  while (current.parentId && depth < 20) {
    const parent = branches.find((b) => b.id === current.parentId)
    if (!parent || visited.has(parent.id)) break
    visited.add(parent.id)
    current = parent
    depth++
  }
  return depth
}
export default function App() {
  const [state, setState] = useState<Snapshot | null>(null),
    [loadError, setLoadError] = useState('')
  const [page, setPage] = useState<Page>('chat'),
    [sidebar, setSidebar] = useState(window.innerWidth >= 900)
  const [sidebarWidth, setSidebarWidth] = useState(264),
    [resizingSidebar, setResizingSidebar] = useState(false)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const [search, setSearch] = useState(false),
    [query, setQuery] = useState(''),
    [outline, setOutline] = useState<'branches' | 'context' | null>(null)
  const [draft, setDraft] = useState(''),
    [quote, setQuote] = useState<Quote | null>(null),
    [selection, setSelection] = useState<(Quote & { x: number; y: number }) | null>(null)
  const [editingNote, setEditingNote] = useState<Partial<Note> | null>(null)
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState(''),
    [deleting, setDeleting] = useState<string | null>(null),
    [conversationMenu, setConversationMenu] = useState<{
      id: string
      x: number
      y: number
    } | null>(null)
  const [catalogs, setCatalogs] = useState<Partial<Record<Engine, Catalog>>>({}),
    [loadingCatalog, setLoadingCatalog] = useState<Engine | null>(null),
    [streamStatus, setStreamStatus] = useState('正在连接')
  const [showLatest, setShowLatest] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [help, setHelp] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    followLatest = useRef(true),
    previousKey = useRef('')
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    stateRef = useRef(state),
    draftRef = useRef(draft),
    catalogRequests = useRef(new Set<Engine>()),
    catalogPaths = useRef<Partial<Record<Engine, string | null>>>({})
  stateRef.current = state
  draftRef.current = draft
  const branch =
    state?.conversation.branches.find((b) => b.id === state.conversation.activeBranchId) ??
    state?.conversation.branches[0]
  const branchKey = state && branch ? `${state.conversation.id}/${branch.id}` : ''
  const speech = useSpeech(
    state?.settings.speech.enabled ?? false,
    `${branchKey}/${page}`,
    (text) => {
      setDraft((current) => current + (current && !current.endsWith('\n') ? ' ' : '') + text)
      composer.current?.focus()
    },
  )
  useEffect(() => {
    if (state?.settings.sidebarWidth !== undefined)
      setSidebarWidth(Math.min(420, Math.max(244, state.settings.sidebarWidth)))
  }, [state?.settings.sidebarWidth])
  const run = useCallback(async (command: Command) => {
    try {
      const result = await window.flowchat.command(command)
      if ('conversation' in result) setState(result)
      return result
    } catch (e) {
      toast.error(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''),
      )
      return null
    }
  }, [])
  const bootstrap = useCallback(async () => {
    try {
      const result = await window.flowchat.command({ type: 'bootstrap' })
      setState(result as Snapshot)
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void bootstrap()
    const offState = window.flowchat.onState(setState)
    const offStream = window.flowchat.onStream((update) => {
      if (update.status) setStreamStatus(update.status)
      if (update.status?.startsWith('标题生成失败：')) toast.warning(update.status)
      setState((current) => {
        if (!current || current.conversation.id !== update.conversationId) return current
        return {
          ...current,
          conversation: {
            ...current.conversation,
            branches: current.conversation.branches.map((b) =>
              b.id !== update.branchId
                ? b
                : {
                    ...b,
                    turns: b.turns.map((t) =>
                      t.id !== update.turnId ? t : { ...t, answer: update.text ?? t.answer },
                    ),
                  },
            ),
          },
        }
      })
    })
    return () => {
      offState()
      offStream()
    }
  }, [bootstrap])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark =
        state?.settings.theme === 'Dark' || (state?.settings.theme !== 'Light' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [state?.settings.theme])
  useEffect(() => {
    const media = matchMedia('(min-width: 900px)')
    const adapt = () => setSidebar(media.matches)
    media.addEventListener('change', adapt)
    return () => media.removeEventListener('change', adapt)
  }, [])
  useEffect(() => {
    if (branchKey && previousKey.current !== branchKey) {
      previousKey.current = branchKey
      setDraft(branch?.draft ?? '')
      setQuote(null)
      setSelection(null)
      followLatest.current = true
      setShowLatest(false)
    }
  }, [branchKey, branch?.draft])
  const persistDraft = useCallback(async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const current = stateRef.current,
      active = current?.conversation.branches.find(
        (b) => b.id === current.conversation.activeBranchId,
      )
    if (current && active && draftRef.current !== active.draft)
      await window.flowchat.command({
        type: 'draft',
        conversationId: current.conversation.id,
        branchId: active.id,
        text: draftRef.current,
      })
  }, [])
  useEffect(
    () =>
      window.flowchat.onPrepareClose(async () => {
        await prepareWindowClose()
        await persistDraft()
      }),
    [persistDraft],
  )
  useEffect(() => {
    if (!branchKey) return
    draftTimer.current = setTimeout(() => {
      void persistDraft().catch((e) => toast.error(e.message))
    }, 500)
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
    }
  }, [draft, branchKey, persistDraft])
  useEffect(() => {
    const area = composer.current
    if (area) {
      area.style.height = 'auto'
      area.style.height = `${Math.min(200, Math.max(74, area.scrollHeight))}px`
    }
  }, [draft, page])
  const latest = (smooth = false) => {
    if (scroll.current)
      scroll.current.scrollTo({
        top: scroll.current.scrollHeight,
        behavior:
          smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
      })
    followLatest.current = true
    setShowLatest(false)
  }
  useEffect(() => {
    if (followLatest.current) requestAnimationFrame(() => latest())
  }, [branch?.turns.at(-1)?.answer, branch?.turns.length, branchKey, page])
  const navigate = async (next: Page) => {
    try {
      await persistDraft()
      setPage(next)
      if (innerWidth < 900) setSidebar(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const newChat = useCallback(async () => {
    if (stateRef.current?.busy) return
    try {
      await persistDraft()
      if (await run({ type: 'new' })) {
        setPage('chat')
        setQuote(null)
        if (innerWidth < 900) setSidebar(false)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [persistDraft, run])
  const loadChat = async (id: string) => {
    try {
      await persistDraft()
      const result = await run({ type: 'load', id })
      if (result && 'conversation' in result) {
        setPage('chat')
        setSearch(false)
        setQuery('')
        if (innerWidth < 900) setSidebar(false)
        return result
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    return null
  }
  const switchBranch = async (id: string, sourceTurnId?: string | null) => {
    try {
      await persistDraft()
      if (await run({ type: 'branch', id })) {
        setPage('chat')
        if (sourceTurnId)
          setTimeout(() => {
            followLatest.current = false
            document
              .getElementById(`turn-${sourceTurnId}`)
              ?.scrollIntoView({ block: 'start', behavior: 'instant' })
          }, 100)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void newChat()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearch(true)
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        const current = stateRef.current,
          active = current?.conversation.branches.find(
            (b) => b.id === current.conversation.activeBranchId,
          )
        if (active?.parentId) {
          event.preventDefault()
          void switchBranch(active.parentId, active.sourceTurnId)
        }
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [newChat])
  const loadModels = useCallback(
    async (engine: Engine) => {
      if (catalogRequests.current.has(engine)) return
      catalogRequests.current.add(engine)
      catalogPaths.current[engine] =
        stateRef.current?.tools.find((tool) => tool.engine === engine)?.path ?? null
      setLoadingCatalog(engine)
      try {
        const result = await run({ type: 'catalog', engine })
        if (result && 'models' in result) {
          setCatalogs((current) => ({ ...current, [engine]: result }))
        }
      } finally {
        catalogRequests.current.delete(engine)
        setLoadingCatalog((current) => (current === engine ? null : current))
      }
    },
    [run],
  )
  useEffect(() => {
    const engine = branch?.engine
    const path = state?.tools.find((tool) => tool.engine === engine)?.path
    if (engine && path && catalogPaths.current[engine] !== path) void loadModels(engine)
  }, [branch?.engine, catalogs, loadModels, state?.tools])
  const send = async () => {
    if (
      !state ||
      !branch ||
      !draft.trim() ||
      state.busy ||
      submitting ||
      speech.recording ||
      speech.transcribing
    )
      return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    setSubmitting(true)
    followLatest.current = true
    setStreamStatus('正在连接')
    try {
      const result = await run({
        type: 'send',
        text: draft,
        engine: branch.engine,
        fork: quote ?? undefined,
      })
      if (result) {
        setDraft('')
        draftRef.current = ''
        setQuote(null)
      }
    } finally {
      setSubmitting(false)
    }
  }
  const captureSelection = useCallback(() => {
    const selected = window.getSelection(),
      text = selected?.toString().trim()
    const node = selected?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const answer = element?.closest('.answer')
    if (!text || !selected?.rangeCount || !answer?.contains(selected.focusNode)) {
      setSelection(null)
      return
    }
    const article = answer.closest('.turn'),
      turnId = article?.id.replace('turn-', '')
    const current = stateRef.current
    const branch = current?.conversation.branches.find(
      (branch) => branch.id === current.conversation.activeBranchId,
    )
    if (
      !turnId ||
      !branch?.turns.some((turn) => turn.id === turnId && turn.status === 'Complete')
    ) {
      setSelection(null)
      return
    }
    const rect = selected.getRangeAt(0).getBoundingClientRect()
    setSelection({
      turnId,
      quote: text.slice(0, 16000),
      x: Math.min(innerWidth - 280, Math.max(8, rect.left + rect.width / 2 - 130)),
      y: Math.min(innerHeight - 52, Math.max(52, rect.top - 46)),
    })
  }, [])
  useEffect(() => {
    const onSelection = captureSelection
    const dismiss = () => setSelection(null)
    document.addEventListener('selectionchange', onSelection)
    window.addEventListener('resize', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('selectionchange', onSelection)
      window.removeEventListener('resize', dismiss)
      document.removeEventListener('scroll', dismiss, true)
    }
  }, [captureSelection])
  const beginNote = (selected: Quote) => {
    if (!state || !branch) return
    const turn = branch.turns.find((turn) => turn.id === selected.turnId)
    if (!turn) return
    setEditingNote({
      title: turn.question.slice(0, 80),
      text: '',
      quote: selected.quote,
      conversationId: state.conversation.id,
      branchId: branch.id,
      turnId: turn.id,
    })
    setSelection(null)
  }
  const source = async (note: Note) => {
    if (!note.conversationId) return
    try {
      await persistDraft()
      const result = await run({ type: 'load', id: note.conversationId })
      if (result) {
        setPage('chat')
        if (note.branchId) await switchBranch(note.branchId, note.turnId)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  if (!state)
    return (
      <div className="loading-screen">
        <Logo />
        <h1>FlowChat</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <Button onClick={() => void bootstrap()}>重新加载</Button>
          </>
        ) : (
          <Loader2 className="spin" size={18} />
        )}
      </div>
    )
  const chat = state.conversation,
    busy = state.busy,
    empty = !branch?.turns.length,
    toolsAvailable = !!state.tools.find((t) => t.engine === branch?.engine)?.path
  const currentEngine = branch?.engine ?? 'Codex',
    currentCatalog = catalogs[currentEngine],
    selectedModel = modelFor(state.settings, currentEngine)
  const models = currentCatalog
    ? availableModels(currentCatalog, currentEngine, state.settings)
    : []
  const modelOptions = models.map((model) => ({ value: model.id, label: model.name }))
  const selectedCatalogModel = models.find((model) => model.id === selectedModel)
  const reasoningEffort = reasoningFor(state.settings, currentEngine, selectedCatalogModel)
  const groups = state.entries
    .filter((entry) => !entry.archived)
    .reduce<Record<string, typeof state.entries>>((result, entry) => {
      ;(result[dateGroup(entry.updatedAt)] ??= []).push(entry)
      return result
    }, {})
  const exportChat = async (snapshot: Snapshot) => {
    const conversation = snapshot.conversation
    const current =
      conversation.branches.find((b) => b.id === conversation.activeBranchId) ??
      conversation.branches[0]
    const text = `# ${conversation.title}\n\n${[...current.inheritedTurns, ...current.turns].map((t) => `## ${t.question}\n\n${t.answer}${t.error ? '\n\n> ' + t.error : ''}`).join('\n\n---\n\n')}`
    if (await window.flowchat.exportMarkdown(text, conversation.title)) toast.success('对话已导出')
  }
  const conversationAction = async (id: string, action: (snapshot: Snapshot) => void) => {
    const snapshot = id === chat.id ? state : await loadChat(id)
    if (snapshot) action(snapshot)
  }
  return (
    <div
      className={cn(
        'app-shell',
        sidebar && 'sidebar-open',
        resizingSidebar && 'is-resizing-sidebar',
      )}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar" aria-label="主导航" inert={!sidebar}>
        <div className="brand-row">
          <Logo />
          <span>FlowChat</span>
        </div>
        <div className="rail-actions">
          <button
            className="new-chat"
            aria-label="开启新对话"
            onClick={() => void newChat()}
            disabled={busy}
          >
            <Plus size={17} />
            <span>开启新对话</span>
            <kbd>Ctrl N</kbd>
          </button>
          <button className="search-button" aria-label="搜索对话" onClick={() => setSearch(true)}>
            <Search size={16} />
            <span>搜索对话</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
        <div className="history-scroll">
          <div className="rail-caption">最近对话</div>
          {Object.entries(groups).map(([label, entries]) => (
            <div className="history-group" key={label}>
              <h2>{label}</h2>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  disabled={busy}
                  className={cn(
                    'history-item',
                    page === 'chat' && entry.id === chat.id && 'active',
                  )}
                  onClick={() => void loadChat(entry.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setConversationMenu({ id: entry.id, x: event.clientX, y: event.clientY })
                  }}
                >
                  <MessageCircle size={15} />
                  <span>{entry.title}</span>
                  {page === 'chat' && entry.id === chat.id && <span className="active-dot" />}
                </button>
              ))}
            </div>
          ))}
          {!state.entries.some((entry) => !entry.archived) && (
            <div className="history-empty">新对话会显示在这里。</div>
          )}
        </div>
        <div className="rail-bottom">
          <nav>
            {(
              [
                { id: 'notes', Icon: BookOpen, label: '我的笔记' },
                { id: 'memory', Icon: Sparkles, label: '指令与记忆' },
                { id: 'settings', Icon: Settings2, label: '设置' },
              ] as const
            ).map(({ id, Icon, label }) => (
              <button
                className={cn('rail-nav', page === id && 'active')}
                aria-label={label}
                key={id}
                onClick={() => void navigate(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id === 'notes' && state.notes.length > 0 && (
                  <span className="nav-count">{state.notes.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="rail-footer">
            <span className="local-indicator" />
            <span>本地工作空间</span>
            <IconButton label="使用帮助" onClick={() => setHelp(true)}>
              <CircleHelp size={15} />
            </IconButton>
          </div>
        </div>
      </aside>
      {sidebar && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          aria-valuemin={244}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            resizeStart.current = { x: event.clientX, width: sidebarWidth }
            event.currentTarget.setPointerCapture(event.pointerId)
            setResizingSidebar(true)
          }}
          onPointerMove={(event) => {
            const start = resizeStart.current
            if (start)
              setSidebarWidth(
                Math.round(Math.min(420, Math.max(244, start.width + event.clientX - start.x))),
              )
          }}
          onLostPointerCapture={() => {
            if (!resizeStart.current) return
            resizeStart.current = null
            setResizingSidebar(false)
            void run({ type: 'settings', settings: { sidebarWidth } })
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const width =
              event.key === 'Home'
                ? 244
                : event.key === 'End'
                  ? 420
                  : Math.min(
                      420,
                      Math.max(244, sidebarWidth + (event.key === 'ArrowLeft' ? -10 : 10)),
                    )
            setSidebarWidth(width)
            void run({ type: 'settings', settings: { sidebarWidth: width } })
          }}
          onDoubleClick={() => {
            setSidebarWidth(264)
            void run({ type: 'settings', settings: { sidebarWidth: 264 } })
          }}
        />
      )}
      <main className="main-shell">
        <header className="titlebar">
          {/* Electron must process this no-drag region after the titlebar's drag region. */}
          <div className="sidebar-toggle">
            <IconButton
              label={sidebar ? '收起导航' : '展开导航'}
              onClick={() => setSidebar((open) => !open)}
            >
              {sidebar ? <PanelLeftClose /> : <PanelLeft />}
            </IconButton>
          </div>
          <div className="window-controls">
            <button aria-label="最小化窗口" onClick={() => window.flowchat.window('minimize')}>
              <Minus />
            </button>
            <button
              aria-label="最大化或还原窗口"
              onClick={() => window.flowchat.window('maximize')}
            >
              <Square />
            </button>
            <button
              className="window-close"
              aria-label="关闭窗口"
              onClick={() => window.flowchat.window('close')}
            >
              <X />
            </button>
          </div>
        </header>
        <div className="main-body">
          <div className="page-content">
            <AnimatePresence mode="wait" initial={false}>
              {page !== 'chat' ? (
                <motion.div
                  key={page}
                  className="utility-scroll"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  {page === 'notes' ? (
                    <NotesPage state={state} run={run} onSource={(note) => void source(note)} />
                  ) : page === 'memory' ? (
                    <MemoryPage state={state} run={run} />
                  ) : (
                    <SettingsPage state={state} run={run} />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  className={cn('chat-page', empty && 'is-empty')}
                  key="chat"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {!empty && (
                    <div className="conversation-actions">
                      <Button
                        className={cn('outline-toggle', outline === 'branches' && 'is-active')}
                        variant="ghost"
                        size="sm"
                        onClick={() => setOutline(outline === 'branches' ? null : 'branches')}
                      >
                        <GitBranch />
                        脉络
                        {chat.branches.length > 1 && (
                          <span className="branch-count">{chat.branches.length}</span>
                        )}
                      </Button>
                    </div>
                  )}
                  {branch?.parentId && (
                    <div className="branch-breadcrumb">
                      <button
                        disabled={busy}
                        onClick={() => void switchBranch(branch.parentId!, branch.sourceTurnId)}
                      >
                        <ArrowLeft size={14} />
                        返回上层对话
                      </button>
                      <span />
                      <GitBranch size={13} />
                      <span>{branch.title}</span>
                    </div>
                  )}
                  {empty ? (
                    <div className="welcome">
                      <h1>今天想探索什么？</h1>
                      <p>输入一个问题，或从下面的示例开始。</p>
                    </div>
                  ) : (
                    <div
                      className="messages-scroll"
                      ref={scroll}
                      onScroll={() => {
                        const el = scroll.current!
                        followLatest.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight < 100
                        setShowLatest(!followLatest.current)
                      }}
                    >
                      <div className="messages-column" key={branchKey}>
                        {branch?.quote && (
                          <div className="branch-origin">
                            <GitBranch size={15} />
                            <div>
                              <span>从这段思考继续</span>
                              <blockquote>{branch.quote}</blockquote>
                            </div>
                          </div>
                        )}
                        {branch?.turns.map((turn, index) => (
                          <article key={turn.id} id={`turn-${turn.id}`} className="turn">
                            <div className="question">
                              <div className="question-bubble">{turn.question}</div>
                            </div>
                            <div className="answer-heading">
                              <Logo small />
                              <span>FlowChat</span>
                              <span className="answer-engine">{engineNames[branch.engine]}</span>
                              {turn.status === 'Generating' && (
                                <span className="generating-label">
                                  <i />
                                  {turn.answer && streamStatus === '正在连接'
                                    ? '正在回答'
                                    : streamStatus}
                                </span>
                              )}
                            </div>
                            <div
                              className="answer"
                              onMouseUp={captureSelection}
                              onKeyUp={captureSelection}
                            >
                              {turn.answer ? (
                                <Markdown>{turn.answer}</Markdown>
                              ) : turn.status === 'Generating' ? (
                                <div
                                  className="thinking-dots"
                                  role="status"
                                  aria-label="正在等待回答"
                                >
                                  <i />
                                  <i />
                                  <i />
                                </div>
                              ) : null}
                            </div>
                            {turn.error && (
                              <div className="turn-error" role="alert">
                                <span>{turn.error}</span>
                                {index === branch.turns.length - 1 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void run({ type: 'retry', turnId: turn.id })}
                                  >
                                    <RotateCcw />
                                    重试
                                  </Button>
                                )}
                              </div>
                            )}
                            {turn.status === 'Complete' && (
                              <div className="answer-actions">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setQuote({
                                      turnId: turn.id,
                                      quote: '',
                                    })
                                    composer.current?.focus()
                                  }}
                                >
                                  <GitBranch />
                                  追问
                                </Button>
                                {state.settings.speech.enabled && (
                                  <IconButton
                                    disabled={speech.recording || speech.transcribing}
                                    label={
                                      speech.speaking === turn.id
                                        ? '停止朗读'
                                        : selection?.turnId === turn.id
                                          ? '朗读选中文字'
                                          : '朗读回答'
                                    }
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() =>
                                      void speech.speak(
                                        turn.id,
                                        selection?.turnId === turn.id
                                          ? selection.quote
                                          : turn.answer,
                                      )
                                    }
                                  >
                                    {speech.speaking === turn.id ? <Square /> : <Volume2 />}
                                  </IconButton>
                                )}
                                <IconButton
                                  label="复制回答"
                                  onClick={() =>
                                    void navigator.clipboard
                                      .writeText(turn.answer)
                                      .then(() => toast.success('回答已复制'))
                                  }
                                >
                                  <Copy />
                                </IconButton>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                  {showLatest && !empty && (
                    <Button
                      className="latest-button"
                      variant="outline"
                      size="sm"
                      onClick={() => latest(true)}
                    >
                      <ArrowDown />
                      回到最新消息
                    </Button>
                  )}
                  <div className="composer-region">
                    <div className={cn('composer', quote && 'has-quote')}>
                      <AnimatePresence>
                        {quote && (
                          <motion.div
                            className="quote-preview"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                          >
                            <GitBranch size={15} />
                            <div>
                              <strong>沿着这段回答，展开新的思路</strong>
                              {quote.quote && <p>{quote.quote}</p>}
                            </div>
                            <IconButton label="取消追问" onClick={() => setQuote(null)}>
                              <X />
                            </IconButton>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <label className="sr-only" htmlFor="composer">
                        输入你的问题
                      </label>
                      <textarea
                        ref={composer}
                        id="composer"
                        placeholder={
                          quote
                            ? '你想进一步了解什么？'
                            : empty
                              ? '有什么想一起探索的？'
                              : '继续提问，让思路更进一步……'
                        }
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                          if (e.ctrlKey || e.metaKey) {
                            e.preventDefault()
                            const area = e.currentTarget,
                              start = area.selectionStart,
                              end = area.selectionEnd
                            setDraft(draft.slice(0, start) + '\n' + draft.slice(end))
                            requestAnimationFrame(() => {
                              area.selectionStart = area.selectionEnd = start + 1
                            })
                          } else if (!e.shiftKey) {
                            e.preventDefault()
                            void send()
                          }
                        }}
                      />
                      <div className="composer-bottom">
                        <div className="composer-options">
                          <WorkspaceSelect state={state} disabled={busy || submitting} run={run} />
                          <span className="composer-divider" aria-hidden="true" />
                          <SourceSelect
                            engine={currentEngine}
                            providerId={state.settings.openCodeProviderId}
                            tools={state.tools}
                            openCodeCatalog={catalogs.OpenCode}
                            disabled={busy || submitting}
                            loadOpenCode={() => void loadModels('OpenCode')}
                            onChange={async (engine, providerId) => {
                              await persistDraft()
                              if (providerId && providerId !== state.settings.openCodeProviderId) {
                                const result = await run({
                                  type: 'settings',
                                  settings: {
                                    openCodeProviderId: providerId,
                                    openCodeModelId: null,
                                  },
                                })
                                if (!result) return
                              }
                              if (engine !== currentEngine) await run({ type: 'engine', engine })
                            }}
                          />
                          <Select
                            className="model-select"
                            label={`选择 ${engineNames[currentEngine]} 模型`}
                            value={
                              loadingCatalog === currentEngine
                                ? '__loading'
                                : (selectedCatalogModel?.id ?? '__empty')
                            }
                            options={
                              loadingCatalog === currentEngine
                                ? [{ value: '__loading', label: '读取模型…', disabled: true }]
                                : modelOptions.length
                                  ? modelOptions
                                  : [
                                      {
                                        value: '__empty',
                                        label: currentCatalog ? '无可用模型' : '请读取模型',
                                        disabled: true,
                                      },
                                    ]
                            }
                            disabled={
                              busy ||
                              submitting ||
                              loadingCatalog === currentEngine ||
                              !modelOptions.length
                            }
                            onValueChange={(value) => {
                              void run({
                                type: 'settings',
                                settings: { [modelSettingKeys[currentEngine]]: value },
                              })
                            }}
                          />
                          <IconButton
                            label="刷新模型目录"
                            disabled={loadingCatalog === currentEngine || busy || submitting}
                            onClick={() => void loadModels(currentEngine)}
                          >
                            {loadingCatalog === currentEngine ? (
                              <Loader2 className="spin" size={13} />
                            ) : (
                              <RotateCcw size={13} />
                            )}
                          </IconButton>
                          {selectedCatalogModel &&
                            reasoningEffort &&
                            (selectedCatalogModel.reasoningEfforts?.length ?? 0) > 1 && (
                              <ReasoningControl
                                key={reasoningKey(currentEngine, selectedCatalogModel)}
                                efforts={selectedCatalogModel.reasoningEfforts!}
                                value={reasoningEffort}
                                disabled={busy || submitting || loadingCatalog === currentEngine}
                                onChange={(effort) =>
                                  void run({
                                    type: 'settings',
                                    settings: {
                                      reasoningEfforts: {
                                        [reasoningKey(currentEngine, selectedCatalogModel)]: effort,
                                      },
                                    },
                                  })
                                }
                              />
                            )}
                        </div>
                        <div className="composer-send">
                          {state.settings.speech.enabled && (
                            <IconButton
                              label={
                                speech.transcribing
                                  ? '正在识别语音'
                                  : speech.recording
                                    ? '结束录音并识别'
                                    : '语音输入'
                              }
                              disabled={busy || speech.transcribing}
                              className={cn(speech.recording && 'is-recording')}
                              onClick={() => void speech.toggleRecording()}
                            >
                              {speech.transcribing ? (
                                <Loader2 className="spin" />
                              ) : speech.recording ? (
                                <Square />
                              ) : (
                                <Mic />
                              )}
                            </IconButton>
                          )}
                          <span className="send-hint">
                            Enter <CornerDownLeft size={12} />
                          </span>
                          <Button
                            className="send-button"
                            size="icon"
                            aria-label={busy ? '停止生成' : '发送问题'}
                            disabled={
                              !busy &&
                              (!draft.trim() ||
                                !toolsAvailable ||
                                submitting ||
                                speech.recording ||
                                speech.transcribing)
                            }
                            onClick={() => (busy ? void run({ type: 'cancel' }) : void send())}
                          >
                            {busy ? (
                              <Square size={13} fill="currentColor" />
                            ) : submitting ? (
                              <Loader2 className="spin" />
                            ) : (
                              <ArrowUp size={18} />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                    {!toolsAvailable && (
                      <div className="composer-footnote">
                        <button onClick={() => void navigate('settings')}>
                          配置本机对话工具，开始第一次探索
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  {empty && (
                    <div className="starter-grid">
                      {[
                        {
                          Icon: Lightbulb,
                          title: '用生活例子解释贝叶斯定理',
                          text: '先建立直觉，再理解公式和实际应用。',
                          prompt:
                            '请先用一个生活里的例子解释贝叶斯定理，再逐步介绍它的公式和实际应用。',
                        },
                        {
                          Icon: CalendarDays,
                          title: '制定 30 天阅读习惯计划',
                          text: '把目标拆成每天可执行的小步骤。',
                          prompt:
                            '我想在 30 天内养成阅读习惯。请帮我制定一个每天可执行、容易坚持的计划，并说明如何根据进度调整。',
                        },
                        {
                          Icon: BookOpen,
                          title: '梳理设计心理学的入门路径',
                          text: '从核心概念到学习顺序，建立知识框架。',
                          prompt:
                            '我想系统地入门设计心理学。请从核心概念开始，为我梳理学习顺序、推荐练习，并搭建知识框架。',
                        },
                      ].map(({ Icon, title, text, prompt }) => (
                        <button
                          key={title}
                          className="starter-card"
                          onClick={() => {
                            setDraft(prompt)
                            composer.current?.focus()
                          }}
                        >
                          <div>
                            <Icon size={17} />
                            <ArrowUpRight size={13} className="starter-arrow" />
                          </div>
                          <h3>{title}</h3>
                          <p>{text}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {page === 'chat' && outline && (
              <motion.aside
                className="outline-panel"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 272, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="outline-inner">
                  <div className="outline-heading">
                    <span>{outline === 'branches' ? '对话脉络' : '当前上下文'}</span>
                    <IconButton label="关闭侧面板" onClick={() => setOutline(null)}>
                      <X />
                    </IconButton>
                  </div>
                  {outline === 'branches' ? (
                    <>
                      <p className="outline-description">查看主对话与各个追问分支。</p>
                      <div className="branch-tree">
                        {chat.branches.map((b) => (
                          <button
                            key={b.id}
                            disabled={busy}
                            className={cn('branch-node', b.id === branch?.id && 'active')}
                            style={
                              {
                                '--branch-indent': `${Math.min(branchDepth(b, chat.branches) * 16, 128)}px`,
                              } as CSSProperties
                            }
                            onClick={() => void switchBranch(b.id)}
                          >
                            {b.parentId ? <GitBranch size={14} /> : <MessageCircle size={14} />}
                            <span>{b.title}</span>
                            {b.id === branch?.id && <span className="active-dot" />}
                          </button>
                        ))}
                      </div>
                      <div className="outline-tip">
                        <GitBranch size={18} />
                        <p>
                          在回答下点击「追问」，
                          <br />
                          开启一条独立的思考分支。
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="context-content">
                      {state.settings.instructionsEnabled && (
                        <section>
                          <h3>用户指令 · Instruction</h3>
                          <p>{state.settings.instructions}</p>
                        </section>
                      )}
                      {state.settings.memoryEnabled && (
                        <section>
                          <h3>模型记忆 · {state.memory.name}</h3>
                          <p>{state.memory.text || '暂无模型记忆'}</p>
                        </section>
                      )}
                      <section>
                        <h3>工作目录</h3>
                        <p>{state.workingDirectory}</p>
                      </section>
                      <section>
                        <h3>祖先路径 · {branch?.inheritedTurns.length ?? 0} 轮</h3>
                        {branch?.inheritedTurns.map((t) => (
                          <div key={t.id}>
                            <strong>{t.question}</strong>
                            <Markdown>{t.answer}</Markdown>
                          </div>
                        ))}
                        {!branch?.inheritedTurns.length && <p>当前是主对话，没有继承的问答。</p>}
                      </section>
                      {branch?.quote && (
                        <section>
                          <h3>引用片段</h3>
                          <p>{branch.quote}</p>
                        </section>
                      )}
                      <section>
                        <h3>本分支 · {branch?.turns.length} 轮</h3>
                        <p>普通追问延续当前工具会话；分支仅继承起点前的祖先路径。</p>
                      </section>
                    </div>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </main>
      <ContextMenu
        open={!!conversationMenu}
        onOpenChange={(open) => {
          if (!open) setConversationMenu(null)
        }}
        position={conversationMenu}
        items={[
          {
            label: '重命名对话',
            icon: <Pencil />,
            disabled: busy,
            action: () => {
              const id = conversationMenu?.id
              if (id)
                void conversationAction(id, (snapshot) => {
                  setTitle(snapshot.conversation.title)
                  setRenaming(true)
                })
            },
          },
          {
            label: '查看上下文',
            icon: <BookOpen />,
            action: () => {
              const id = conversationMenu?.id
              if (id) void conversationAction(id, () => setOutline('context'))
            },
          },
          {
            label: '导出 Markdown',
            icon: <Download />,
            action: () => {
              const id = conversationMenu?.id
              if (id) void conversationAction(id, (snapshot) => void exportChat(snapshot))
            },
          },
          {
            label: '归档对话',
            icon: <Archive />,
            disabled: busy,
            action: () => {
              const id = conversationMenu?.id
              if (id)
                void persistDraft()
                  .then(() => run({ type: 'archive', id, archived: true }))
                  .then((result) => {
                    if (result) toast.success('已归档，可在设置中恢复')
                  })
                  .catch((error) => toast.error(error.message))
            },
          },
          {
            label: '删除对话',
            icon: <Trash2 />,
            danger: true,
            separator: true,
            disabled: busy,
            action: () => {
              if (conversationMenu) setDeleting(conversationMenu.id)
            },
          },
        ]}
      />
      {selection && page === 'chat' && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="选中文字操作"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label="追问选中文字"
            onClick={() => {
              setQuote({ turnId: selection.turnId, quote: selection.quote })
              setSelection(null)
              composer.current?.focus()
            }}
          >
            <GitBranch />
            追问
          </Button>
          <Button size="sm" variant="ghost" onClick={() => beginNote(selection)}>
            <Pencil />
            记笔记
          </Button>
        </div>
      )}
      {editingNote && (
        <NoteEditor
          note={editingNote}
          state={state}
          run={run}
          onClose={() => setEditingNote(null)}
        />
      )}
      <Dialog open={search} onOpenChange={setSearch} title="搜索对话" className="search-dialog">
        <div className="search-field">
          <Search size={18} />
          <input
            autoFocus
            placeholder="寻找一个问题、一段思考……"
            aria-label="搜索会话标题"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-results">
          {state.entries
            .filter((e) => !e.archived && e.title.toLowerCase().includes(query.toLowerCase()))
            .map((entry) => (
              <button disabled={busy} key={entry.id} onClick={() => void loadChat(entry.id)}>
                <MessageCircle size={17} />
                <span>{entry.title}</span>
                <ArrowRight size={15} />
              </button>
            ))}
          {!state.entries.some(
            (e) => !e.archived && e.title.toLowerCase().includes(query.toLowerCase()),
          ) && (
            <div className="search-empty">
              {query ? '没有找到相关对话，试试其他关键词。' : '还没有对话，先开始一次探索吧。'}
            </div>
          )}
        </div>
        <div className="search-footer">按标题搜索未归档的对话</div>
      </Dialog>
      <Dialog open={renaming} onOpenChange={setRenaming} title="给这段思考起个名字">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run({ type: 'rename', title })) setRenaming(false)
          }}
        >
          <label className="sr-only" htmlFor="chat-title">
            对话名称
          </label>
          <input
            id="chat-title"
            className="field"
            autoFocus
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="dialog-footer">
            <Button variant="ghost" type="button" onClick={() => setRenaming(false)}>
              取消
            </Button>
            <Button disabled={!title.trim()}>保存名称</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除这段对话？"
        description="对话和全部分支将被删除，已收藏的笔记会保留。此操作无法撤销。"
      >
        <div className="dialog-footer">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (deleting && (await run({ type: 'delete', id: deleting }))) {
                setDeleting(null)
                setQuote(null)
              }
            }}
          >
            删除对话
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title="给思考多一点空间"
        description="从提问到深入，让每一个想法都连得起来。"
      >
        <div className="help-list">
          <div>
            <Plus />
            <span>新建对话</span>
            <kbd>Ctrl N</kbd>
          </div>
          <div>
            <Search />
            <span>搜索对话</span>
            <kbd>Ctrl K</kbd>
          </div>
          <div>
            <ArrowUp />
            <span>发送问题</span>
            <kbd>Enter</kbd>
          </div>
          <div>
            <ArrowLeft />
            <span>返回父分支</span>
            <kbd>Alt ←</kbd>
          </div>
        </div>
        <p className="help-note">
          Enter 发送，Ctrl+Enter 或 Shift+Enter
          换行。选中回答中的文字，再点击「追问」，即可带着引用开启分支。
        </p>
      </Dialog>
    </div>
  )
}
