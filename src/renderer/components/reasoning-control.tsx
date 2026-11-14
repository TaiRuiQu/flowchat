import { Sparkles } from 'lucide-react'
import { effortLabel } from '../../../shared/models'
import { Select } from './ui/primitives'

export function ReasoningControl({
  efforts,
  value,
  disabled,
  onChange,
}: {
  efforts: string[]
  value: string
  disabled: boolean
  onChange: (effort: string) => void
}) {
  return (
    <Select
      className="reasoning-trigger"
      label={`推理强度：${effortLabel(value)}`}
      icon={<Sparkles size={13} />}
      value={value}
      options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))}
      disabled={disabled}
      onValueChange={onChange}
    />
  )
}
