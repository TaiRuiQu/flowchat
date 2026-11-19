import { _electron as electron } from 'playwright'
import { expect } from 'playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fillMarkdown } from './markdown-editor-helpers.mjs'

const root = path.resolve('.artifacts/electron-qa', randomUUID())
await mkdir(root, { recursive: true })
await mkdir(path.join(root, 'data'), { recursive: true })
await writeFile(
  path.join(root, 'data/settings.json'),
  JSON.stringify({
    codexPath: path.join(root, 'missing-codex.exe'),
    claudePath: path.join(root, 'missing-claude.exe'),
    openCodePath: path.join(root, 'missing-opencode.exe'),
  }),
)
const application = await electron.launch({
  args: ['.', `--user-data-dir=${path.join(root, 'profile-main')}`],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    FLOWCHAT_DATA_DIR: path.join(root, 'data'),
  },
})
const page = await application.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.getByRole('heading', { name: '今天想探索什么？' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.ok(
    await page.evaluate(() =>
      ['Geist Sans', 'HarmonyOS Sans SC'].every((family) =>
        [...document.fonts].some((font) => font.family === family && font.status === 'loaded'),
      ),
    ),
  )
  await page.screenshot({ path: path.join(root, '01-welcome.png') })
  const divider = page.getByRole('separator', { name: '调整侧边栏宽度' })
  const dividerBox = await divider.boundingBox()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, 250)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2 + 46, 250, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().width === 310,
  )
  const toggleGap = await page.evaluate(
    () =>
      document.querySelector('.sidebar').getBoundingClientRect().right -
      document.querySelector('.sidebar-toggle').getBoundingClientRect().right,
  )
  assert.equal(toggleGap, 24)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.getByRole('button', { name: '发送问题', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: /用生活例子解释贝叶斯定理/ }).click()
  assert.match(await page.locator('#composer').inputValue(), /贝叶斯/)
  await page.locator('#composer').fill('这是一份跨页面保存的草稿')
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.locator('#note-title').fill('阅读与思考')
  await fillMarkdown(
    page,
    'note-text',
    '## 我的第一篇笔记\n\n- 理解概念\n- 连接知识\n\n**保持好奇。**',
  )
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await page.getByRole('heading', { name: '阅读与思考', exact: true }).waitFor()
  await page.screenshot({ path: path.join(root, '02-notes.png') })
  await page.getByRole('button', { name: '指令与记忆', exact: true }).click()
  await fillMarkdown(page, 'instructions', '请用直观的中文解释，并给出一个实际例子。')
  await page.getByRole('button', { name: '保存指令', exact: true }).click()
  await page.getByRole('switch', { name: '启用用户指令' }).click()
  await page.getByRole('switch', { name: '启用用户指令' }).waitFor()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.screenshot({ path: path.join(root, '03-settings-dark.png') })
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.getByRole('button', { name: '搜索对话', exact: true }).click()
  assert.ok(
    await page.locator('.window-close').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return document
        .elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        ?.classList.contains('dialog-overlay')
    }),
  )
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  assert.equal(await page.locator('#composer').inputValue(), '这是一份跨页面保存的草稿')
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: '搜索会话标题' }).fill('没有这段对话')
  await page.getByText('没有找到相关对话，试试其他关键词。').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('#composer').fill('重启后仍然在这里')
  await page.waitForTimeout(700)
  assert.equal(await page.locator('.window-controls button').count(), 3)
  assert.equal(await page.locator('.sidebar-toggle').count(), 1)
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  await page.getByRole('button', { name: '展开导航', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.app-shell').classList.contains('sidebar-open'),
  )
  assert.equal(await page.getByRole('button', { name: '脉络', exact: true }).count(), 0)
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(520, 800),
  )
  await page.waitForFunction(
    () => !document.querySelector('.app-shell').classList.contains('sidebar-open'),
  )
  await page.waitForTimeout(300)
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  )
  await page.screenshot({ path: path.join(root, '05-compact.png') })
  await page.getByRole('button', { name: '展开导航' }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.screenshot({ path: path.join(root, '06-settings-compact.png') })
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: '展开导航' }).click()
  await page.getByRole('button', { name: '搜索对话', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索会话标题' }).fill('')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.locator('#composer').fill('退出瞬间也会保存的草稿')
  await page.evaluate(() => window.flowchat.window('close'))
  await application.close()
  const settings = JSON.parse(await readFile(path.join(root, 'data/settings.json'), 'utf8'))
  assert.equal(settings.instructions.trimEnd(), '请用直观的中文解释，并给出一个实际例子。')
  assert.equal(settings.instructionsEnabled, false)
  assert.equal(settings.memoryEnabled, true)
  assert.equal(settings.sidebarWidth, 310)
  const restart = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile-restart')}`],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      FLOWCHAT_DATA_DIR: path.join(root, 'data'),
    },
  })
  try {
    const reopened = await restart.firstWindow()
    await reopened.locator('#composer').waitFor()
    await expect(reopened.locator('#composer')).toHaveValue('退出瞬间也会保存的草稿')
    await reopened.getByRole('button', { name: '展开导航', exact: true }).click()
    await reopened.waitForFunction(
      () => document.querySelector('.sidebar').getBoundingClientRect().width === 310,
    )
    assert.equal(
      await reopened
        .locator('.sidebar')
        .evaluate((element) => element.getBoundingClientRect().width),
      310,
    )
  } finally {
    await restart.close()
  }

  // A separate workspace and a local Node mock exercise the real renderer -> IPC -> CLI path.
  // No production tool is invoked and no model credits are consumed.
  const offlineData = path.join(root, 'offline-data')
  await mkdir(path.join(offlineData, 'harness'), { recursive: true })
  await writeFile(
    path.join(offlineData, 'settings.json'),
    JSON.stringify({
      version: 2,
      theme: 'Light',
      codexPath: process.execPath,
      claudePath: process.execPath,
      openCodePath: path.join(root, 'missing-opencode.exe'),
      windowWidth: 1440,
      windowHeight: 960,
    }),
  )
  let answer =
    '## 理解，从一个好问题开始\n\n好的问题，会把模糊的好奇心变成清晰的探索方向。你不必一次问对，可以沿着回答里的一个概念，继续深入。\n\n### 给思考留出分支\n\n- **先建立直觉**：用熟悉的例子理解陌生的概念。\n- **再追问原因**：找到结论背后的逻辑。\n- **连接已有知识**：让零散的知识形成结构。\n\n> 理解不是记住答案，而是知道下一个问题在哪里。\n\n| 提问方式 | 思考方向 |\n| --- | --- |\n| 这是什么？ | 建立定义 |\n| 为什么会这样？ | 理解原理 |\n| 还可以怎样看？ | 拓展视角 |\n\n```ts\nconst curiosity = { question: "为什么？", branches: [] }\n```'
  answer += String.raw`

行内公式：$a^2+b^2=c^2$，以及 \(E=mc^2\)。

$$
\frac{1}{2}+\frac{1}{2}=1
$$

\[
\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]
`
  await writeFile(
    path.join(offlineData, 'harness/app-server'),
    `
    import readline from 'node:readline';
    import fs from 'node:fs';
    const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line); if (!m.id) return;
      const result = m.method === 'model/list' ? { data: [{ model: 'offline-model', displayName: '离线模型', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(reasoningEffort => ({ reasoningEffort })), defaultReasoningEffort: 'medium' }, { model: 'fast-model', displayName: '快速模型' }] } : m.method.startsWith('thread/') ? { thread: { id: 'ui-offline-session' } } : {};
      emit({ id: m.id, result });
      if (m.method === 'thread/start') fs.appendFileSync('models.jsonl', JSON.stringify(m) + '\\n');
      if (m.method !== 'turn/start') return;
      const prompt = m.params.input[0].text;
      fs.appendFileSync('requests.jsonl', JSON.stringify(m) + '\\n');
      if (prompt.startsWith('测试失败') && !fs.existsSync('retry.flag')) {
        fs.writeFileSync('retry.flag', '1');
        emit({ method: 'turn/completed', params: { threadId: 'ui-offline-session', turn: { status: 'failed', error: { message: '离线模拟连接失败' } } } }); return;
      }
      const text = prompt.startsWith('测试停止') ? '这是一段用于验证停止操作的离线模拟回答。'.repeat(500) : ${JSON.stringify(answer)};
      let offset = 0;
      const timer = setInterval(() => {
        const delta = text.slice(offset, offset + 70); offset += 70;
        emit({ method: 'item/agentMessage/delta', params: { threadId: 'ui-offline-session', itemId: 'a', delta } });
        if (offset >= text.length) { clearInterval(timer); emit({ method: 'turn/completed', params: { threadId: 'ui-offline-session', turn: { status: 'completed' } } }); }
      }, 60);
    });
  `,
  )
  const offline = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile-offline')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: offlineData },
  })
  try {
    const view = await offline.firstWindow()
    view.on('pageerror', (error) => errors.push(error.message))
    const modelPicker = view.getByRole('combobox', { name: '选择 Codex 模型', exact: true })
    await view.waitForFunction(() =>
      document.querySelector('[aria-label="选择 Codex 模型"]')?.textContent.includes('离线模型'),
    )
    await modelPicker.click()
    assert.equal(await view.getByRole('option', { name: '默认模型', exact: true }).count(), 0)
    await view.getByRole('option', { name: '快速模型', exact: true }).click()
    await expect(modelPicker).toHaveText('快速模型')
    const assertControlHasNoOutline = async (control) => {
      await view.mouse.move(1300, 100)
      await view.waitForFunction(
        (element) => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)',
        await control.elementHandle(),
      )
      const focusStyle = await control.evaluate((element) => {
        const style = getComputedStyle(element)
        return { outline: style.outlineStyle, shadow: style.boxShadow }
      })
      assert.equal(focusStyle.outline, 'none')
      assert.equal(focusStyle.shadow, 'none')
    }
    await assertControlHasNoOutline(modelPicker)
    assert.equal(await view.getByRole('combobox', { name: /^推理强度：/ }).count(), 0)
    await modelPicker.click()
    await view.getByRole('option', { name: '离线模型', exact: true }).click()
    await expect(modelPicker).toHaveText('离线模型')
    assert.equal(await view.getByRole('slider', { name: '推理强度' }).count(), 0)
    const reasoningTrigger = view.locator('.reasoning-trigger')
    for (const label of ['低', '中', '高', '超高', '最高']) {
      await reasoningTrigger.click()
      await view.getByRole('option', { name: label, exact: true }).click()
      await view.getByRole('combobox', { name: `推理强度：${label}`, exact: true }).waitFor()
    }
    await reasoningTrigger.focus()
    await view.keyboard.press('ArrowDown')
    await view.getByRole('listbox').waitFor()
    await view.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
    await view.keyboard.press('Home')
    await view.waitForFunction(() => document.activeElement?.textContent === '低')
    await view.keyboard.press('Enter')
    await view.getByRole('combobox', { name: '推理强度：低', exact: true }).waitFor()
    await reasoningTrigger.click()
    await view.getByRole('option', { name: '最高', exact: true }).click()
    await assertControlHasNoOutline(reasoningTrigger)
    assert.equal(await view.getByRole('button', { name: '查看指令与记忆' }).count(), 0)
    const enginePicker = view.getByRole('combobox', { name: '选择模型来源', exact: true })
    await enginePicker.click()
    await view.getByRole('option', { name: 'Claude', exact: true }).click()
    const claudePicker = view.getByRole('combobox', { name: '选择 Claude Code 模型', exact: true })
    await view.waitForFunction(() =>
      document.querySelector('[aria-label="选择 Claude Code 模型"]')?.textContent.includes('Opus'),
    )
    await claudePicker.click()
    await view.getByRole('option', { name: 'Sonnet', exact: true }).click()
    await expect(claudePicker).toHaveText('Sonnet')
    await enginePicker.click()
    await view.getByRole('option', { name: 'ChatGPT', exact: true }).click()
    await expect(modelPicker).toHaveText('离线模型')
    await expect(view.getByRole('combobox', { name: '推理强度：最高', exact: true })).toHaveCount(1)
    await enginePicker.click()
    await view.getByRole('option', { name: 'Claude', exact: true }).click()
    await expect(claudePicker).toHaveText('Sonnet')
    await enginePicker.click()
    await view.getByRole('option', { name: 'ChatGPT', exact: true }).click()
    await reasoningTrigger.click()
    await view.getByRole('listbox').waitFor()
    await view.screenshot({ path: path.join(root, '07-model-controls.png') })
    await view.getByRole('listbox').screenshot({ path: path.join(root, 'reasoning-dropdown.png') })
    await view.keyboard.press('Escape')
    await view.getByRole('listbox').waitFor({ state: 'hidden' })
    await assertControlHasNoOutline(reasoningTrigger)
    assert.equal(
      await view
        .locator('.composer')
        .evaluate(
          (element) =>
            getComputedStyle(element).borderColor ===
            getComputedStyle(document.querySelector('.sidebar')).borderRightColor,
        ),
      true,
    )
    await view.locator('#composer').fill('为什么说好的问题，是理解的开始？')
    await view.keyboard.press('Control+Enter')
    assert.match(await view.locator('#composer').inputValue(), /开始？\n$/)
    await view.keyboard.press('Shift+Enter')
    assert.match(await view.locator('#composer').inputValue(), /开始？\n\n$/)
    await view.keyboard.press('Enter')
    await view.getByRole('button', { name: '停止生成', exact: true }).waitFor()
    await view.getByRole('button', { name: '追问', exact: true }).waitFor()
    assert.equal(await view.locator('.question-bubble').count(), 1)
    assert.equal(await view.getByText('内容由 AI 生成，请独立判断', { exact: true }).count(), 0)
    assert.ok(
      await view
        .locator('.question-bubble')
        .evaluate((element) => getComputedStyle(element).borderRadius !== '0px'),
    )
    await view.locator('.messages-scroll').evaluate((el) => {
      el.scrollTop = 0
    })
    await view.screenshot({ path: path.join(root, '07-conversation.png') })
    assert.equal(await view.locator('.markdown table').count(), 1)
    assert.equal(await view.locator('.code-block').count(), 1)
    assert.ok((await view.locator('.code-block .hljs-keyword').count()) > 0)
    assert.equal(await view.locator('.code-bar > span').textContent(), 'ts')
    assert.equal(await view.locator('.katex').count(), 4)
    assert.equal(await view.locator('.katex-display').count(), 2)
    assert.equal(await view.locator('.katex-error').count(), 0)
    const quoteSpacing = await view
      .locator('.markdown blockquote')
      .first()
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return [
          element.firstElementChild.getBoundingClientRect().top - bounds.top,
          bounds.bottom - element.lastElementChild.getBoundingClientRect().bottom,
        ]
      })
    assert.ok(Math.abs(quoteSpacing[0] - quoteSpacing[1]) < 1)
    await view.locator('.katex-display').first().scrollIntoViewIfNeeded()
    await view.screenshot({ path: path.join(root, '07-math-and-code.png') })
    const lightCodeColor = await view
      .locator('.hljs-keyword')
      .first()
      .evaluate((element) => getComputedStyle(element).color)
    await view.evaluate(() => document.fonts.ready)
    assert.ok(
      await view.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family === 'Geist Mono' && font.status === 'loaded',
        ),
      ),
    )
    await view.locator('.history-item').first().click({ button: 'right' })
    await view.getByRole('menuitem', { name: '查看上下文', exact: true }).click()
    await view.getByText('当前上下文', { exact: true }).waitFor()
    await view.getByRole('button', { name: '关闭侧面板', exact: true }).click()
    await view.evaluate(() => {
      const formula = document.querySelector('.answer .katex-display')
      const range = document.createRange()
      // Start inside the inline formula's glyphs to cover partial selections.
      range.setStart(document.querySelector('.answer p .katex-html'), 0)
      range.setEndAfter(formula)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await view.getByRole('button', { name: '追问选中文字', exact: true }).click()
    assert.equal(
      await view
        .getByText('沿着这段回答，展开新的思路')
        .locator('xpath=..')
        .locator('p')
        .textContent(),
      '$a^2+b^2=c^2$，以及 $E=mc^2$。\n\n$$\\frac{1}{2}+\\frac{1}{2}=1$$',
    )
    await view.getByRole('button', { name: '取消追问', exact: true }).click()
    await view.evaluate(() => {
      const paragraph = document.querySelector('.answer .markdown p')
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const selected = getSelection()
      selected.removeAllRanges()
      selected.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await view.getByRole('button', { name: '追问选中文字', exact: true }).click()
    await view.locator('#composer').fill('如何把一个大问题拆成可以探索的小问题？')
    await view.screenshot({ path: path.join(root, '08-quote.png') })
    await view.getByRole('button', { name: '发送问题', exact: true }).click()
    await view.getByRole('button', { name: '返回上层对话', exact: true }).waitFor()
    await view.getByRole('button', { name: '追问', exact: true }).waitFor()
    await view.getByRole('button', { name: /^脉络/ }).click()
    await view.getByText('对话脉络', { exact: true }).waitFor()
    assert.equal(await view.locator('.branch-node').count(), 2)
    const branchBounds = await view
      .locator('.branch-node')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right))
    assert.ok(Math.abs(branchBounds[0] - branchBounds[1]) < 1)
    assert.equal(
      await view
        .locator('.branch-tree')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
    )
    await view.waitForTimeout(260)
    await view.locator('.messages-scroll').evaluate((el) => {
      el.scrollTop = 0
    })
    await view.screenshot({ path: path.join(root, '09-branch.png') })
    const requests = (await readFile(path.join(offlineData, 'harness/requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse)
    assert.match(requests[1].params.input[0].text, /为什么说好的问题/)
    assert.match(requests[1].params.input[0].text, /针对这段内容追问/)
    const modelRequests = (await readFile(path.join(offlineData, 'harness/models.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse)
    assert.equal(modelRequests[0].params.model, 'offline-model')
    assert.equal(requests[0].params.effort, 'max')
    await view.getByRole('button', { name: '返回上层对话', exact: true }).click()
    await view
      .locator('.question-bubble')
      .filter({ hasText: '为什么说好的问题，是理解的开始？' })
      .first()
      .waitFor()
    await view.getByRole('button', { name: '关闭侧面板', exact: true }).click()
    await view.locator('#composer').fill('测试失败')
    await view.getByRole('button', { name: '发送问题', exact: true }).click()
    await view.getByText('离线模拟连接失败', { exact: true }).waitFor()
    await view.getByRole('button', { name: '重试', exact: true }).click()
    await view.waitForFunction(() => document.querySelectorAll('.answer-actions').length === 2)
    await view.locator('#composer').fill('测试停止')
    await view.getByRole('button', { name: '发送问题', exact: true }).click()
    await view.locator('.history-item.active .history-spinner').waitFor()
    await view.getByRole('button', { name: '停止生成', exact: true }).click()
    await view.getByText('已停止生成，可以重试。', { exact: true }).waitFor()
    assert.equal(await view.locator('.history-spinner').count(), 0)
    await view.getByRole('button', { name: '设置', exact: true }).click()
    await view.getByRole('button', { name: '深色', exact: true }).click()
    await view.getByRole('button', { name: '搜索对话', exact: true }).click()
    await view
      .getByRole('button', { name: '为什么说好的问题，是理解的开始？', exact: true })
      .click()
    await view.locator('#composer').waitFor()
    const darkCodeColor = await view
      .locator('.hljs-keyword')
      .first()
      .evaluate((element) => getComputedStyle(element).color)
    assert.notEqual(lightCodeColor, darkCodeColor)
    await view.screenshot({ path: path.join(root, '10-conversation-dark.png') })
    await view.emulateMedia({ reducedMotion: 'reduce' })
    assert.ok(
      await view.evaluate(
        () =>
          parseFloat(getComputedStyle(document.querySelector('.send-button')).transitionDuration) <
          0.01,
      ),
    )
  } finally {
    await offline.close()
  }
  const restoredOffline = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile-offline-restart')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: offlineData },
  })
  try {
    const restored = await restoredOffline.firstWindow()
    await restored.waitForFunction(() =>
      document.querySelector('[aria-label="选择 Codex 模型"]')?.textContent.includes('离线模型'),
    )
    assert.equal(
      await restored.getByRole('combobox', { name: '推理强度：最高', exact: true }).count(),
      1,
    )
    const restoredEngine = restored.getByRole('combobox', { name: '选择模型来源', exact: true })
    await restoredEngine.click()
    await restored.getByRole('option', { name: 'Claude', exact: true }).click()
    await restored.waitForFunction(() =>
      document
        .querySelector('[aria-label="选择 Claude Code 模型"]')
        ?.textContent.includes('Sonnet'),
    )
  } finally {
    await restoredOffline.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        errors,
        checks: [
          'Electron isolation',
          'empty state',
          'prompt starter',
          'draft navigation',
          'notes',
          'memory',
          'theme',
          'search',
          'outline',
          'compact layout',
          'restart persistence',
          'resizable sidebar and toggle spacing',
          'first model fallback and per-harness persistence',
          'per-model reasoning controls and request effort',
          'theme-aware syntax highlighting',
          'dollar and backslash LaTeX delimiters',
          'aligned branch hover without horizontal overflow',
          'symmetric blockquote spacing',
          'reasoning dropdown keyboard controls',
          'composer controls restore focus without outline rings',
          'closed composer selectors have no lingering focus background',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`Electron UI checks passed. Screenshots: ${root}`)
} finally {
  await application.close().catch(() => {})
}
