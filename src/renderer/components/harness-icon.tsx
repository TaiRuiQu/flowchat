import Icon, { ClaudeFilled, OpenAIOutlined } from '@ant-design/icons'
import type { Engine } from '../../../shared/types'

function OpenCodeSymbol() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" focusable="false" aria-hidden="true">
      <path fillRule="evenodd" d="M224 128h576v768H224V128zm64 64v640h448V192H288z" />
      <path d="M352 448h320v320H352z" opacity=".3" />
    </svg>
  )
}

export function HarnessIcon({ engine }: { engine: Engine }) {
  if (engine === 'OpenCode')
    return <Icon className="harness-icon" component={OpenCodeSymbol} aria-hidden="true" />
  const ProviderIcon = engine === 'Codex' ? OpenAIOutlined : ClaudeFilled
  return <ProviderIcon className="harness-icon" aria-hidden="true" />
}
