import { _electron as electron } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

const reportOnly = process.argv.includes('--report-only')
const root = path.resolve('.artifacts/layout-qa', randomUUID())
const data = path.join(root, 'data')
const uid = () => randomUUID().replaceAll('-', '')
const emptyId = uid(),
  chatId = uid(),
  archivedId = uid(),
  branchId = uid(),
  turnId = uid()
const now = new Date().toISOString()
await mkdir(path.join(data, 'conversations'), { recursive: true })
await mkdir(path.join(data, 'harness'), { recursive: true })
const baseBranch = {
  id: branchId,
  title: '物理学习与文件实践',
  engine: 'Codex',
  quote: '',
  inheritedTurns: [],
  draft: '',
}
const quote = '物理研究物质和运动。通过日常例子可以建立直观理解。'
const complete = {
  id: turnId,
  question: '如何通过日常例子理解物理？',
  answer: `${quote}\n\n## 从观察开始\n\n记录问题、提出假设，再通过实验检验。\n\n- 观察自行车的加速\n- 对比不同物体的运动\n\n> 用自己的语言重述，比记住术语更重要。`,
  status: 'Complete',
  createdAt: now,
}
const chats = [
  {
    version: 2,
    id: emptyId,
    title: '新对话',
    updatedAt: now,
    activeBranchId: branchId,
    branches: [{ ...baseBranch, turns: [] }],
  },
  {
    version: 2,
    id: chatId,
    title: baseBranch.title,
    updatedAt: now,
    activeBranchId: branchId,
    branches: [{ ...baseBranch, turns: [complete] }],
  },
  {
    version: 2,
    id: archivedId,
    title: '从日常观察到理论推导：整理关于物理、数学与长期学习习惯的探索记录',
    updatedAt: now,
    archived: true,
    activeBranchId: branchId,
    branches: [{ ...baseBranch, turns: [complete] }],
  },
]
for (const chat of chats)
  await writeFile(path.join(data, 'conversations', `${chat.id}.json`), JSON.stringify(chat))
await writeFile(
  path.join(data, 'index.json'),
  JSON.stringify(
    chats.map(({ id, title, updatedAt, archived }) => ({ id, title, updatedAt, archived })),
  ),
)
await writeFile(
  path.join(data, 'notes.json'),
  JSON.stringify([
    {
      id: uid(),
      title: '我对物理的理解',
      text: '## 我的理解\n\n先建立直觉，再联系定义与公式。\n\n**思考：** 用日常观察检验自己的理解。',
      quote,
      conversationId: chatId,
      branchId,
      turnId,
      updatedAt: now,
    },
  ]),
)
await writeFile(
  path.join(data, 'harness/memory.md'),
  '# 模型记忆\n\n用户正在学习物理，喜欢通过日常例子理解抽象概念。',
)
await writeFile(
  path.join(data, 'settings.json'),
  JSON.stringify({
    lastConversationId: emptyId,
    codexPath: process.execPath,
    claudePath: path.join(root, 'missing-claude.exe'),
    openCodePath: path.join(root, 'missing-opencode.exe'),
    instructions: '请使用中文。解释新概念时先给直观理解，再给定义；引用我的观点时保留原意。',
    instructionsEnabled: true,
    memoryEnabled: true,
    titleGeneration: {
      enabled: true,
      source: 'api',
      engine: 'Codex',
      modelId: 'offline-model',
      providerId: '',
      api: { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'title-model' },
    },
    speech: {
      enabled: true,
      asr: { baseUrl: 'https://speech.example.com/v1', apiKey: '', model: 'transcription-model' },
      tts: {
        baseUrl: 'https://speech.example.com/v1',
        apiKey: '',
        model: 'speech-model',
        voice: 'alloy',
        speed: 1,
      },
    },
  }),
)
await writeFile(
  path.join(data, 'harness/app-server'),
  `
import readline from 'node:readline';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(!m.id)return;
  emit({id:m.id,result:m.method==='model/list'?{data:[{model:'offline-model',displayName:'GPT-6.1-Sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'medium'}]}:m.method.startsWith('thread/')?{thread:{id:'layout-session'}}:{}});
  if(m.method==='turn/start'){
    emit({method:'item/agentMessage/delta',params:{threadId:'layout-session',itemId:'a',delta:'## 我的理解\\n\\n先建立直觉，再联系定义与公式。\\n\\n### 日常例子\\n\\n骑车加速时，我们可以感受力与运动状态变化的关系。'}});
    setTimeout(()=>emit({method:'turn/completed',params:{threadId:'layout-session',turn:{status:'completed'}}}), m.params.input[0].text.includes('测试等待协作') ? 3000 : 50);
  }
});`,
)
const measurements = [],
  errors = []
let app
try {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('#composer').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    )
    await page.waitForTimeout(100)
  }
  const navigate = async (name) => {
    const sidebar = page.getByRole('complementary', { name: '主导航' })
    if ((await sidebar.getAttribute('inert')) !== null)
      await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await sidebar.locator('.rail-nav').filter({ hasText: name }).click()
    await page.getByRole('heading', { name, exact: true }).waitFor()
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('.utility-scroll')).opacity === '1',
    )
  }
  const home = async () => {
    await page.evaluate((id) => window.flowchat.command({ type: 'load', id }), emptyId)
    const sidebar = page.getByRole('complementary', { name: '主导航' })
    if ((await sidebar.getAttribute('inert')) !== null)
      await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await page.locator('.history-item', { hasText: '新对话' }).click()
    await page.locator('.welcome').waitFor()
  }
  const shot = async (name) => {
    await page.waitForTimeout(60)
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const bounds = element.getBoundingClientRect()
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          bottom: bounds.bottom,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }
      }
      const visible = (element) =>
        !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
      const overflowing = [
        ...document.querySelectorAll(
          '.utility-page, .integration-form, .api-fields, .provider-setting, .provider-dialog, .note-dialog, .memory-footer, .setting-row, .composer-region, .workspace-menu',
        ),
      ]
        .filter((element) => visible(element) && element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          className: element.className,
          scroll: element.scrollWidth,
          client: element.clientWidth,
        }))
      const footer = document.querySelector('.note-dialog .note-save-button')
      const title = document.querySelector('.note-dialog .dialog-heading')
      const dialog = document.querySelector('.note-dialog')?.getBoundingClientRect()
      const footerRect = footer?.getBoundingClientRect(),
        titleRect = title?.getBoundingClientRect()
      const providerDialog = document.querySelector('.provider-dialog')?.getBoundingClientRect()
      const providerSave = document
        .querySelector('.provider-dialog [type="submit"]')
        ?.getBoundingClientRect()
      return {
        viewport: { width: innerWidth, height: innerHeight },
        composer: rect('.composer'),
        workspace: rect('.workspace-trigger'),
        welcome: rect('.welcome'),
        starters: rect('.starter-grid'),
        utility: rect('.utility-page'),
        overflowing,
        provider: providerDialog
          ? {
              saveVisible:
                providerSave.top >= providerDialog.top &&
                providerSave.bottom <= providerDialog.bottom,
              withinViewport: providerDialog.top >= 0 && providerDialog.bottom <= innerHeight,
            }
          : null,
        starterInsets: [...document.querySelectorAll('.starter-card')].map(
          (card) =>
            card.querySelector('h3').getBoundingClientRect().top - card.getBoundingClientRect().top,
        ),
        clippedComposerControls: [...document.querySelectorAll('.composer-options > button')]
          .filter((button) => {
            const bounds = button.getBoundingClientRect(),
              parent = button.parentElement.getBoundingClientRect()
            return (
              bounds.x < parent.x - 1 ||
              bounds.right > parent.right + 1 ||
              bounds.top < parent.top - 1 ||
              bounds.bottom > parent.bottom + 1
            )
          })
          .map((button) => button.getAttribute('aria-label')),
        note: dialog
          ? {
              saveVisible: footerRect.top >= dialog.top && footerRect.bottom <= dialog.bottom,
              headingVisible: titleRect.top >= dialog.top && titleRect.bottom <= dialog.bottom,
              dialog: rect('.note-dialog'),
            }
          : null,
      }
    })
    measurements.push({ name, ...metrics })
    await page.screenshot({ path: path.join(root, `${name}.png`) })
    if (!reportOnly) {
      assert.deepEqual(metrics.overflowing, [], `${name}: unexpected horizontal overflow`)
      if (metrics.provider) {
        assert.ok(
          metrics.provider.saveVisible,
          `${name}: provider confirm action must remain visible`,
        )
        assert.ok(metrics.provider.withinViewport, `${name}: provider dialog must fit the viewport`)
      }
      assert.deepEqual(
        metrics.clippedComposerControls,
        [],
        `${name}: composer controls must remain visible`,
      )
      if (metrics.starterInsets.length)
        assert.ok(
          Math.max(...metrics.starterInsets) - Math.min(...metrics.starterInsets) <= 1,
          `${name}: starter card headings must align`,
        )
      if (metrics.composer && metrics.workspace && !metrics.note) {
        assert.ok(
          metrics.workspace.x >= metrics.composer.x &&
            metrics.workspace.right <= metrics.composer.right &&
            metrics.workspace.y >= metrics.composer.y &&
            metrics.workspace.bottom <= metrics.composer.bottom,
          `${name}: workspace selector must remain inside composer`,
        )
        if (metrics.welcome) {
          assert.ok(
            Math.abs(metrics.composer.x - metrics.welcome.x) <= 1,
            `${name}: welcome must align with composer`,
          )
          assert.ok(
            Math.abs(metrics.composer.width - metrics.starters.width) <= 1,
            `${name}: starter cards must align with composer`,
          )
        }
      }
      if (metrics.note) {
        assert.ok(metrics.note.saveVisible, `${name}: note save actions must remain visible`)
        assert.ok(metrics.note.headingVisible, `${name}: note heading must remain visible`)
      }
    }
  }
  const scrollTo = async (selector) =>
    page.evaluate((selector) => {
      const element = document.querySelector(selector),
        scroller = document.querySelector('.utility-scroll')
      scroller.scrollTop +=
        element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24
    }, selector)
  for (const [label, width, height] of [
    ['wide', 1600, 1200],
    ['desktop', 1440, 960],
    ['medium', 1100, 800],
    ['narrow', 520, 800],
    ['minimum', 420, 640],
  ]) {
    await resize(width, height)
    await home()
    await shot(`${label}-home`)
  }
  for (const [label, width, height] of [
    ['desktop', 1440, 960],
    ['narrow', 520, 800],
    ['minimum', 420, 640],
  ]) {
    await resize(width, height)
    await navigate('指令与记忆')
    await shot(`${label}-instructions`)
    await scrollTo('#memory')
    await shot(`${label}-memory`)
    await navigate('设置')
    await shot(`${label}-settings-tools`)
    await scrollTo('[aria-label="自动生成对话标题"]')
    await shot(`${label}-settings-title`)
    await page.getByRole('switch', { name: '自动生成对话标题' }).click()
    await shot(`${label}-settings-title-pending`)
    await page.getByRole('switch', { name: '自动生成对话标题' }).click()
    await scrollTo('#asr-provider')
    await shot(`${label}-settings-speech`)
    for (const id of ['title-api', 'asr', 'tts']) {
      await page.locator(`#${id}-provider button`).click()
      await page.getByRole('dialog').waitFor()
      await shot(`${label}-settings-${id}-dialog`)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    }
    await scrollTo('.archive-list')
    await shot(`${label}-settings-archive`)
    await navigate('我的笔记')
    await shot(`${label}-notes`)
    await page.locator('.note-body').first().click()
    await page.getByRole('dialog').waitFor()
    await shot(`${label}-note-editor`)
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await shot(`${label}-note-preview`)
    await page.getByRole('button', { name: '写作', exact: true }).click()
    if (width <= 760) await page.getByRole('tab', { name: '一起编辑' }).click()
    await page.getByRole('combobox', { name: '笔记协作工具' }).click()
    await page.getByRole('listbox').waitFor()
    const pickerAboveOverlay = await page.getByRole('listbox').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 12))
    })
    if (!reportOnly)
      assert.equal(
        pickerAboveOverlay,
        true,
        `${label}: note tool picker must appear above the dialog overlay`,
      )
    await shot(`${label}-note-tool-picker`)
    await page.keyboard.press('Escape')
    if (width <= 760) await page.getByRole('tab', { name: '一起编辑' }).click()
    await page.locator('#note-instruction').fill('保留我的理解，补充一个日常例子。')
    await page.getByRole('button', { name: '生成修改建议' }).click()
    await page.getByRole('button', { name: '采纳到笔记' }).waitFor()
    await shot(`${label}-note-suggestion`)
    if (width <= 760) await page.getByRole('tab', { name: '笔记', exact: true }).click()
    await page.locator('#note-text').fill('这段新写下的想法还没有保存。')
    if (width <= 760) await page.getByRole('tab', { name: '一起编辑' }).click()
    await page.getByRole('button', { name: '基于最新正文重写', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '采纳到笔记', exact: true }).count(), 0)
    await shot(`${label}-note-stale-suggestion`)
    await page.getByRole('button', { name: '基于最新正文重写', exact: true }).click()
    await page.getByRole('button', { name: '采纳到笔记' }).waitFor()
    await page.getByRole('button', { name: '放弃建议', exact: true }).click()
    if (width <= 760) await page.getByRole('tab', { name: '笔记', exact: true }).click()
    await page.getByRole('button', { name: '关闭弹窗' }).click()
    await page.getByRole('heading', { name: '保存对笔记的修改？' }).waitFor()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    assert.equal(await page.locator('#note-text').inputValue(), '这段新写下的想法还没有保存。')
    await page.keyboard.press('Control+n')
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByRole('button', { name: '关闭弹窗' }).click()
    await page.getByRole('button', { name: '不保存', exact: true }).click()
  }
  await page.locator('.note-body').first().click()
  await page.getByRole('dialog').waitFor()
  await page.locator('#note-text').fill('等待模型时写下的内容，也必须能够保存。')
  await page.getByRole('tab', { name: '一起编辑' }).click()
  await page.locator('#note-instruction').fill('测试等待协作')
  await page.getByRole('button', { name: '生成修改建议' }).click()
  await page.getByText('正在打磨你的笔记……', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存笔记', exact: true }).isEnabled(), true)
  await shot('minimum-note-save-during-assist')
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    JSON.parse(await readFile(path.join(data, 'notes.json'), 'utf8'))[0].text,
    '等待模型时写下的内容，也必须能够保存。',
  )
  await resize(1440, 960)
  await navigate('设置')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await shot('dark-settings-tools')
  await scrollTo('#asr-provider')
  await shot('dark-settings-speech')
  await page.locator('#tts-provider button').click()
  await page.getByRole('dialog').waitFor()
  await shot('dark-settings-tts-dialog')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await navigate('指令与记忆')
  await shot('dark-instructions')
  await navigate('我的笔记')
  await page.locator('.note-body').first().click()
  await page.getByRole('dialog').waitFor()
  await shot('dark-note-editor')
  await page.locator('#note-text').fill('关闭整个窗口前刚写下的笔记，重启后应当恢复。')
  const closed = app.waitForEvent('close', { timeout: 15_000 })
  await page.evaluate(() => window.flowchat.window('close'))
  await closed
  assert.equal(
    JSON.parse(await readFile(path.join(data, 'notes.json'), 'utf8'))[0].text,
    '关闭整个窗口前刚写下的笔记，重启后应当恢复。',
  )
  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
  })
  const reopened = await app.firstWindow()
  await reopened.emulateMedia({ reducedMotion: 'reduce' })
  reopened.on('pageerror', (error) => errors.push(error.message))
  await reopened.locator('#composer').waitFor()
  const restored = await reopened.evaluate(() => window.flowchat.command({ type: 'bootstrap' }))
  assert.equal(restored.notes[0].text, '关闭整个窗口前刚写下的笔记，重启后应当恢复。')
  await reopened.getByRole('button', { name: '我的笔记', exact: true }).click()
  await reopened.locator('.note-body').first().click()
  await reopened.getByRole('dialog').waitFor()
  assert.equal(
    await reopened.locator('#note-text').inputValue(),
    '关闭整个窗口前刚写下的笔记，重启后应当恢复。',
  )
  await reopened.evaluate(() => document.fonts.ready)
  await reopened.waitForFunction(
    () => getComputedStyle(document.querySelector('.note-dialog')).opacity === '1',
  )
  await reopened.screenshot({ path: path.join(root, 'restart-restored-note.png') })
  measurements.push({ name: 'restart-restored-note', nativeWindowExitPreservedNote: true })
  await reopened.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ root, reportOnly, captures: measurements.length, errors }, null, 2))
} finally {
  await writeFile(
    path.join(root, 'measurements.json'),
    JSON.stringify({ reportOnly, measurements, errors }, null, 2),
  )
  await app?.close().catch(() => {})
}
