import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import remarkMathDelimiters from './remark-math-delimiters'

export const remarkPlugins: PluggableList = [remarkGfm, remarkMath, remarkMathDelimiters]
export const rehypePlugins: PluggableList = [rehypeKatex, rehypeHighlight]
