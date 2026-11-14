import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpen, ChevronDown, Loader2, Pencil, Quote, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { Engine, Note, Snapshot } from '../../../shared/types'
import { engineNames } from '../../../shared/types'
import type { RunCommand } from '../pages'
import { Button } from './ui/button'
import { Dialog, Select } from './ui/primitives'
import { Markdown } from './markdown'
import { MarkdownEditor, type MarkdownEditorHandle } from './markdown-editor'
import { registerCloseParticipant } from '../lib/prepare-close'

export function NoteEditor({
  note,
  state,
  run,
  onClose,
}: {
  note: Partial<Note>
  state: Snapshot
  run: RunCommand
  onClose: () => void
}) {
  const [title, setTitle] = useState(note.title ?? '')
  const [text, setText] = useState(note.text ?? '')
  const [instruction, setInstruction] = useState(''),
    [suggestion, setSuggestion] = useState('')
  const [suggestionBase, setSuggestionBase] = useState('')
  const requestEpoch = useRef(0),
    lastInstruction = useRef('')
  const [engine, setEngine] = useState<Engine>(
    state.conversation.branches.find((branch) => branch.id === state.conversation.activeBranchId)
      ?.engine ?? state.settings.defaultEngine,
  )
  const [assisting, setAssisting] = useState(false),
    [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false),
    [pane, setPane] = useState<'document' | 'collaboration'>('document')
  const [confirmClose, setConfirmClose] = useState(false)
  const saveOperation = useRef<Promise<void> | null>(null)
  const form = useRef<HTMLFormElement>(null),
    writer = useRef<MarkdownEditorHandle>(null),
    request = useRef<HTMLTextAreaElement>(null)
  const dirty = title !== (note.title ?? '') || text !== (note.text ?? '')
  const canSave = !saving && (!!note.id ? dirty : !!(title.trim() || text.trim() || note.quote))
  const discard = () => {
    requestEpoch.current++
    if (assisting) void run({ type: 'cancel' })
    onClose()
  }
  const close = () => {
    if (saving) return
    if (dirty) setConfirmClose(true)
    else discard()
  }
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    const finalTitle =
      title.trim() ||
      text
        .replace(/^[#>*\s-]+/gm, '')
        .trim()
        .split('\n')[0]
        ?.slice(0, 60) ||
      note.quote?.slice(0, 60) ||
      '未命名笔记'
    const operation = (async () => {
      if (assisting) {
        requestEpoch.current++
        await run({ type: 'cancel' })
        setAssisting(false)
      }
      const result = await run({
        type: 'saveNote',
        note: {
          id: note.id,
          title: finalTitle,
          text,
          quote: note.quote,
          conversationId: note.conversationId,
          branchId: note.branchId,
          turnId: note.turnId,
        },
      })
      if (!result) throw new Error('笔记保存失败。')
    })()
    saveOperation.current = operation
    try {
      await operation
      toast.success('笔记已保存')
      onClose()
    } catch {
      // The command runner already reports the underlying error. Keep the document open.
    } finally {
      saveOperation.current = null
      setSaving(false)
    }
  }
  const exitSave = useRef<() => Promise<void>>(async () => {})
  exitSave.current = async () => {
    if (saveOperation.current) {
      await saveOperation.current
      return
    }
    if (!dirty) return
    setSaving(true)
    try {
      requestEpoch.current++
      if (assisting) {
        await window.flowchat.command({ type: 'cancel' })
        setAssisting(false)
      }
      const finalTitle =
        title.trim() ||
        text
          .replace(/^[#>*\s-]+/gm, '')
          .trim()
          .split('\n')[0]
          ?.slice(0, 60) ||
        note.quote?.slice(0, 60) ||
        '未命名笔记'
      await window.flowchat.command({
        type: 'saveNote',
        note: {
          id: note.id,
          title: finalTitle,
          text,
          quote: note.quote,
          conversationId: note.conversationId,
          branchId: note.branchId,
          turnId: note.turnId,
        },
      })
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => registerCloseParticipant(() => exitSave.current()), [])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        form.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const assist = async (editInstruction = instruction) => {
    if (assisting || saving || state.busy || !editInstruction.trim()) return
    const epoch = ++requestEpoch.current,
      base = text
    lastInstruction.current = editInstruction
    setAssisting(true)
    try {
      const result = await run({
        type: 'assistNote',
        text,
        quote: note.quote ?? '',
        instruction: editInstruction,
        engine,
      })
      if (result?.message && epoch === requestEpoch.current) {
        setSuggestion(result.message)
        setSuggestionBase(base)
        setInstruction('')
      }
    } finally {
      if (epoch === requestEpoch.current) setAssisting(false)
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={note.id ? '编辑笔记' : '记笔记'}
        className="note-dialog"
        headerActions={
          <>
            <span className="note-save-state">{dirty || !note.id ? '未保存' : '已保存'}</span>
            <Button
              type="submit"
              form="note-editor-form"
              className="note-save-button"
              size="sm"
              disabled={!canSave}
              title="保存笔记 · Ctrl+S"
            >
              {saving && <Loader2 className="spin" />}保存笔记
            </Button>
          </>
        }
      >
        <div className="note-mobile-tabs" role="tablist" aria-label="笔记工作区">
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'document'}
            onClick={() => setPane('document')}
          >
            <Pencil size={14} />
            笔记
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'collaboration'}
            onClick={() => setPane('collaboration')}
          >
            <Sparkles size={14} />
            一起编辑{suggestion && <span className="note-proposal-dot" />}
          </button>
        </div>
        <form
          id="note-editor-form"
          ref={form}
          className="note-workspace"
          data-pane={pane}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <section className="note-document note-editor-scroll" aria-label="笔记编辑区">
            <div className="note-document-heading">
              <input
                id="note-title"
                className="note-title-input"
                aria-label="笔记标题"
                maxLength={200}
                readOnly={saving}
                placeholder="给笔记起个标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    writer.current?.focus()
                  }
                }}
              />
              {note.quote && (
                <details className="note-source note-reference" open>
                  <summary>
                    <Quote size={14} />
                    <span>原文摘录</span>
                    <ChevronDown size={13} />
                  </summary>
                  <blockquote>{note.quote}</blockquote>
                </details>
              )}
            </div>
            <div className="note-document-toolbar">
              <div role="group" aria-label="笔记显示方式">
                <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                  <Pencil size={13} />
                  即时渲染
                </button>
                <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                  <BookOpen size={13} />
                  预览
                </button>
              </div>
              <span>GFM · 数学公式</span>
            </div>
            {preview && (
              <div className="note-document-preview">
                {text.trim() ? (
                  <Markdown>{text}</Markdown>
                ) : (
                  <p>写下你的想法后，可以在这里预览。</p>
                )}
              </div>
            )}
            <MarkdownEditor
              id="note-text"
              ref={writer}
              className="note-markdown-editor"
              disabled={saving}
              hidden={preview}
              label="笔记正文"
              autoFocus
              value={text}
              onChange={setText}
              placeholder={
                note.quote
                  ? '这段话让你想到了什么？\n\n写下你的理解，也可以和模型一起完善。'
                  : '从一个想法开始……\n\n这里是你的写作空间。'
              }
            />
          </section>
          <aside className="note-collaboration" aria-label="模型协作">
            <div className="note-collaboration-heading">
              <h3>
                <Sparkles size={16} />
                一起编辑
              </h3>
              <Select
                label="笔记协作工具"
                value={engine}
                disabled={assisting || saving || state.busy}
                options={state.tools.map((tool) => ({
                  value: tool.engine,
                  label: engineNames[tool.engine],
                  disabled: !tool.path,
                }))}
                onValueChange={(value) => setEngine(value as Engine)}
              />
            </div>
            <div className="note-collaboration-body">
              {assisting ? (
                <div className="note-assistant-waiting" role="status">
                  <Loader2 className="spin" size={18} />
                  <p>正在打磨你的笔记……</p>
                  <span>你可以继续写作。</span>
                </div>
              ) : suggestion ? (
                <section className="note-suggestion" aria-label="模型修改建议">
                  <div className="note-suggestion-label">修改建议</div>
                  {text !== suggestionBase && (
                    <p className="note-stale-warning" role="status">
                      正文已有新修改。这份建议基于旧版本，请按最新内容重新生成。
                    </p>
                  )}
                  <div className="note-suggestion-text">
                    <Markdown>{suggestion}</Markdown>
                  </div>
                  <div className="note-proposal-actions">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (text !== suggestionBase) {
                          void assist(lastInstruction.current)
                          return
                        }
                        setText(suggestion)
                        setSuggestion('')
                        setPane('document')
                        setPreview(false)
                        toast.success('已采纳到正文，记得保存')
                      }}
                    >
                      {text !== suggestionBase ? '基于最新正文重写' : '采纳到笔记'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSuggestion('')}
                    >
                      放弃建议
                    </Button>
                  </div>
                </section>
              ) : (
                <div className="note-assistant-empty">
                  <p>你的想法，可以再往前一步。</p>
                  <span>
                    请模型补充例子、梳理结构，或保留你的语气润色。建议会先展示在这里，由你决定是否采纳。
                  </span>
                  <div className="note-prompt-starters">
                    {[
                      { label: '补充例子', prompt: '保留我的观点，补充一个容易理解的日常例子。' },
                      { label: '梳理结构', prompt: '保留我的内容，帮我梳理结构和逻辑。' },
                      { label: '润色表达', prompt: '保留我的语气，让表达更清楚、自然。' },
                    ].map(({ label, prompt }) => (
                      <button
                        type="button"
                        key={label}
                        onClick={() => {
                          setInstruction(prompt)
                          request.current?.focus()
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="note-assistant-composer">
              <textarea
                id="note-instruction"
                ref={request}
                aria-label="编辑要求"
                rows={2}
                disabled={saving}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="希望一起改进哪一部分？"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void assist()
                  }
                }}
              />
              <div className="note-assistant-actions">
                <span>建议不会自动覆盖正文</span>
                <Button
                  type="button"
                  size="icon"
                  aria-label="生成修改建议"
                  disabled={assisting || saving || state.busy || !instruction.trim()}
                  onClick={() => void assist()}
                >
                  {assisting ? <Loader2 className="spin" size={14} /> : <ArrowUp size={15} />}
                </Button>
              </div>
            </div>
          </aside>
        </form>
      </Dialog>
      <Dialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="保存对笔记的修改？"
        description="离开前保存修改，或继续编辑。"
      >
        <div className="dialog-footer note-close-actions">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>
            继续编辑
          </Button>
          <Button variant="outline" onClick={discard}>
            不保存
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            保存并关闭
          </Button>
        </div>
      </Dialog>
    </>
  )
}
