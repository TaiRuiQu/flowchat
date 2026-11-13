import type { Processor } from 'unified'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Extension, Tokenizer, State } from 'micromark-util-types'
import type {} from 'remark-parse'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    mathBracket: 'mathBracket'
    mathBracketData: 'mathBracketData'
  }
  interface Token {
    _mathDisplay?: boolean
  }
}

// Parse backslash math as Markdown syntax, so code spans, fences and escaped
// backslashes retain their normal behavior without a source-wide replacement.
const tokenize: Tokenizer = function (effects, ok, nok) {
  let closing: number
  let inData = false
  const token = effects.enter('mathBracket')
  const start: State = (code) => {
    if (code !== 92) return nok(code)
    effects.consume(code)
    return open
  }
  const open: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code)
    token._mathDisplay = code === 91
    closing = code === 40 ? 41 : 93
    effects.consume(code)
    return content
  }
  const content: State = (code) => {
    if (code === null) return nok(code)
    if (code === -5 || code === -4 || code === -3) {
      if (inData) effects.exit('mathBracketData')
      inData = false
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return content
    }
    if (!inData) {
      effects.enter('mathBracketData')
      inData = true
    }
    effects.consume(code)
    return code === 92 ? afterSlash : content
  }
  const afterSlash: State = (code) => {
    if (code === closing) {
      effects.consume(code)
      effects.exit('mathBracketData')
      effects.exit('mathBracket')
      return ok
    }
    // A doubled backslash is a TeX command, not a closing delimiter.
    if (code === 92) {
      effects.consume(code)
      return content
    }
    return content(code)
  }
  return start
}

const syntax: Extension = { text: { 92: { name: 'mathBracket', tokenize } } }
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    mathBracket(token) {
      const value = this.sliceSerialize(token).slice(2, -2).trim()
      this.enter(
        {
          type: 'inlineMath',
          value,
          data: {
            hName: 'code',
            hProperties: {
              className: ['language-math', token._mathDisplay ? 'math-display' : 'math-inline'],
            },
            hChildren: [{ type: 'text', value }],
          },
        },
        token,
      )
      this.buffer()
    },
  },
  exit: {
    mathBracket(token) {
      this.resume()
      this.exit(token)
    },
  },
}

export default function remarkMathDelimiters(this: Processor) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(syntax)
  ;(data.fromMarkdownExtensions ??= []).push(fromMarkdown)
}
