import { Children, isValidElement, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import 'katex/dist/katex.min.css'
import { remarkPlugins, rehypePlugins } from '../lib/markdown-plugins'
import { Check, Copy } from 'lucide-react'
import { IconButton } from './ui/primitives'

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false)
  const code = Children.toArray(children).find(isValidElement)
  const language =
    code && isValidElement<{ className?: string }>(code)
      ? /(?:language|lang)-([^\s]+)/.exec(code.props.className ?? '')?.[1]
      : undefined
  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{language ?? 'CODE'}</span>
        <IconButton
          label={copied ? '已复制' : '复制代码'}
          onClick={async (event) => {
            const text =
              event.currentTarget.closest('.code-block')?.querySelector('pre')?.textContent ?? ''
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  )
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          pre: CodeBlock,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children, ...props }) => (
            <div className="table-scroll">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
