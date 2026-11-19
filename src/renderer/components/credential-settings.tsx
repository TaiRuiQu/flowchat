import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, RefreshCw, ShieldCheck, ShieldOff, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import type {
  CredentialOption,
  Engine,
  EngineAuth,
  Settings,
  Snapshot,
} from '../../../shared/types'
import { engineNames } from '../../../shared/types'
import type { RunCommand } from '../pages'
import { Button } from './ui/button'
import { Dialog, Select } from './ui/primitives'

const maskKey = (value: string) =>
  value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`

const sourceLabel = (id: EngineAuth['source']) =>
  id === 'settings'
    ? '~/.claude/settings.json'
    : id === 'environment'
      ? '系统环境变量'
      : id === 'cli'
        ? '工具自身登录'
        : '自动跟随'

export const credentialSummary = (value: EngineAuth) =>
  value.mode === 'custom'
    ? `${value.api.baseUrl || '默认地址'} · ${value.api.apiKey ? maskKey(value.api.apiKey) : '未填写 API Key'}`
    : `本机凭证 · ${sourceLabel(value.source)}`

function ModeChoice({
  active,
  title,
  detail,
  Icon,
  disabled,
  onSelect,
}: {
  active: boolean
  title: string
  detail: string
  Icon: typeof KeyRound
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`credential-mode${active ? ' selected' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon size={16} />
      <span>
        <strong>{title}</strong>
        <em>{detail}</em>
      </span>
      {active && <Check size={14} />}
    </button>
  )
}

export function CredentialDialog({
  engine,
  open,
  onOpenChange,
  state,
  run,
}: {
  engine: Engine
  open: boolean
  onOpenChange: (open: boolean) => void
  state: Snapshot
  run: RunCommand
}) {
  const saved = state.settings.credentials[engine],
    savedKey = JSON.stringify(saved),
    [mode, setMode] = useState<EngineAuth['mode']>(saved.mode),
    [source, setSource] = useState<EngineAuth['source']>(saved.source),
    [api, setApi] = useState<EngineAuth['api']>(saved.api),
    [options, setOptions] = useState<CredentialOption[] | null>(null),
    [loading, setLoading] = useState(false),
    [verifying, setVerifying] = useState(false),
    [verdict, setVerdict] = useState('')
  useEffect(() => {
    const current = JSON.parse(savedKey) as EngineAuth
    setMode(current.mode)
    setSource(current.source)
    setApi(current.api)
  }, [savedKey])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const report = await run({ type: 'credentials', engine })
      if (report && 'options' in report) setOptions(report.options)
    } finally {
      setLoading(false)
    }
  }, [run, engine])
  useEffect(() => {
    if (!open) return
    setVerdict('')
    void load()
  }, [open, load])
  const dirty =
    mode !== saved.mode ||
    source !== saved.source ||
    JSON.stringify(api) !== JSON.stringify(saved.api)
  const save = async () => {
    if (mode === 'custom') {
      if (!api.apiKey.trim()) {
        toast.error('请填写 API Key。')
        return
      }
      if (api.baseUrl.trim() && !/^https?:\/\//i.test(api.baseUrl.trim())) {
        toast.error('接口地址需要以 http:// 或 https:// 开头。')
        return
      }
      if (engine === 'OpenCode' && (!api.baseUrl.trim() || !api.model.trim())) {
        toast.error('OpenCode 需要填写接口地址和模型 ID。')
        return
      }
    }
    const next: EngineAuth = {
      mode,
      source,
      api: {
        ...api,
        baseUrl: api.baseUrl.trim(),
        apiKey: api.apiKey.trim(),
        model: api.model.trim(),
      },
    }
    const patch: Partial<Settings> = {
      credentials: { [engine]: next } as Settings['credentials'],
    }
    if (await run({ type: 'settings', settings: patch })) {
      setVerdict('')
      toast.success(`${engineNames[engine]} 登录凭证已保存`)
    }
  }
  const verify = async () => {
    setVerifying(true)
    setVerdict('')
    try {
      const result = await run({ type: 'verifyAuth', engine })
      if (result?.message) setVerdict(result.message)
    } finally {
      setVerifying(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`登录凭证 · ${engineNames[engine]}`}
      description="选择本机已有的凭证，或由 FlowChat 保存一个 API Key。FlowChat 只支持 API 方式；订阅登录请在终端完成。"
      className="credential-dialog"
    >
      <div
        className="credential-modes"
        role="group"
        aria-label={`${engineNames[engine]} 凭证来源方式`}
      >
        <ModeChoice
          active={mode === 'system'}
          title="使用本机凭证"
          detail={`读取 ${engineNames[engine]} 已有登录与配置`}
          Icon={Terminal}
          disabled={state.busy}
          onSelect={() => setMode('system')}
        />
        <ModeChoice
          active={mode === 'custom'}
          title="在 FlowChat 中配置 API"
          detail="仅 API Key，不支持订阅登录"
          Icon={KeyRound}
          disabled={state.busy}
          onSelect={() => setMode('custom')}
        />
      </div>
      {mode === 'system' ? (
        <>
          <div className="credential-list-head">
            <span>检测到的本机凭证</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || state.busy}
              onClick={() => void load()}
            >
              {loading ? <Loader2 className="spin" /> : <RefreshCw />}重新检测
            </Button>
          </div>
          <div className="credential-list" role="radiogroup" aria-label="本机凭证">
            {!options && (
              <p className="settings-hint">
                {loading ? '正在检测……' : '尚未检测到凭证，点击「重新检测」。'}
              </p>
            )}
            {options?.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={source === option.id}
                className={`credential-option${source === option.id ? ' selected' : ''}`}
                disabled={state.busy || !option.available}
                onClick={() => setSource(option.id)}
              >
                <span className="credential-radio" aria-hidden="true" />
                <span className="credential-body">
                  <strong>{option.label}</strong>
                  <em>{option.detail}</em>
                </span>
                <span className="credential-flags">
                  {option.subscription && <i className="flag subscription">订阅</i>}
                  <i className={`flag${option.restricted ? '' : ' open'}`}>
                    {option.restricted ? (
                      <>
                        <ShieldCheck size={11} />
                        文件沙箱
                      </>
                    ) : (
                      <>
                        <ShieldOff size={11} />
                        无沙箱
                      </>
                    )}
                  </i>
                  {!option.available && <i className="flag muted">不可用</i>}
                </span>
              </button>
            ))}
          </div>
          <p className="settings-hint">
            {engine === 'ClaudeCode'
              ? '订阅登录与 apiKeyHelper 需要 claude 自己读取配置，这类凭证会关闭 --restricted 文件沙箱；API Key 方式可以保留沙箱。'
              : '订阅登录由工具自己管理，FlowChat 不会改动工具的登录状态；选「配置 API」才注入 FlowChat 保存的密钥。'}
          </p>
        </>
      ) : (
        <div className="credential-api">
          <label className="field-label" htmlFor={`${engine}-api-url`}>
            {engine === 'ClaudeCode'
              ? '接口地址 · Base URL（留空即 Anthropic 官方）'
              : '接口地址 · Base URL'}
          </label>
          <input
            id={`${engine}-api-url`}
            className="field"
            type="url"
            placeholder={
              engine === 'ClaudeCode'
                ? 'https://api.anthropic.com'
                : engine === 'Codex'
                  ? 'https://api.openai.com/v1'
                  : 'https://api.example.com/v1'
            }
            value={api.baseUrl}
            disabled={state.busy}
            onChange={(event) => setApi({ ...api, baseUrl: event.target.value })}
          />
          {engine === 'ClaudeCode' && (
            <>
              <label className="field-label">认证方式</label>
              <Select
                label="认证方式"
                value={api.header}
                disabled={state.busy}
                options={[
                  { value: 'bearer', label: 'Authorization: Bearer（中转 / 兼容服务）' },
                  { value: 'api-key', label: 'x-api-key（Anthropic 官方 API Key）' },
                ]}
                onValueChange={(header) =>
                  setApi({ ...api, header: header === 'api-key' ? 'api-key' : 'bearer' })
                }
              />
            </>
          )}
          {engine === 'OpenCode' && (
            <>
              <label className="field-label">协议</label>
              <Select
                label="协议"
                value={api.protocol}
                disabled={state.busy}
                options={[
                  { value: 'openai', label: 'OpenAI 兼容（/v1/chat/completions）' },
                  { value: 'anthropic', label: 'Anthropic 兼容（/v1/messages）' },
                ]}
                onValueChange={(protocol) =>
                  setApi({ ...api, protocol: protocol === 'anthropic' ? 'anthropic' : 'openai' })
                }
              />
            </>
          )}
          <label className="field-label" htmlFor={`${engine}-api-key`}>
            API Key
          </label>
          <input
            id={`${engine}-api-key`}
            className="field"
            type="password"
            autoComplete="off"
            placeholder={engine === 'Codex' ? 'sk-...' : 'sk-ant-...'}
            value={api.apiKey}
            disabled={state.busy}
            onChange={(event) => setApi({ ...api, apiKey: event.target.value })}
          />
          {engine === 'OpenCode' && (
            <>
              <label className="field-label" htmlFor={`${engine}-api-model`}>
                模型 ID
              </label>
              <input
                id={`${engine}-api-model`}
                className="field"
                placeholder="例如 gpt-5.1-codex"
                value={api.model}
                disabled={state.busy}
                onChange={(event) => setApi({ ...api, model: event.target.value })}
              />
            </>
          )}
          <p className="settings-hint">
            {engine === 'OpenCode'
              ? '保存后 FlowChat 会在 ~/.config/opencode/opencode.json 写入 providers.flowchat，并切换到该供应商；API Key 只存在这个本地文件里。'
              : 'API Key 使用系统加密保存在本机；订阅（账号登录）无法在这里配置，请先在终端登录工具，再选择「使用本机凭证」。'}
          </p>
        </div>
      )}
      {verdict && (
        <p
          className={`credential-verdict${verdict.startsWith('连接失败') ? ' failed' : ''}`}
          role="status"
        >
          {verdict}
        </p>
      )}
      {engine === 'OpenCode' && mode === 'system' && (
        <p className="settings-hint">
          需要新的供应商凭证时，可在终端运行 opencode auth login 后点「重新检测」。
        </p>
      )}
      <div className="dialog-footer">
        <Button
          type="button"
          variant="ghost"
          disabled={state.busy}
          onClick={() =>
            void window.flowchat
              .login(engine)
              .then(() => toast.info('已启动工具登录，请完成浏览器或终端中的登录流程'))
              .catch((e) => toast.error(e.message))
          }
        >
          在终端登录
        </Button>
        <span className="credential-footer-gap" />
        <Button
          type="button"
          variant="outline"
          disabled={state.busy || verifying || dirty}
          onClick={() => void verify()}
        >
          {verifying ? <Loader2 className="spin" /> : <RefreshCw />}验证连接
        </Button>
        <Button type="button" disabled={state.busy || !dirty} onClick={() => void save()}>
          <Check />
          保存凭证
        </Button>
      </div>
    </Dialog>
  )
}
