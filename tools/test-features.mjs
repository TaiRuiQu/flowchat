import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve('.artifacts/feature-qa', randomUUID())
const data = path.join(root, 'data'),
  project = path.join(root, 'project'),
  recentProject = path.join(root, 'wow-notes')
await mkdir(path.join(data, 'harness'), { recursive: true })
await mkdir(project, { recursive: true })
await mkdir(recentProject, { recursive: true })
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  requests.push({ url: req.url, body, headers: req.headers })
  if (req.url === '/v1/chat/completions') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '物理学习与文件实践' } }] }))
  } else if (req.url === '/v1/audio/transcriptions') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ text: '这是离线语音识别的结果' }))
  } else if (req.url === '/v1/audio/speech') {
    // A real, short silent WAV. Chromium recognizes the header regardless of the requested format.
    const wav = Buffer.alloc(44 + 8000)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24)
    wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(8000, 40)
    res.setHeader('Content-Type', 'audio/wav')
    res.end(wav)
  } else {
    res.statusCode = 404
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const storedChats = async () => {
  const directory = path.join(data, 'conversations')
  const chats = []
  let names = []
  try {
    names = await readdir(directory)
  } catch {
    return chats
  }
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    try {
      chats.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')))
    } catch {}
  }
  return chats
}
const storedDrafts = async () =>
  (await storedChats()).flatMap((chat) => chat.branches.map((branch) => branch.draft))
const until = async (check, message, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
await writeFile(
  path.join(data, 'settings.json'),
  JSON.stringify({
    codexPath: process.execPath,
    claudePath: path.join(root, 'missing-claude.exe'),
    openCodePath: path.join(root, 'missing-opencode.exe'),
  }),
)
const protocol = path.join(root, 'protocol.jsonl')
const mock = `
import readline from 'node:readline'; import fs from 'node:fs';
const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line); if(!m.id)return;
  fs.appendFileSync(${JSON.stringify(protocol)},JSON.stringify(m)+'\\n');
  emit({id:m.id,result:m.method==='model/list'?{data:[{model:'offline-model',displayName:'离线模型'}]}:m.method.startsWith('thread/')?{thread:{id:'feature-session'}}:{}});
  if(m.method!=='turn/start')return;
  const prompt=m.params.input[0].text;
  const note=prompt.includes('共同编辑一篇笔记');
  if(!note && m.params.sandboxPolicy.type==='workspaceWrite'){
    fs.writeFileSync(${JSON.stringify(path.join(data, 'memory', 'memory.md'))},'# 模型记忆\\n用户正在学习物理。');
    fs.writeFileSync('result.md','# 已创建的文件');
  }
  emit({method:'item/agentMessage/delta',params:{threadId:'feature-session',itemId:'a',delta:note?'## 共同编辑\\n保留我的观点，并补充一个日常例子。':'物理研究物质和运动。通过日常例子可以建立直观理解。\\n\\n已经更新记忆并创建 result.md。'}});
  setTimeout(()=>emit({method:'turn/completed',params:{threadId:'feature-session',turn:{status:'completed'}}}),80);
});`
await writeFile(path.join(data, 'harness/app-server'), mock)
await writeFile(path.join(project, 'app-server'), mock)
let application
const errors = []
try {
  application = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${path.join(root, 'profile')}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '今天想探索什么？' }).waitFor()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tool-mark .harness-icon svg')].length === 3,
  )
  assert.equal(await page.locator('.tool-mark .harness-icon').count(), 3)
  assert.equal(await page.locator('.tool-mark .anticon-open-a-i').count(), 1)
  assert.equal(await page.locator('.tool-mark .anticon-claude').count(), 1)
  assert.equal(await page.locator('.tool-mark .harness-icon svg').count(), 3)
  assert.equal(
    await page
      .locator('.tool-mark .harness-icon svg')
      .evaluateAll((icons) => icons.every((icon) => icon.getBoundingClientRect().width > 0)),
    true,
  )
  await page.getByRole('switch', { name: '自动生成对话标题' }).click()
  await page.getByRole('combobox', { name: '标题模型来源' }).click()
  await page.getByRole('option', { name: '独立 OpenAI 兼容接口' }).click()
  assert.equal(await page.locator('.api-fields').count(), 0)
  await page.getByRole('button', { name: '配置标题模型供应商', exact: true }).click()
  await page.locator('#title-api-url').fill(baseUrl)
  await page.locator('#title-api-model').fill('title-test')
  await page.locator('#title-api-key').fill('offline-title-key')
  await page.getByRole('button', { name: '确认配置', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#title-api-provider .provider-status').textContent(), '未保存')
  await page.getByRole('button', { name: '保存标题配置' }).click()
  await page.getByText('标题配置已保存', { exact: true }).waitFor()
  await page.getByRole('switch', { name: '启用语音功能' }).click()
  for (const id of ['asr', 'tts']) {
    await page.locator(`#${id}-provider button`).click()
    await page.locator(`#${id}-url`).fill(baseUrl)
    await page.locator(`#${id}-model`).fill(`${id}-test`)
    await page.locator(`#${id}-key`).fill(`offline-${id}-key`)
    await page.getByRole('button', { name: '确认配置', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  }
  await page.getByRole('button', { name: '保存语音配置' }).click()
  await page.getByText('语音配置已保存', { exact: true }).waitFor()
  assert.equal(await page.locator('#asr-provider .provider-status').textContent(), '已配置')
  await page.locator('#asr-provider button').click()
  await page.locator('#asr-model').fill('discarded-model')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('#asr-provider button').evaluate((el) => el === document.activeElement),
    true,
  )
  await page.locator('#asr-provider button').click()
  assert.equal(await page.locator('#asr-model').inputValue(), 'asr-test')
  await page.locator('#asr-key').fill('discarded-key')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('#asr-provider button').click()
  assert.equal(await page.locator('#asr-key').inputValue(), 'offline-asr-key')
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.getByRole('button', { name: '保存语音配置', exact: true }).isDisabled(),
    true,
  )
  const disk = await readFile(path.join(data, 'settings.json'), 'utf8')
  assert.ok(
    !disk.includes('offline-title-key') &&
      !disk.includes('offline-asr-key') &&
      !disk.includes('offline-tts-key'),
  )
  assert.match(disk, /encrypted:/)
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '指令与记忆', exact: true })
    .click()
  await page.locator('#instructions').fill('用户固定指令：解释要有条理。')
  await page.getByRole('button', { name: '保存指令', exact: true }).click()
  await page.getByText('用户指令已更新', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, project)
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click()
  await page.getByRole('menuitem', { name: '选择其他目录…', exact: true }).click()
  await page.waitForFunction(
    (directory) => document.querySelector('.workspace-trigger').title === directory,
    project,
  )
  await page.getByRole('button', { name: '选择工作目录' }).click()
  assert.equal(await page.getByRole('menuitemcheckbox').count(), 0)
  assert.equal(
    await page.locator('.workspace-current .workspace-name').textContent(),
    path.basename(project),
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.flowchat.command({ type: 'workspaceDefault', enabled: true }))
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  assert.equal(await page.locator('.workspace-trigger').getAttribute('title'), project)
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, recentProject)
  await page.getByRole('button', { name: '选择工作目录' }).click()
  await page.getByRole('menuitem', { name: '选择其他目录…' }).click()
  await page.waitForFunction(
    (directory) => document.querySelector('.workspace-trigger').title === directory,
    recentProject,
  )
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await page.getByRole('button', { name: '选择工作目录' }).click()
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.workspace-menu')).opacity === '1',
  )
  await page.screenshot({ path: path.join(root, '00-workspace-menu.png') })
  await page
    .locator('.workspace-menu')
    .screenshot({ path: path.join(root, 'workspace-menu-detail.png') })
  await page
    .getByRole('menuitem')
    .filter({ hasText: path.basename(recentProject) })
    .click()
  await page.waitForFunction(
    (directory) => document.querySelector('.workspace-trigger').title === directory,
    recentProject,
  )
  await page.getByRole('button', { name: '选择工作目录' }).click()
  await page
    .getByRole('menuitem')
    .filter({ hasText: path.basename(project) })
    .click()
  await page.waitForFunction(
    (directory) => document.querySelector('.workspace-trigger').title === directory,
    project,
  )
  await application.evaluate(({ shell }) => {
    shell.openPath = async (directory) => {
      globalThis.openedWorkspace = directory
      return ''
    }
  })
  await page.getByRole('button', { name: '选择工作目录' }).click()
  await page.getByRole('menuitem', { name: '在资源管理器中打开' }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-menu') === null)
  assert.equal(await application.evaluate(() => globalThis.openedWorkspace), project)
  await page.locator('#composer').fill('请记住我在学习物理，并创建 result.md')
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await page.getByRole('button', { name: '追问', exact: true }).waitFor()
  await page.locator('.history-item', { hasText: '物理学习与文件实践' }).waitFor()
  await page.getByRole('button', { name: '选择工作目录' }).click()
  assert.equal(
    await page.getByRole('menuitem', { name: '选择其他目录…' }).getAttribute('aria-disabled'),
    'true',
  )
  assert.equal(await page.getByRole('menuitem', { name: '在资源管理器中打开' }).isEnabled(), true)
  await page.keyboard.press('Escape')
  assert.match(await readFile(path.join(project, 'result.md'), 'utf8'), /已创建/)
  assert.match(await readFile(path.join(data, 'memory', 'memory.md'), 'utf8'), /用户正在学习物理/)
  assert.match(
    JSON.parse(requests.find((request) => request.url === '/v1/chat/completions').body).messages[0]
      .content,
    /请记住我在学习物理/,
  )
  const selectAnswer = async () => {
    await page.locator('.answer .markdown p').first().scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const p = document.querySelector('.answer .markdown p'),
        range = document.createRange()
      range.selectNodeContents(p)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor()
  }
  await selectAnswer()
  assert.equal(await page.getByRole('toolbar').getByRole('button').count(), 2)
  await page.screenshot({ path: path.join(root, '01-selection.png') })
  await page.getByRole('toolbar').getByRole('button', { name: '记笔记', exact: true }).click()
  assert.match(await page.locator('.note-source').textContent(), /物理研究物质和运动/)
  await page.locator('#note-title').fill('我对物理的理解')
  await page.locator('#note-text').fill('我的观点：先建立直觉。')
  await page.locator('#note-instruction').fill('保留我的观点，补充例子')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await page.getByRole('button', { name: '采纳到笔记', exact: true }).waitFor()
  assert.equal(await page.locator('#note-text').inputValue(), '我的观点：先建立直觉。')
  await page.getByRole('button', { name: '采纳到笔记', exact: true }).click()
  assert.match(await page.locator('#note-text').inputValue(), /共同编辑/)
  await page.locator('.note-editor-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: path.join(root, '02-note-editor.png') })
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const notes = JSON.parse(await readFile(path.join(data, 'notes.json'), 'utf8'))
  assert.match(notes[0].quote, /物理研究/)
  assert.match(notes[0].text, /共同编辑/)
  await selectAnswer()
  await page.getByRole('button', { name: '朗读选中文字', exact: true }).click()
  await page.getByRole('button', { name: '停止朗读', exact: true }).waitFor()
  await page.getByRole('button', { name: '停止朗读', exact: true }).waitFor({ state: 'hidden' })
  const ttsRequest = requests.find((request) => request.url === '/v1/audio/speech')
  assert.equal(
    JSON.parse(ttsRequest.body).input,
    '物理研究物质和运动。通过日常例子可以建立直观理解。',
  )
  await page.getByRole('button', { name: '语音输入', exact: true }).click()
  await page.getByRole('button', { name: '结束录音并识别', exact: true }).waitFor()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '结束录音并识别', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('#composer').value.includes('这是离线语音识别的结果'),
  )
  assert.match(
    requests.find((request) => request.url === '/v1/audio/transcriptions').headers['content-type'],
    /multipart\/form-data/,
  )
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '指令与记忆', exact: true })
    .click()
  // Leaving the conversation must flush the dictated text to the store before anything archives it.
  await until(
    async () => (await storedDrafts()).includes('这是离线语音识别的结果'),
    '语音草稿未在切换页面前写入磁盘',
  )
  assert.equal(await page.locator('#instructions').inputValue(), '用户固定指令：解释要有条理。')
  assert.match(await page.locator('#memory').inputValue(), /用户正在学习物理/)
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  await page.locator('#memory-file-name').fill('projects/physics.md')
  await page.getByRole('button', { name: '创建文档', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('#memory').fill('# 物理学习\n\n这是一份按主题整理的全局记忆。')
  await page.getByRole('combobox', { name: '选择记忆文档' }).click()
  await page.getByRole('option', { name: 'memory.md · 索引', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('#memory').value.includes('用户正在学习物理'),
  )
  assert.match(
    await readFile(path.join(data, 'memory/projects/physics.md'), 'utf8'),
    /按主题整理的全局记忆/,
  )
  await page.getByRole('combobox', { name: '选择记忆文档' }).click()
  await page.getByRole('option', { name: 'projects/physics.md', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('#memory').value.includes('按主题整理的全局记忆'),
  )
  await page.locator('#memory').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(root, '03-categorized-memory.png') })
  await page.getByRole('combobox', { name: '选择记忆文档' }).click()
  await page.getByRole('option', { name: 'memory.md · 索引', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('#memory').value.includes('用户正在学习物理'),
  )
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.utility-scroll')).opacity === '1',
  )
  await page.screenshot({ path: path.join(root, '03-instructions-memory.png') })
  await page.locator('.history-item', { hasText: '物理学习与文件实践' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '归档对话', exact: true }).click()
  await page
    .locator('.history-item', { hasText: '物理学习与文件实践' })
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '恢复对话：物理学习与文件实践', exact: true }).waitFor()
  await page
    .getByRole('button', { name: '恢复对话：物理学习与文件实践', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(root, '04-archive-settings.png') })
  await page.getByRole('button', { name: '恢复对话：物理学习与文件实践', exact: true }).click()
  await page.locator('.history-item', { hasText: '物理学习与文件实践' }).waitFor()
  await page.getByRole('combobox', { name: '标题模型来源' }).click()
  await page.getByRole('option', { name: '本机工具模型' }).click()
  await page.getByRole('button', { name: '读取标题模型', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="标题生成模型"]').textContent.includes('离线模型'),
  )
  await page.getByRole('button', { name: '保存标题配置', exact: true }).click()
  await page.getByRole('switch', { name: '启用语音功能' }).click()
  await page.getByRole('button', { name: '保存语音配置', exact: true }).click()
  await page.locator('.history-item', { hasText: '物理学习与文件实践' }).click()
  // Reopening the conversation must show the saved draft before the window closes.
  await page.waitForFunction(
    (text) => document.querySelector('#composer')?.value === text,
    '这是离线语音识别的结果',
  )
  assert.equal(await page.getByRole('button', { name: '语音输入', exact: true }).count(), 0)
  const records = (await readFile(protocol, 'utf8')).trim().split('\n').map(JSON.parse)
  const turns = records.filter((record) => record.method === 'turn/start')
  assert.equal(turns[0].params.sandboxPolicy.type, 'workspaceWrite')
  assert.deepEqual(turns[0].params.sandboxPolicy.writableRoots, [
    project,
    path.join(data, 'memory'),
  ])
  assert.equal(turns[1].params.sandboxPolicy.type, 'readOnly')
  assert.match(turns[0].params.input[0].text, /<user_instructions>\n用户固定指令/)
  await application.close()
  application = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(root, 'profile')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWCHAT_DATA_DIR: data },
  })
  const restarted = await application.firstWindow()
  restarted.on('pageerror', (error) => errors.push(error.message))
  await restarted.locator('#composer').waitFor()
  const restoredState = await restarted.evaluate(() =>
    window.flowchat.command({ type: 'bootstrap' }),
  )
  assert.equal(restoredState.settings.titleGeneration.api.apiKey, 'offline-title-key')
  assert.equal(restoredState.settings.speech.asr.apiKey, 'offline-asr-key')
  assert.equal(restoredState.settings.speech.tts.apiKey, 'offline-tts-key')
  assert.equal(restoredState.settings.speech.enabled, false)
  assert.equal(restoredState.settings.titleGeneration.source, 'harness')
  assert.equal(restoredState.settings.titleGeneration.modelId, 'offline-model')
  assert.equal(restoredState.workingDirectory, project)
  assert.match(restoredState.memory.text, /用户正在学习物理/)
  assert.equal(restoredState.memory.path, path.join(data, 'memory/memory.md'))
  assert.ok(restoredState.memory.files.some((file) => file.name === 'projects/physics.md'))
  assert.equal(restoredState.conversation.title, '物理学习与文件实践')
  assert.equal(
    restoredState.conversation.branches.find(
      (branch) => branch.id === restoredState.conversation.activeBranchId,
    )?.draft,
    '这是离线语音识别的结果',
  )
  // The composer mounts before React's effect restores the saved draft.
  await restarted.waitForFunction(
    () => document.querySelector('#composer')?.value === '这是离线语音识别的结果',
  )
  assert.equal(await restarted.locator('#composer').inputValue(), '这是离线语音识别的结果')
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        errors,
        checks: [
          'Ant Design provider icons and matching custom OpenCode SVG',
          'workspace selection',
          'recent workspaces and new conversation default',
          'open workspace in file explorer',
          'file writes',
          'instruction/memory separation',
          'global categorized memory documents and autosave on switch',
          'selection toolbar',
          'note coediting review',
          'API titles',
          'harness title model selector',
          'credential encryption',
          'TTS playback',
          'ASR microphone and draft',
          'speech opt out',
          'archive restore',
          'encrypted credentials and workspace survive restart',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`Feature UI checks passed. Screenshots: ${root}`)
} catch (error) {
  // Data loss bugs are invisible in a stack trace; print the persisted state that caused the failure.
  console.error(`Feature UI checks failed: ${error.message}`)
  try {
    const chats = await storedChats()
    console.error(
      'stored conversations:',
      JSON.stringify(
        chats.map((chat) => ({
          id: chat.id,
          title: chat.title,
          archived: chat.archived,
          activeBranchId: chat.activeBranchId,
          drafts: chat.branches.map((branch) => [branch.id, branch.draft]),
        })),
        null,
        2,
      ),
    )
    const settings = JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8'))
    console.error('lastConversationId:', settings.lastConversationId)
  } catch {}
  throw error
} finally {
  await application?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
