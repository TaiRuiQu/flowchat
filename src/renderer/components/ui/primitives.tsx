import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from './button'

export const TooltipProvider = TooltipPrimitive.Provider
export function IconButton({ label, children, ...props }: ButtonProps & { label: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="ui-tooltip" sideOffset={7}>
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={cn('dialog-content', className)}>
          <div className="dialog-heading">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭弹窗">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className={description ? 'dialog-description' : 'sr-only'}>
            {description ?? title}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  action: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}
export function Menu({ trigger, items }: { trigger: React.ReactNode; items: MenuItem[] }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="ui-menu" align="end" sideOffset={7}>
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {item.separator && i > 0 && <Dropdown.Separator className="menu-separator" />}
              <Dropdown.Item
                className={cn('ui-menu-item', item.danger && 'danger')}
                disabled={item.disabled}
                onSelect={item.action}
              >
                {item.icon}
                {item.label}
              </Dropdown.Item>
            </React.Fragment>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
export function ContextMenu({
  open,
  onOpenChange,
  position,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: { x: number; y: number } | null
  items: MenuItem[]
}) {
  return (
    <Dropdown.Root open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger asChild>
        <span
          className="context-menu-anchor"
          style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}
        />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="ui-menu" align="start" sideOffset={0} collisionPadding={8}>
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {item.separator && i > 0 && <Dropdown.Separator className="menu-separator" />}
              <Dropdown.Item
                className={cn('ui-menu-item', item.danger && 'danger')}
                disabled={item.disabled}
                onSelect={item.action}
              >
                {item.icon}
                {item.label}
              </Dropdown.Item>
            </React.Fragment>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
export function Select({
  value,
  onValueChange,
  label,
  options,
  disabled,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  label: string
  options: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger aria-label={label} className={cn('ui-select', className)}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={13} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ui-select-item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <SwitchPrimitive.Root
      className="ui-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  )
}
