import type { CompatibleAPI, SpeechSettings } from '../shared/types'

export function endpoint(baseUrl: string, route: string) {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new Error('请填写有效的兼容接口地址。')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('接口地址必须使用 HTTP 或 HTTPS，认证信息请填写在 API Key 中。')
  url.search = ''
  url.hash = ''
  url.pathname =
    url.pathname
      .replace(/\/(?:chat\/completions|audio\/(?:speech|transcriptions))\/?$/, '')
      .replace(/\/+$/, '') +
    '/' +
    route
  return url.toString()
}

function headers(config: CompatibleAPI): Record<string, string> {
  return config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}
}
async function request(
  config: CompatibleAPI,
  route: string,
  body: BodyInit,
  json: boolean,
  signal?: AbortSignal,
) {
  if (!config.model.trim()) throw new Error('请先填写接口模型名称。')
  const response = await fetch(endpoint(config.baseUrl, route), {
    method: 'POST',
    headers: { ...headers(config), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
      : AbortSignal.timeout(90_000),
    redirect: 'error',
  })
  // Providers sometimes echo credentials in error bodies; never display them.
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`兼容接口请求失败（HTTP ${response.status}），请检查地址、模型、凭据和额度。`)
  }
  return response
}
export async function complete(config: CompatibleAPI, prompt: string, signal?: AbortSignal) {
  const response = await request(
    config,
    'chat/completions',
    JSON.stringify({
      model: config.model.trim(),
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
    true,
    signal,
  )
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('标题接口未返回有效文字。')
  return content
}
export async function transcribe(settings: SpeechSettings, bytes: Uint8Array, mimeType: string) {
  if (!settings.enabled) throw new Error('请先在设置中启用语音功能。')
  if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024)
    throw new Error('录音必须在 25 MB 以内。')
  const extensions: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  }
  const type = mimeType.split(';')[0]
  if (!extensions[type]) throw new Error('不支持此录音格式。')
  const body = new FormData()
  body.append('model', settings.asr.model.trim())
  body.append('response_format', 'json')
  body.append('file', new Blob([Uint8Array.from(bytes)], { type }), `recording.${extensions[type]}`)
  const response = await request(settings.asr, 'audio/transcriptions', body, false)
  const data = (await response.json()) as { text?: string }
  if (typeof data.text !== 'string') throw new Error('语音接口未返回转写文本。')
  return data.text
}
export async function synthesize(settings: SpeechSettings, text: string) {
  if (!settings.enabled) throw new Error('请先在设置中启用语音功能。')
  if (!text.trim() || text.length > 4096) throw new Error('每次朗读请选择 1–4096 个字符。')
  const response = await request(
    settings.tts,
    'audio/speech',
    JSON.stringify({
      model: settings.tts.model.trim(),
      input: text,
      voice: settings.tts.voice.trim(),
      speed: settings.tts.speed,
      response_format: 'mp3',
    }),
    true,
  )
  const audio = new Uint8Array(await response.arrayBuffer())
  if (!audio.length) throw new Error('语音接口返回了空音频。')
  return audio
}
export function cleanTitle(text: string) {
  return (
    text
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.replace(/^[#\s"'“”《》]+|[\s"'“”《》]+$/g, '')
      .slice(0, 60)
      .trim() ?? ''
  )
}
