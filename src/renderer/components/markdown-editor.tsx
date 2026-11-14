import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type Vditor from 'vditor'
import 'vditor/dist/index.css'
import './markdown-editor.css'

const cdn = new URL(`${import.meta.env.BASE_URL}vendor/vditor`, document.baseURI).href
let resources: Promise<void> | undefined
function loadResources() {
  const script = (path: string, id: string) =>
    new Promise<void>((resolve, reject) => {
      if (document.getElementById(id)) return resolve()
      const element = document.createElement('script')
      element.src = `${cdn}/dist/js/${path}`
      element.onload = () => {
        element.id = id
        resolve()
      }
      element.onerror = () => {
        element.remove()
        reject(new Error('编辑器资源加载失败，请重新打开编辑区。'))
      }
      document.head.append(element)
    })
  return (resources ??= Promise.all([
    script('i18n/zh_CN.js', 'vditorI18nScriptzh_CN'),
    script('lute/lute.min.js', 'vditorLuteScript'),
    script('icons/ant.js', 'flowchatVditorIconScript'),
  ])
    .then(() => undefined)
    .catch((error) => {
      resources = undefined
      throw error
    }))
}

export type MarkdownEditorHandle = { focus: () => void }

export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  placeholder = '从一个想法开始……',
  className = '',
  hidden = false,
  ref,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  className?: string
  hidden?: boolean
  ref?: Ref<MarkdownEditorHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Vditor | null>(null)
  const props = useRef({ value, onChange, disabled, autoFocus })
  props.current = { value, onChange, disabled, autoFocus }
  const lastValue = useRef(value)
  const serialized = useRef('')
  const [error, setError] = useState('')
  useImperativeHandle(ref, () => ({ focus: () => instance.current?.focus() }), [])

  useEffect(() => {
    let disposed = false
    let editor: Vditor | undefined
    let ready = false
    const container = host.current!
    const publish = () => {
      if (!ready || disposed || props.current.disabled) return
      const markdown = editor!.getValue()
      // Loading a document must not dirty it just because the parser normalizes
      // whitespace. Only publish a changed document, without resetting its caret.
      if (markdown === serialized.current) return
      serialized.current = markdown
      lastValue.current = markdown
      props.current.onChange(markdown)
    }
    const input = (event: Event) => {
      if (!(event as InputEvent).isComposing) publish()
    }
    const accessibility = () => {
      for (const mode of ['ir', 'wysiwyg', 'sv'] as const) {
        const element = editor!.vditor[mode]!.element
        element.id = mode === 'ir' ? id : `${id}-${mode}`
        element.setAttribute('aria-label', mode === 'sv' ? `${label}源码` : label)
        element.setAttribute('aria-multiline', 'true')
        element.setAttribute('aria-readonly', String(props.current.disabled))
        if (mode !== 'sv') element.setAttribute('role', 'textbox')
      }
      container.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.type = 'button'
      })
    }
    void Promise.all([loadResources(), import('vditor')])
      .then(([, { default: Vditor }]) => {
        if (disposed) return
        editor = new Vditor(container, {
          cdn,
          i18n: { ...window.VditorI18n, splitView: 'Markdown 源码' },
          // Preload icons as an external script; the default loader injects
          // inline JavaScript, which is disallowed by the application's CSP.
          icon: undefined,
          mode: 'ir',
          value: props.current.value,
          placeholder,
          height: '100%',
          minHeight: 180,
          cache: { enable: false },
          toolbar: [
            'headings',
            'bold',
            'italic',
            'strike',
            '|',
            'list',
            'ordered-list',
            'check',
            'quote',
            '|',
            'link',
            'table',
            'code',
            'inline-code',
            '|',
            'undo',
            'redo',
            'edit-mode',
          ],
          preview: {
            mode: 'editor',
            maxWidth: 900,
            theme: { current: '', path: '' },
            math: { engine: 'KaTeX', inlineDigit: true },
            markdown: {
              sanitize: true,
              footnotes: true,
              codeBlockPreview: true,
              mathBlockPreview: true,
            },
            hljs: {
              enable: true,
              style: 'github',
              renderMenu: (_code, menu) => {
                // Replace Vditor's inline copy handlers with CSP-safe listeners.
                const oldButton = menu.querySelector('span')!
                oldButton.removeAttribute('onmouseover')
                oldButton.removeAttribute('onclick')
                const button = document.createElement('button')
                button.type = 'button'
                button.className = oldButton.className
                button.setAttribute('aria-label', '复制代码')
                button.innerHTML = oldButton.innerHTML
                button.addEventListener('click', (event) => {
                  event.stopPropagation()
                  const source = menu.querySelector('textarea')!
                  source.select()
                  const copied = document.execCommand('copy')
                  source.blur()
                  button.setAttribute('aria-label', copied ? '已复制' : '复制失败')
                })
                oldButton.replaceWith(button)
              },
            },
            render: { media: { enable: false } },
          },
          hint: { emojiPath: `${cdn}/dist/images/emoji` },
          image: { isPreview: false },
          input: publish,
          blur: publish,
          after: () => {
            if (disposed) return
            ready = true
            instance.current = editor!
            lastValue.current = props.current.value
            if (editor!.getValue() !== props.current.value)
              editor!.setValue(props.current.value, true)
            serialized.current = editor!.getValue()
            accessibility()
            if (props.current.disabled) editor!.disabled()
            else if (props.current.autoFocus) editor!.focus()
          },
        })
      })
      .catch((reason: Error) => {
        if (!disposed) setError(reason.message)
      })
    // Bubble after Vditor has processed the DOM. Do not wait for its undo
    // debounce: Save, close and model collaboration need the latest keystroke.
    container.addEventListener('input', input)
    container.addEventListener('compositionend', publish)
    container.addEventListener('click', publish)
    container.addEventListener('paste', publish)
    container.addEventListener('keydown', input)
    return () => {
      disposed = true
      instance.current = null
      container.removeEventListener('input', input)
      container.removeEventListener('compositionend', publish)
      container.removeEventListener('click', publish)
      container.removeEventListener('paste', publish)
      container.removeEventListener('keydown', input)
      if (editor) {
        clearTimeout(editor.vditor.ir?.processTimeoutId)
        clearTimeout(editor.vditor.sv?.processTimeoutId)
        editor.destroy()
      }
    }
  }, [id, label, placeholder])

  useEffect(() => {
    const editor = instance.current
    if (!editor || value === lastValue.current) return
    lastValue.current = value
    editor.setValue(value, true)
    serialized.current = editor.getValue()
  }, [value])
  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    if (disabled) editor.disabled()
    else editor.enable()
    for (const mode of ['ir', 'wysiwyg', 'sv'] as const)
      editor.vditor[mode]!.element.setAttribute('aria-readonly', String(disabled))
  }, [disabled])

  return (
    <div
      className={`markdown-editor ${className}`}
      id={`${id}-editor`}
      hidden={hidden}
      onClickCapture={(event) => {
        const button = (event.target as Element).closest('button')
        if (button) button.type = 'button'
      }}
    >
      {error ? (
        <>
          <p role="alert" className="markdown-editor-error">
            {error}
          </p>
          <textarea
            id={id}
            aria-label={label}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </>
      ) : (
        <div ref={host} />
      )}
    </div>
  )
}
