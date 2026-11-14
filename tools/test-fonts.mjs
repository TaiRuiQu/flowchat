import { _electron as electron, expect } from 'playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fillMarkdown } from './markdown-editor-helpers.mjs'

const root = path.resolve('.artifacts/font-qa', randomUUID())
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
const app = await electron.launch({
  args: ['.', `--user-data-dir=${path.join(root, 'profile')}`],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
const results = []
try {
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.locator('#note-title').fill('字体检查 · 正体 / 斜体 / 粗斜体')
  await fillMarkdown(
    page,
    'note-text',
    'Normal Latin — Italy\n\n*Italic Latin — Italy*\n\n***Bold Italic — Italy***\n\n' +
      '中文正体：这是字体效果\n\n*中文斜体：这是字体效果*\n\n***中文粗斜体：这是字体效果***\n\n' +
      'Normal code: `const answer = 42`\n\n*`Italic code: const answer = 42`*',
  )
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const check = async (rootSelector, name, text, family, style, weight, fontPattern) => {
    const element = page
      .locator(rootSelector)
      .locator('em, strong, code, p')
      .filter({ hasText: text })
      .last()
    await element.evaluate((node, name) => node.setAttribute('data-font-probe', name), name)
    await expect(element).toHaveCSS('font-style', style)
    await expect(element).toHaveCSS('font-weight', weight)
    await page.evaluate(() => document.fonts.ready)
    const computed = await element.evaluate((node) => {
      const css = getComputedStyle(node)
      return { family: css.fontFamily, synthesis: css.fontSynthesis }
    })
    assert.ok(computed.family.includes(family), `${name}: ${computed.family}`)
    assert.equal(computed.synthesis, 'style')
    const { root: dom } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: dom.nodeId,
      selector: `[data-font-probe="${name}"]`,
    })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    assert.ok(
      fonts.some((font) => font.isCustomFont && fontPattern.test(font.postScriptName)),
      `${name}: ${JSON.stringify(fonts)}`,
    )
    results.push({ name, computed, fonts })
  }
  for (const [mode, selector] of [
    ['editor', '#note-text'],
    ['preview', '.note-document-preview .markdown'],
  ]) {
    if (mode === 'preview') await page.getByRole('button', { name: '预览', exact: true }).click()
    await check(
      selector,
      `${mode}-latin`,
      'Italic Latin',
      'Geist Sans',
      'italic',
      '400',
      /Geist.*Italic/i,
    )
    await check(
      selector,
      `${mode}-bold-italic`,
      'Bold Italic',
      'Geist Sans',
      'italic',
      mode === 'preview' ? '600' : '700',
      /Geist.*Italic/i,
    )
    await check(
      selector,
      `${mode}-cjk`,
      '中文斜体',
      'HarmonyOS Sans SC',
      'italic',
      '400',
      /HarmonyOS/i,
    )
    await check(
      selector,
      `${mode}-mono`,
      'Italic code:',
      'Geist Mono',
      'italic',
      '400',
      /GeistMono.*Italic/i,
    )
    await page.screenshot({ path: path.join(root, `${mode}-fonts.png`) })
  }
  const faces = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.style === 'italic' && face.status === 'loaded')
      .map((face) => face.family),
  )
  assert.ok(faces.includes('Geist Sans') && faces.includes('Geist Mono'))
  // Both italic assets must be present in the production output, byte for byte.
  const { readdir } = await import('node:fs/promises')
  const built = await readdir(path.resolve('dist/assets'))
  for (const name of ['Geist-Italic-Variable', 'GeistMono-Italic-Variable']) {
    const asset = built.find((file) => file.startsWith(`${name}-`) && file.endsWith('.woff2'))
    assert.ok(asset, `Missing bundled font: ${name}`)
    assert.deepEqual(
      await readFile(path.resolve('dist/assets', asset)),
      await readFile(path.resolve('src/renderer/assets/fonts', `${name}.woff2`)),
    )
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'report.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ ok: true, root, checks: results.map((result) => result.name) }))
} finally {
  await app.close()
}
