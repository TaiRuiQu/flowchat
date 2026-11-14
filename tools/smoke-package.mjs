import { _electron as electron } from 'playwright'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const root = path.resolve('.artifacts/electron-qa', `packaged-${randomUUID()}`)
await mkdir(root, { recursive: true })
const app = await electron.launch({
  executablePath: path.resolve('.artifacts/electron/win-unpacked/FlowChat.exe'),
  args: [`--user-data-dir=${path.join(root, 'profile')}`],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    FLOWCHAT_DATA_DIR: path.join(root, 'data'),
  },
})
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '今天想探索什么？' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.ok(
    await page.evaluate(() =>
      ['Geist Sans', 'HarmonyOS Sans SC'].every((family) =>
        [...document.fonts].some((font) => font.family === family && font.status === 'loaded'),
      ),
    ),
  )
  const version = await app.evaluate(() => process.versions.electron)
  assert.equal(version, '45.3.1')
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const icon = await readFile('assets/flowchat.ico')
  const iconHash = createHash('sha256').update(icon).digest('hex').slice(0, 16)
  // The Windows shell needs a real ICO outside app.asar, refreshed when the artwork changes.
  assert.deepEqual(await readFile(path.join(userData, 'icons', `flowchat-${iconHash}.ico`)), icon)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  const state = await page.evaluate(() => window.flowchat.command({ type: 'bootstrap' }))
  assert.equal(state.settings.version, 2)
  assert.equal(state.conversation.version, 2)
  await page.locator('#composer').fill('打包版本的草稿')
  await page.screenshot({ path: path.join(root, 'welcome.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.waitForTimeout(250)
  await page.locator('.utility-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: path.join(root, 'settings-dark.png') })
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(`Packaged Electron ${version} launched successfully. Screenshots: ${root}`)
} finally {
  await app.close()
}
