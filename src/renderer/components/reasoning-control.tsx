import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Zap } from 'lucide-react'
import { effortLabel } from '../../../shared/models'
import { Button } from './ui/button'

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
  const [selected, setSelected] = useState(value)
  const slider = useRef<HTMLInputElement>(null)
  useEffect(() => setSelected(value), [value])
  const index = Math.max(0, efforts.indexOf(selected))
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          className="reasoning-trigger"
          variant="ghost"
          size="sm"
          aria-label={`推理强度：${effortLabel(value)}`}
          disabled={disabled}
        >
          <Zap size={13} />
          <span className="reasoning-trigger-label">
            <span>{effortLabel(value)}</span>
            {efforts.map((effort) => (
              <span className="reasoning-trigger-measure" aria-hidden="true" key={effort}>
                {effortLabel(effort)}
              </span>
            ))}
          </span>
          <ChevronDown size={13} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="reasoning-control"
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          aria-label="调整推理强度"
          aria-disabled={disabled}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            slider.current?.focus()
          }}
        >
          <div className="reasoning-heading">
            <output>{effortLabel(selected)}</output>
          </div>
          <div
            className="reasoning-track"
            style={{ '--progress': `${(index / (efforts.length - 1)) * 100}%` } as CSSProperties}
          >
            <div className="reasoning-ticks" aria-hidden="true">
              {efforts.map((effort) => (
                <span key={effort} />
              ))}
            </div>
            <input
              ref={slider}
              type="range"
              min={0}
              max={efforts.length - 1}
              step={1}
              value={index}
              aria-label="推理强度"
              aria-valuetext={effortLabel(selected)}
              disabled={disabled}
              onChange={(event) => {
                const effort = efforts[Number(event.target.value)]
                setSelected(effort)
                onChange(effort)
              }}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
