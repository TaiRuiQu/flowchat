import { useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { ArrowUpRight, Check, ChevronDown, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { Command, Snapshot } from '../../../shared/types'

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const parentFolders = (path: string) => {
  const parents = path.split(/[\\/]/).filter(Boolean).slice(0, -1)
  return parents.length > 2
    ? `… / ${parents.slice(-2).join(' / ')}`
    : parents.join(' / ') || '根目录'
}

function DirectoryLabel({ path }: { path: string }) {
  return (
    <span className="workspace-path">
      <span className="workspace-name">{folderName(path)}</span>
      <span className="workspace-location">{parentFolders(path)}</span>
    </span>
  )
}

export function WorkspaceSelect({
  state,
  disabled,
  run,
}: {
  state: Snapshot
  disabled: boolean
  run: (command: Command) => Promise<unknown>
}) {
  const [pending, setPending] = useState(false)
  const directory = state.workingDirectory
  const isDefault = directory === state.defaultWorkingDirectory
  const locked = disabled || state.conversation.branches.some((branch) => branch.turns.length > 0)
  const recent = (state.settings.recentWorkingDirectories ?? []).filter(
    (path) => path !== directory && path !== state.defaultWorkingDirectory,
  )
  const select = async (path?: string) => {
    setPending(true)
    try {
      const selected = path ?? (await window.flowchat.pickDirectory())
      if (selected) await run({ type: 'workspace', directory: selected })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          className="workspace-trigger ui-select"
          aria-label="选择工作目录"
          title={directory}
          disabled={pending}
        >
          <FolderOpen size={14} />
          <span>{folderName(directory)}</span>
          <ChevronDown size={12} />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="ui-menu workspace-menu"
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={12}
        >
          <Dropdown.Label className="workspace-menu-heading">工作目录</Dropdown.Label>
          <div className="workspace-current" title={directory}>
            <span className="workspace-folder-icon">
              <FolderOpen size={17} />
            </span>
            <DirectoryLabel path={directory} />
            {isDefault && <span className="workspace-default-badge">默认</span>}
            <Check size={14} className="workspace-current-check" />
          </div>
          {!isDefault && (
            <Dropdown.Item
              className="ui-menu-item workspace-menu-path"
              disabled={locked || pending}
              onSelect={() => void select(state.defaultWorkingDirectory)}
              title={state.defaultWorkingDirectory}
            >
              <FolderOpen size={14} />
              <DirectoryLabel path={state.defaultWorkingDirectory} />
              <span className="workspace-default-badge">默认</span>
            </Dropdown.Item>
          )}
          {recent.length > 0 && (
            <>
              <Dropdown.Separator className="menu-separator" />
              <Dropdown.Label className="workspace-menu-heading">最近使用</Dropdown.Label>
              {recent.map((path) => (
                <Dropdown.Item
                  key={path}
                  className="ui-menu-item workspace-menu-path"
                  disabled={locked || pending}
                  onSelect={() => void select(path)}
                  title={path}
                >
                  <FolderOpen size={14} />
                  <DirectoryLabel path={path} />
                </Dropdown.Item>
              ))}
            </>
          )}
          <Dropdown.Separator className="menu-separator" />
          <Dropdown.Item
            className="ui-menu-item"
            disabled={locked || pending}
            onSelect={() => void select()}
          >
            <FolderOpen size={15} />
            选择其他目录…
          </Dropdown.Item>
          <Dropdown.Item
            className="ui-menu-item"
            onSelect={() =>
              void window.flowchat
                .openWorkingDirectory()
                .catch((error: Error) => toast.error(error.message))
            }
          >
            <ArrowUpRight size={15} />
            在资源管理器中打开
          </Dropdown.Item>
          {locked && (
            <p className="workspace-locked">
              {disabled ? '生成过程中暂不能更改目录设置' : '更换工作目录请新建对话'}
            </p>
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
