import { describe, expect, it } from 'vitest'
import type { Catalog, Settings } from '../../shared/types'
import { defaults } from '../../electron/domain'
import { modelSelection, reasoningFor, reasoningKey } from '../../shared/models'

const catalog: Catalog = {
  providers: [
    { id: 'disabled', name: 'Disabled', enabled: false },
    { id: 'a', name: 'A', enabled: true },
    { id: 'b', name: 'B', enabled: true },
  ],
  models: [
    { id: 'off', providerId: 'a', name: 'Off', enabled: false },
    {
      id: 'first',
      providerId: 'a',
      name: 'First',
      enabled: true,
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'second',
      providerId: 'a',
      name: 'Second',
      enabled: true,
      reasoningEfforts: ['medium', 'max'],
    },
    { id: 'first', providerId: 'b', name: 'Other provider', enabled: true },
  ],
}

describe('model preferences', () => {
  it('chooses the first enabled model and preserves each harness selection independently', () => {
    const settings = defaults()
    expect(modelSelection(settings, 'Codex', catalog)).toEqual({ codexModelId: 'first' })
    expect(modelSelection(settings, 'ClaudeCode', catalog)).toEqual({ claudeModelId: 'first' })
    settings.codexModelId = 'second'
    settings.claudeModelId = 'first'
    expect(modelSelection(settings, 'Codex', catalog)).toEqual({ codexModelId: 'second' })
    expect(modelSelection(settings, 'ClaudeCode', catalog)).toEqual({ claudeModelId: 'first' })
    settings.codexModelId = 'removed'
    expect(modelSelection(settings, 'Codex', catalog)).toEqual({ codexModelId: 'first' })
  })
  it('chooses OpenCode provider and model together in catalog order', () => {
    expect(modelSelection(defaults(), 'OpenCode', catalog)).toEqual({
      openCodeProviderId: 'a',
      openCodeModelId: 'first',
    })
    const settings: Settings = { ...defaults(), openCodeProviderId: 'b', openCodeModelId: 'second' }
    expect(modelSelection(settings, 'OpenCode', catalog)).toEqual({
      openCodeProviderId: 'b',
      openCodeModelId: 'first',
    })
    expect(modelSelection(settings, 'OpenCode', { ...catalog, models: [] })).toEqual({
      openCodeProviderId: null,
      openCodeModelId: null,
    })
  })
  it('remembers effort per harness, provider and model and rejects unsupported saved levels', () => {
    const first = catalog.models[1],
      second = catalog.models[2]
    const settings = {
      ...defaults(),
      reasoningEfforts: {
        [reasoningKey('Codex', first)]: 'low',
        [reasoningKey('Codex', second)]: 'max',
      },
    }
    expect(reasoningFor(settings, 'Codex', first)).toBe('low')
    expect(reasoningFor(settings, 'Codex', second)).toBe('max')
    expect(reasoningFor(settings, 'ClaudeCode', first)).toBe('high')
    expect(reasoningFor(settings, 'Codex', { ...first, providerId: 'b' })).toBe('high')
    expect(reasoningFor(settings, 'Codex', { ...first, reasoningEfforts: ['medium'] })).toBe(
      'medium',
    )
    expect(reasoningFor(settings, 'Codex', catalog.models[3])).toBeUndefined()
  })
})
