export async function markdownMode(page, id, mode) {
  const root = page.locator(`#${id}-editor`)
  const target = root.locator(mode === 'sv' ? '.vditor-sv' : '.vditor-ir [contenteditable]')
  await root.locator('[data-type="edit-mode"]').waitFor()
  if (!(await target.isVisible())) {
    await root.locator('[data-type="edit-mode"]').click()
    await root.locator(`[data-mode="${mode}"]`).click()
  }
  return target
}

export async function fillMarkdown(page, id, text) {
  const source = await markdownMode(page, id, 'sv')
  await source.fill(text)
  await markdownMode(page, id, 'ir')
}

export async function readMarkdown(page, id) {
  const source = await markdownMode(page, id, 'sv')
  const text = await source.inputValue()
  await markdownMode(page, id, 'ir')
  return text.trimEnd()
}
