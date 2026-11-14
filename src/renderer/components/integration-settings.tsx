import { useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  AudioLines,
  Loader2,
  Mic,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Catalog, CompatibleAPI, Engine, Snapshot } from '../../../shared/types'
import { engineNames } from '../../../shared/types'
import type { RunCommand } from '../pages'
import { Button } from './ui/button'
import { Dialog, Select, Switch } from './ui/primitives'

function APIFields({
  id,
  value,
  onChange,
}: {
  id: string
  value: CompatibleAPI
  onChange: (value: CompatibleAPI) => void
}) {
  return (
    <div className="api-fields">
      <label className="field-label" htmlFor={`${id}-url`}>
        接口地址 · Base URL
      </label>
      <input
        id={`${id}-url`}
        className="field"
        type="url"
        required
        value={value.baseUrl}
        placeholder="https://api.example.com/v1"
        onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
      />
      <label className="field-label" htmlFor={`${id}-key`}>
        API Key
      </label>
      <input
        id={`${id}-key`}
        className="field"
        type="password"
        autoComplete="off"
        placeholder="服务商无需认证时可留空"
        value={value.apiKey}
        onChange={(event) => onChange({ ...value, apiKey: event.target.value })}
      />
      <label className="field-label" htmlFor={`${id}-model`}>
        模型名称
      </label>
      <input
        id={`${id}-model`}
        className="field"
        required
        value={value.model}
        placeholder="填写服务商提供的模型 ID"
        onChange={(event) => onChange({ ...value, model: event.target.value })}
      />
    </div>
  )
}

function ProviderSettings({
  id,
  title,
  value,
  savedValue,
  disabled,
  saveLabel,
  onChange,
}: {
  id: string
  title: string
  value: CompatibleAPI
  savedValue: CompatibleAPI
  disabled: boolean
  saveLabel: string
  onChange: (value: CompatibleAPI) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const trigger = useRef<HTMLButtonElement>(null)
  const configured = !!value.baseUrl.trim() && !!value.model.trim()
  const dirty = (['baseUrl', 'apiKey', 'model'] as const).some(
    (key) => value[key] !== savedValue[key],
  )
  const Icon = id === 'asr' ? Mic : id === 'tts' ? AudioLines : Sparkles
  return (
    <>
      <div className="provider-setting" id={`${id}-provider`}>
        <div className="provider-icon" aria-hidden="true">
          <Icon size={17} />
        </div>
        <div className="provider-details">
          <div className="provider-heading">
            <h3>{title}</h3>
            <span className={`provider-status${configured ? ' configured' : ''}`}>
              {dirty ? '未保存' : configured ? '已配置' : '待配置'}
            </span>
          </div>
          <p>{configured ? value.model : '配置接口地址、API Key 和模型'}</p>
        </div>
        <Button
          ref={trigger}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`配置${title}供应商`}
          aria-haspopup="dialog"
          onClick={() => {
            setDraft({ ...value })
            setOpen(true)
          }}
        >
          <Settings2 />
          配置供应商
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${title}供应商`}
        description="使用 OpenAI 兼容接口，填写服务商提供的地址与模型信息。"
        className="provider-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (disabled) return
            if (!draft.baseUrl.trim() || !draft.model.trim()) {
              toast.error('请填写接口地址和模型名称。')
              return
            }
            onChange({
              baseUrl: draft.baseUrl.trim(),
              apiKey: draft.apiKey.trim(),
              model: draft.model.trim(),
            })
            setOpen(false)
          }}
        >
          <fieldset disabled={disabled} className="provider-dialog-fields">
            <APIFields id={id} value={draft} onChange={setDraft} />
            <p className="settings-hint">API Key 使用系统加密保存在本机。无需认证时可留空。</p>
            <p className="provider-save-hint">确认后，点击「{saveLabel}」使修改生效。</p>
            <div className="dialog-footer">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">确认配置</Button>
            </div>
          </fieldset>
        </form>
      </Dialog>
    </>
  )
}

export function IntegrationSettings({ state, run }: { state: Snapshot; run: RunCommand }) {
  const [title, setTitle] = useState(state.settings.titleGeneration)
  const [speech, setSpeech] = useState(state.settings.speech)
  const [catalogs, setCatalogs] = useState<Partial<Record<Engine, Catalog>>>({})
  const [loading, setLoading] = useState(false)
  useEffect(
    () => setTitle(state.settings.titleGeneration),
    [JSON.stringify(state.settings.titleGeneration)],
  )
  useEffect(() => setSpeech(state.settings.speech), [JSON.stringify(state.settings.speech)])
  const loadModels = async () => {
    const engine = title.engine
    setLoading(true)
    try {
      const result = await run({ type: 'catalog', engine })
      if (result && 'models' in result) {
        const catalog = result as Catalog
        setCatalogs((current) => ({ ...current, [engine]: catalog }))
        setTitle((current) => {
          if (current.engine !== engine) return current
          const enabledModels = catalog.models.filter(
            (model) =>
              model.enabled &&
              (engine !== 'OpenCode' ||
                catalog.providers.some(
                  (provider) => provider.enabled && provider.id === model.providerId,
                )),
          )
          const selected =
            enabledModels.find(
              (model) =>
                model.id === current.modelId &&
                (engine !== 'OpenCode' || model.providerId === current.providerId),
            ) ?? enabledModels[0]
          return { ...current, modelId: selected?.id ?? '', providerId: selected?.providerId ?? '' }
        })
      }
    } finally {
      setLoading(false)
    }
  }
  const catalog = catalogs[title.engine]
  const models =
    catalog?.models.filter(
      (model) =>
        model.enabled && (title.engine !== 'OpenCode' || model.providerId === title.providerId),
    ) ?? []
  const archived = state.entries.filter((entry) => entry.archived)
  const titleDirty = JSON.stringify(title) !== JSON.stringify(state.settings.titleGeneration)
  const speechDirty = JSON.stringify(speech) !== JSON.stringify(state.settings.speech)
  return (
    <>
      <section className="settings-section">
        <div className="setting-row toggle-row">
          <div>
            <h2>
              对话标题
              {titleDirty && (
                <span className="settings-pending" role="status">
                  未保存
                </span>
              )}
            </h2>
            <p>开启后，新对话会在首轮回答后生成标题，也可以手动重命名。</p>
          </div>
          <Switch
            label="自动生成对话标题"
            checked={title.enabled}
            disabled={state.busy}
            onCheckedChange={(enabled) => setTitle({ ...title, enabled })}
          />
        </div>
        <fieldset disabled={state.busy} className="integration-form">
          <label className="field-label">标题来源</label>
          <Select
            label="标题模型来源"
            value={title.source}
            onValueChange={(source) => setTitle({ ...title, source: source as 'harness' | 'api' })}
            options={[
              { value: 'harness', label: '本机工具模型' },
              { value: 'api', label: '独立 OpenAI 兼容接口' },
            ]}
          />
          {title.source === 'api' ? (
            <ProviderSettings
              id="title-api"
              title="标题模型"
              value={title.api}
              savedValue={state.settings.titleGeneration.api}
              disabled={state.busy}
              saveLabel="保存标题配置"
              onChange={(api) => setTitle({ ...title, api })}
            />
          ) : (
            <>
              <label className="field-label">对话工具</label>
              <Select
                label="标题生成工具"
                value={title.engine}
                disabled={loading}
                onValueChange={(engine) =>
                  setTitle({ ...title, engine: engine as Engine, modelId: '', providerId: '' })
                }
                options={state.tools.map((tool) => ({
                  value: tool.engine,
                  label: engineNames[tool.engine],
                  disabled: !tool.path,
                }))}
              />
              <div className="inline-actions model-refresh">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    loading || !state.tools.find((tool) => tool.engine === title.engine)?.path
                  }
                  onClick={() => void loadModels()}
                >
                  {loading ? <Loader2 className="spin" /> : <RefreshCw />}读取标题模型
                </Button>
              </div>
              {title.engine === 'OpenCode' && catalog && (
                <Select
                  label="标题模型供应商"
                  value={title.providerId || '__empty'}
                  options={catalog.providers
                    .filter((provider) => provider.enabled)
                    .map((provider) => ({ value: provider.id, label: provider.name }))}
                  onValueChange={(providerId) =>
                    setTitle({
                      ...title,
                      providerId,
                      modelId:
                        catalog.models.find(
                          (model) => model.enabled && model.providerId === providerId,
                        )?.id ?? '',
                    })
                  }
                />
              )}
              <label className="field-label">标题模型</label>
              <Select
                label="标题生成模型"
                value={title.modelId || '__empty'}
                disabled={!models.length}
                options={
                  models.length
                    ? models.map((model) => ({ value: model.id, label: model.name }))
                    : [
                        {
                          value: title.modelId || '__empty',
                          label: title.modelId || '请读取模型目录',
                        },
                      ]
                }
                onValueChange={(modelId) => setTitle({ ...title, modelId })}
              />
            </>
          )}
          <p className="settings-hint">
            {titleDirty
              ? '修改尚未生效，请保存配置。'
              : title.enabled
                ? '自动标题已启用。'
                : '自动标题已关闭。'}
            保存的配置将用于新对话。
          </p>
          <div className="inline-actions model-refresh">
            <Button
              size="sm"
              disabled={loading || !titleDirty}
              onClick={async () => {
                if (
                  title.enabled &&
                  (title.source === 'api'
                    ? !title.api.baseUrl.trim() || !title.api.model.trim()
                    : !title.modelId || (title.engine === 'OpenCode' && !title.providerId))
                ) {
                  toast.error('请先选择标题模型或填写接口地址和模型。')
                  return
                }
                if (await run({ type: 'settings', settings: { titleGeneration: title } }))
                  toast.success('标题配置已保存')
              }}
            >
              保存标题配置
            </Button>
          </div>
        </fieldset>
      </section>
      <section className="settings-section">
        <div className="setting-row toggle-row">
          <div>
            <h2>
              语音输入与朗读
              {speechDirty && (
                <span className="settings-pending" role="status">
                  未保存
                </span>
              )}
            </h2>
            <p>使用 OpenAI 兼容语音接口，可分别配置识别与朗读服务。朗读音频由 AI 生成。</p>
          </div>
          <Switch
            label="启用语音功能"
            checked={speech.enabled}
            disabled={state.busy}
            onCheckedChange={(enabled) => setSpeech({ ...speech, enabled })}
          />
        </div>
        <fieldset disabled={state.busy} className="integration-form">
          <div className="provider-list">
            <ProviderSettings
              id="asr"
              title="语音识别 · ASR"
              value={speech.asr}
              savedValue={state.settings.speech.asr}
              disabled={state.busy}
              saveLabel="保存语音配置"
              onChange={(asr) => setSpeech({ ...speech, asr })}
            />
            <ProviderSettings
              id="tts"
              title="文字朗读 · TTS"
              value={speech.tts}
              savedValue={state.settings.speech.tts}
              disabled={state.busy}
              saveLabel="保存语音配置"
              onChange={(tts) => setSpeech({ ...speech, tts: { ...speech.tts, ...tts } })}
            />
          </div>
          <div className="speech-preferences">
            <div>
              <label className="field-label" htmlFor="tts-voice">
                朗读音色
              </label>
              <input
                id="tts-voice"
                className="field"
                value={speech.tts.voice}
                onChange={(event) =>
                  setSpeech({ ...speech, tts: { ...speech.tts, voice: event.target.value } })
                }
              />
            </div>
            <div>
              <label className="field-label" htmlFor="tts-speed">
                语速（0.25–4）
              </label>
              <input
                id="tts-speed"
                className="field"
                type="number"
                min={0.25}
                max={4}
                step={0.25}
                value={speech.tts.speed}
                onChange={(event) =>
                  setSpeech({
                    ...speech,
                    tts: { ...speech.tts, speed: Number(event.target.value) },
                  })
                }
              />
            </div>
          </div>
          <p className="settings-hint">
            {speechDirty
              ? '修改尚未生效，请保存配置。'
              : speech.enabled
                ? '语音功能已启用。'
                : '语音功能已关闭。'}
            API Key 使用系统加密保存在本机。
          </p>
          <Button
            size="sm"
            disabled={!speechDirty}
            onClick={async () => {
              if (!speech.tts.voice.trim() || speech.tts.speed < 0.25 || speech.tts.speed > 4) {
                toast.error('请填写有效的音色和语速。')
                return
              }
              if (
                speech.enabled &&
                (!speech.asr.baseUrl.trim() ||
                  !speech.asr.model.trim() ||
                  !speech.tts.baseUrl.trim() ||
                  !speech.tts.model.trim())
              ) {
                toast.error('请先填写语音接口地址和模型。')
                return
              }
              if (await run({ type: 'settings', settings: { speech } }))
                toast.success('语音配置已保存')
            }}
          >
            保存语音配置
          </Button>
        </fieldset>
      </section>
      <section className="settings-section">
        <h2>已归档的对话 · {archived.length}</h2>
        {!archived.length && (
          <p className="settings-hint">对话归档后会移出侧边栏，可在这里恢复。</p>
        )}
        <div className="archive-list">
          {archived.map((entry) => (
            <div className="setting-row" key={entry.id}>
              <span>{entry.title}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={state.busy}
                aria-label={`恢复对话：${entry.title}`}
                onClick={async () => {
                  if (await run({ type: 'archive', id: entry.id, archived: false }))
                    toast.success('对话已恢复到侧边栏')
                }}
              >
                <ArchiveRestore />
                恢复对话
              </Button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
