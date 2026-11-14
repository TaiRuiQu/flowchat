import type { Catalog, Engine, ToolInfo } from '../../../shared/types'
import { HarnessIcon } from './harness-icon'
import { Select } from './ui/primitives'

export function SourceSelect({
  engine,
  providerId,
  tools,
  openCodeCatalog,
  disabled,
  loadOpenCode,
  onChange,
}: {
  engine: Engine
  providerId?: string | null
  tools: ToolInfo[]
  openCodeCatalog?: Catalog
  disabled: boolean
  loadOpenCode: () => void
  onChange: (engine: Engine, providerId?: string) => void
}) {
  const providers = openCodeCatalog?.providers.filter((provider) => provider.enabled) ?? []
  const installed = (engine: Engine) => !!tools.find((tool) => tool.engine === engine)?.path
  const options = [
    ...(['Codex', 'ClaudeCode'] as const).map((engine) => ({
      value: engine,
      label: (engine === 'Codex' ? 'ChatGPT' : 'Claude') + (!installed(engine) ? ' · 未安装' : ''),
      disabled: !installed(engine),
      icon: <HarnessIcon engine={engine} />,
    })),
    ...(providers.length
      ? providers.map((provider) => ({
          value: `OpenCode:${provider.id}`,
          label: provider.name,
          disabled: !installed('OpenCode'),
          icon: <HarnessIcon engine="OpenCode" />,
        }))
      : [
          {
            value: 'OpenCode',
            label: 'OpenCode' + (!installed('OpenCode') ? ' · 未安装' : ''),
            disabled: !installed('OpenCode'),
            icon: <HarnessIcon engine="OpenCode" />,
          },
        ]),
  ]
  return (
    <Select
      className="source-select"
      label="选择模型来源"
      icon={<HarnessIcon engine={engine} />}
      value={
        engine === 'OpenCode' && providers.some((provider) => provider.id === providerId)
          ? `OpenCode:${providerId}`
          : engine
      }
      options={options}
      disabled={disabled}
      onOpenChange={(open) => {
        if (open && installed('OpenCode') && !openCodeCatalog) loadOpenCode()
      }}
      onValueChange={(value) => {
        if (value.startsWith('OpenCode:')) onChange('OpenCode', value.slice('OpenCode:'.length))
        else onChange(value as Engine)
      }}
    />
  )
}
