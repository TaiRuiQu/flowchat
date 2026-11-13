import type { Catalog, CatalogModel, Engine, Settings } from './types'
import { modelFor, modelSettingKeys } from './types'

export function availableModels(catalog: Catalog, engine: Engine, settings: Settings) {
  return catalog.models.filter(
    (model) =>
      model.enabled &&
      (engine !== 'OpenCode' ||
        (catalog.providers.some(
          (provider) => provider.id === model.providerId && provider.enabled,
        ) &&
          (!settings.openCodeProviderId || model.providerId === settings.openCodeProviderId))),
  )
}

// Keep a valid remembered selection; otherwise use catalog order, never a tool's default.
export function modelSelection(
  settings: Settings,
  engine: Engine,
  catalog: Catalog,
): Partial<Settings> {
  const enabled = catalog.models.filter(
    (model) =>
      model.enabled &&
      (engine !== 'OpenCode' ||
        catalog.providers.some((provider) => provider.id === model.providerId && provider.enabled)),
  )
  const providerId =
    engine === 'OpenCode'
      ? enabled.some((model) => model.providerId === settings.openCodeProviderId)
        ? settings.openCodeProviderId
        : enabled[0]?.providerId
      : undefined
  const models = enabled.filter((model) => engine !== 'OpenCode' || model.providerId === providerId)
  const selected = models.find((model) => model.id === modelFor(settings, engine)) ?? models[0]
  return {
    [modelSettingKeys[engine]]: selected?.id ?? null,
    ...(engine === 'OpenCode' ? { openCodeProviderId: providerId ?? null } : {}),
  }
}

export const reasoningKey = (engine: Engine, model: CatalogModel) =>
  JSON.stringify([engine, model.providerId, model.id])

export function reasoningFor(settings: Settings, engine: Engine, model?: CatalogModel) {
  const efforts = model?.reasoningEfforts ?? []
  if (!model || !efforts.length) return undefined
  const saved = settings.reasoningEfforts?.[reasoningKey(engine, model)]
  return saved && efforts.includes(saved)
    ? saved
    : model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : efforts.includes('medium')
        ? 'medium'
        : efforts[0]
}

export const effortLabels: Record<string, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  ultra: '极高',
}
export const effortLabel = (effort: string) => effortLabels[effort] ?? effort
