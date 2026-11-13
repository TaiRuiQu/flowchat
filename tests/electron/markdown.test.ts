import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { remarkPlugins, rehypePlugins } from '../../src/renderer/lib/markdown-plugins'

const render = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, text))

describe('Markdown rendering', () => {
  it('renders both dollar and backslash delimiters as inline and display math', () => {
    const result = render(String.raw`行内 $a^2+b^2=c^2$ 和 \( E=mc^2 \)。

$$
\frac{1}{2}
$$

\[
\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]`)
    expect(result.match(/class="katex"/g)).toHaveLength(4)
    expect(result.match(/class="katex-display"/g)).toHaveLength(2)
    expect(result).toContain('<math')
    expect(result).not.toContain('katex-error')
  })
  it('keeps code, escaped delimiters and incomplete streamed math intact', () => {
    const code = String.raw`\(x\) $y$ \[z\]`
    const result = render(
      '`' + code + '`\n\n```text\n' + code + '\n```\n\n' + String.raw`\\(text\\) 和 \(incomplete`,
    )
    expect(result).not.toContain('class="katex"')
    expect(result).toContain(code)
    expect(result).toContain('incomplete')
    expect(result).not.toContain('hljs-keyword')
  })
  it('handles every prefix of streamed math and math inside quoted text', () => {
    const text = String.raw`公式 \[\frac{1}{2}+\sqrt{x}\]，以及 \(x_1\)。`
    for (let end = 0; end <= text.length; end++)
      expect(() => render(text.slice(0, end))).not.toThrow()
    expect(render(String.raw`> 公式 \(x^2\)`)).toContain('class="katex"')
  })
  it('highlights tagged code and gracefully handles unknown languages and invalid formulas', () => {
    const result = render(
      '```ts\nconst answer = "你好";\n```\n\n```unknown-language\n<hello>\n```\n\n' +
        String.raw`$\frac{1}{$`,
    )
    expect(result).toContain('hljs-keyword')
    expect(result).toContain('hljs-string')
    expect(result).toContain('&lt;hello&gt;')
    expect(result).toContain('katex-error')
    expect(result).not.toContain('<hello>')
  })
})
