import { _electron as electron, expect } from 'playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fillMarkdown, markdownMode, readMarkdown } from './markdown-editor-helpers.mjs'

const root = path.resolve('.artifacts/markdown-editor-qa', randomUUID())
const data = path.join(root, 'data')
await mkdir(data, { recursive: true })
await writeFile(
  path.join(data, 'settings.json'),
  JSON.stringify({
    codexPath: path.join(root, 'missing.exe'),
    claudePath: path.join(root, 'missing.exe'),
    openCodePath: path.join(root, 'missing.exe'),
  }),
)
const application = await electron.launch({
  args: ['.', `--user-data-dir=${path.join(root, 'profile')}`],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
})
const page = await application.firstWindow()
const errors = [],
  requests = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && request.resourceType() !== 'image')
    requests.push(request.url())
})
await page.route('https://example.test/markdown.svg', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24"><rect width="64" height="24" fill="#4b5fd0"/></svg>',
  }),
)
const markdown =
  '# 即时渲染笔记\n\n**粗体**、*斜体*、~~删除线~~ 和 `inline code`。\n\n' +
  '- [ ] 待办任务\n- [x] 已完成任务\n\n> 引用内容\n\n' +
  '| 名称 | 公式 |\n| :--- | ---: |\n| 能量 | $E=mc^2$ |\n\n' +
  '行内公式 $a^2+b^2=c^2$。\n\n$$\n\\frac{1}{2} + \\sqrt{x}\n$$\n\n' +
  '[项目链接](https://example.com) 与自动链接 https://example.org\n\n' +
  '```typescript\nconst answer = 42\n```\n\n' +
  '![示意图](https://example.test/markdown.svg)\n\n脚注引用[^1]。\n\n[^1]: 脚注正文\n\n---\n\n末尾段落'
try {
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.locator('#note-title').fill('GFM 与数学公式')
  await fillMarkdown(page, 'note-text', markdown)
  const editor = page.locator('#note-text')
  await expect(editor.locator('h1')).toContainText('即时渲染笔记')
  await expect(editor.locator('strong')).toContainText('粗体')
  await expect(editor.locator('s, del')).toContainText('删除线')
  await expect(editor.locator('table')).toHaveCount(1)
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(2)
  await expect(editor.locator('.katex')).toHaveCount(3)
  await expect(editor.locator('.hljs-keyword')).toContainText('const')
  await page.locator('#note-text-editor .vditor-copy').first().locator('..').hover()
  await page.locator('#note-text-editor .vditor-copy button').first().click()
  await expect(page.locator('#note-text-editor .vditor-copy button').first()).toHaveAttribute(
    'aria-label',
    '已复制',
  )
  assert.match(
    await application.evaluate(({ clipboard }) => clipboard.readText()),
    /const answer = 42/,
  )
  await expect
    .poll(() => editor.locator('img[alt="示意图"]').evaluate((image) => image.naturalWidth))
    .toBe(64)
  assert.match(await readMarkdown(page, 'note-text'), /\[\^1\]/)
  await page.screenshot({ path: path.join(root, 'instant-rendering.png') })
  await editor.locator('input[type="checkbox"]').first().check()
  assert.match(await readMarkdown(page, 'note-text'), /- \[X\]\s+待办任务/i)
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('.note-document-preview .katex')).toHaveCount(3)
  await page.getByRole('button', { name: '即时渲染', exact: true }).click()
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('.note-body').first().click()
  await expect(editor.locator('h1')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })

  // IME commits and immediate Ctrl+S must persist before Vditor's undo debounce.
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.locator('#note-text').waitFor()
  await page.locator('#note-text').click()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: '中文输入',
    selectionStart: 4,
    selectionEnd: 4,
  })
  await cdp.send('Input.insertText', { text: '中文输入' })
  await page.keyboard.press('Control+s')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const notes = JSON.parse(await readFile(path.join(data, 'notes.json'), 'utf8'))
  assert.ok(notes.some((note) => note.text.trim() === '中文输入'))

  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.locator('#note-title').fill('粘贴与撤销')
  const live = page.locator('#note-text')
  await live.click()
  await live.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '# 粘贴标题\n\n中文正文')
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )
  })
  await expect(live.locator('h1')).toContainText('粘贴标题')
  await live.press('Control+End')
  await page.keyboard.type('新增文字')
  const undo = page.locator('#note-text-editor [data-type="undo"]')
  await expect(undo).not.toHaveClass(/vditor-menu--disabled/)
  await live.press('Control+z')
  await expect(live).not.toContainText('新增文字')
  await live.press('Control+y')
  await expect(live).toContainText('新增文字')
  await page.keyboard.press('Control+s')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const pasted = JSON.parse(await readFile(path.join(data, 'notes.json'), 'utf8')).find(
    (note) => note.title === '粘贴与撤销',
  )
  assert.match(pasted.text, /# 粘贴标题/)
  assert.match(pasted.text, /新增文字/)

  await page.getByRole('button', { name: '指令与记忆', exact: true }).click()
  await fillMarkdown(page, 'instructions', '## 长期指令\n\n使用 **中文** 回答。')
  await fillMarkdown(page, 'memory', '# 记忆\n\n公式 $x^2$')
  await expect(page.locator('#instructions strong')).toHaveText('中文')
  await expect(page.locator('#memory .katex')).toHaveCount(1)
  await page.getByRole('button', { name: '保存指令', exact: true }).click()
  await page.getByRole('button', { name: '保存记忆', exact: true }).click()
  await page.getByText('模型记忆已保存', { exact: true }).waitFor()
  // A source edit can immediately be saved without changing modes or blurring.
  const source = await markdownMode(page, 'instructions', 'sv')
  await source.fill('最后一笔即刻保存')
  await page.getByRole('button', { name: '保存指令', exact: true }).click()
  await expect
    .poll(async () =>
      JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8')).instructions.trim(),
    )
    .toBe('最后一笔即刻保存')
  assert.deepEqual(requests, [], 'Editor resources must work offline')
  assert.deepEqual(errors, [], 'No runtime or CSP errors')
  console.log(
    JSON.stringify({
      ok: true,
      root,
      checks:
        'GFM, math, source, preview, tasks, persistence, IME, immediate save, instructions, memory, offline assets, CSP',
    }),
  )
} finally {
  await application.close()
}
