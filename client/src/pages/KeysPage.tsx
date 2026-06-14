import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { UnifiedKeySection } from '@/components/unified-key-section'
import type { ApiKey, Platform, CustomModel } from '../../../shared/types'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'together', label: 'Together AI' },
  { value: 'zhipu', label: '智谱AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo 网关 (匿名可用)' },
  { value: 'pollinations', label: 'Pollinations (匿名可用)' },
  { value: 'llm7', label: 'LLM7 (匿名可用)' },
  { value: 'bedrock', label: 'AWS Bedrock' },
]

// 'custom' is configured through its own form (base URL + model), not the
// generic key dropdown — but it still appears in the configured-providers list.
const CUSTOM_ENTRY = { value: 'custom' as const, label: '自定义 (兼容 OpenAI)' }

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: '正常',
  rate_limited: '限流',
  invalid: '无效',
  error: '错误',
  unknown: '未检查',
}

const PLATFORM_KEY_HELP: Partial<Record<Platform, string>> = {
  huggingface:
    '来自 huggingface.co/settings/tokens 的令牌，需要 Inference Providers 权限 (hf_…)。',
  together:
    '来自 api.together.ai/settings/api-keys 的 API 密钥。预付费积分 — 不是无限免费额度。',
  bedrock:
    'IAM（类似 Cursor）：区域 + Access Key ID + Secret Access Key。或者仅 Bedrock API 密钥：留空 Access Key ID，粘贴来自 Amazon Bedrock → API keys 的 ABSK… 密钥。在你的区域启用模型访问。',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function CustomProviderSection() {
  const queryClient = useQueryClient()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')

  // Discover state
  const [discoverBaseUrl, setDiscoverBaseUrl] = useState('')
  const [discoverApiKey, setDiscoverApiKey] = useState('')
  const [discoverResult, setDiscoverResult] = useState<{ baseUrl: string; models: Array<{ id: string; object: string }> } | null>(null)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)

  // Fetch custom models
  const { data: customModels = [] } = useQuery<CustomModel[]>({
    queryKey: ['customModels'],
    queryFn: () => apiFetch('/api/keys/custom/models'),
  })

  // Existing model IDs (for dedup in UI)
  const existingModelIds = new Set(customModels.map(m => m.modelId))

  const addCustom = useMutation({
    mutationFn: (body: { baseUrl: string; model: string; displayName?: string; apiKey?: string }) =>
      apiFetch('/api/keys/custom', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['customModels'] })
      setModel('')
      setDisplayName('')
    },
  })

  const deleteCustomModel = useMutation({
    mutationFn: (modelId: string) => apiFetch(`/api/keys/custom/model/${modelId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customModels'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
    },
  })

  const bulkImport = useMutation({
    mutationFn: (body: { baseUrl: string; models: string[]; apiKey?: string }) =>
      apiFetch('/api/keys/custom/bulk', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customModels'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setDiscoverResult(null)
      setSelectedModels(new Set())
      setDiscoverBaseUrl('')
      setDiscoverApiKey('')
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!baseUrl || !model) return
    addCustom.mutate({ baseUrl, model, displayName: displayName || undefined, apiKey: apiKey || undefined })
  }

  const handleDiscover = async () => {
    if (!discoverBaseUrl) return
    setDiscovering(true)
    setDiscoverError(null)
    setDiscoverResult(null)
    setSelectedModels(new Set())
    try {
      const res = await apiFetch('/api/keys/custom/discover', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: discoverBaseUrl, apiKey: discoverApiKey || undefined }),
      })
      setDiscoverResult(res)
      // Pre-select all new (non-existing) models
      const newModels = (res.models as Array<{ id: string; object: string }>)
        .filter(m => !existingModelIds.has(m.id))
        .map(m => m.id)
      setSelectedModels(new Set(newModels))
    } catch (err: any) {
      setDiscoverError(err.message || '发现模型失败')
    } finally {
      setDiscovering(false)
    }
  }

  const toggleModelSelection = (modelId: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(modelId)) {
        next.delete(modelId)
      } else {
        next.add(modelId)
      }
      return next
    })
  }

  const handleBulkImport = () => {
    if (!discoverResult || selectedModels.size === 0) return
    const models = Array.from(selectedModels)
    bulkImport.mutate({
      baseUrl: discoverResult.baseUrl,
      models,
      apiKey: discoverApiKey || undefined,
    })
  }

  return (
    <section>
      <h2 className="text-sm font-medium mb-1">添加自定义 OpenAI 兼容模型</h2>
      <p className="text-xs text-muted-foreground mb-3">
        指向任何兼容 OpenAI 的端点 — llama.cpp、LM Studio、vLLM、本地 Ollama 或远程网关。添加你想要路由的每个模型；它们共享同一个端点。API 密钥是可选的（大多数本地服务器不需要密钥）。
      </p>

      {/* Single model form */}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card mb-4">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-xs">基础 URL</Label>
          <Input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:11434/v1"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">模型</Label>
          <Input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="qwen3:4b"
            className="w-[180px] font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">显示名称</Label>
          <Input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="可选"
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">API 密钥</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="可选"
            className="w-[150px] font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm" disabled={!baseUrl || !model || addCustom.isPending}>
          {addCustom.isPending ? '添加中…' : '添加模型'}
        </Button>
      </form>
      {addCustom.isError && (
        <p className="text-destructive text-xs mt-2">{(addCustom.error as Error).message}</p>
      )}

      {/* Model discovery from /v1/models */}
      <details className="rounded-lg border p-4 bg-card mb-4">
        <summary className="text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground select-none">
          从端点自动发现模型
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">基础 URL</Label>
              <Input
                value={discoverBaseUrl}
                onChange={e => setDiscoverBaseUrl(e.target.value)}
                placeholder="https://token.sensenova.cn/v1"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API 密钥（可选）</Label>
              <Input
                type="password"
                value={discoverApiKey}
                onChange={e => setDiscoverApiKey(e.target.value)}
                placeholder="可选"
                className="w-[180px] font-mono text-xs"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDiscover}
              disabled={!discoverBaseUrl || discovering}
            >
              {discovering ? '正在查询…' : '发现模型'}
            </Button>
          </div>

          {discoverError && (
            <p className="text-destructive text-xs">{discoverError}</p>
          )}

          {discoverResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  发现 {discoverResult.models.length} 个模型（已选择 {selectedModels.size} 个）
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      const allIds = discoverResult.models.map(m => m.id)
                      setSelectedModels(prev => {
                        if (prev.size === allIds.length) return new Set()
                        return new Set(allIds)
                      })
                    }}
                  >
                    {selectedModels.size === discoverResult.models.length ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleBulkImport}
                    disabled={selectedModels.size === 0 || bulkImport.isPending}
                  >
                    {bulkImport.isPending ? '导入中…' : `导入所选 (${selectedModels.size})`}
                  </Button>
                </div>
              </div>
              {bulkImport.isSuccess && (
                <p className="text-emerald-600 text-xs">
                  成功导入 {(bulkImport.data as any)?.count ?? selectedModels.size} 个模型
                </p>
              )}
              <div className="max-h-60 overflow-y-auto rounded-lg border divide-y bg-card">
                {discoverResult.models.map(m => {
                  const alreadyExists = existingModelIds.has(m.id)
                  const selected = selectedModels.has(m.id)
                  return (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 ${
                        alreadyExists ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={alreadyExists}
                        onChange={() => toggleModelSelection(m.id)}
                        className="size-3.5"
                      />
                      <code className="text-xs font-mono">{m.id}</code>
                      {alreadyExists && (
                        <span className="text-[11px] text-muted-foreground">（已存在）</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </details>

      {/* Custom models list */}
      {customModels.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium mb-2 text-muted-foreground">已添加的模型 ({customModels.length})</h3>
          <div className="rounded-lg border divide-y bg-card overflow-hidden">
            {customModels.map(cm => (
              <div key={cm.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[cm.keyStatus] ?? statusDot.unknown}`} />
                <code className="text-xs font-mono flex-shrink-0">{cm.displayName}</code>
                {cm.baseUrl && (
                  <code className="text-xs font-mono text-muted-foreground">{cm.baseUrl}</code>
                )}
                {!cm.enabled && <span className="text-xs text-muted-foreground">(禁用)</span>}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm(`确定要删除模型 "${cm.displayName}" 吗？`)) {
                      deleteCustomModel.mutate(cm.modelId)
                    }
                  }}
                  disabled={deleteCustomModel.isPending}
                >
                  {deleteCustomModel.isPending ? '删除中…' : '移除'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState('')
  const [label, setLabel] = useState('')
  const [showConfigured, setShowConfigured] = useState(true)

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setBedrockAccessKeyId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'
  const needsBedrockRegion = platform === 'bedrock'
  const needsCompoundKey = needsAccountId || needsBedrockRegion

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsCompoundKey && !accountId) return
    if (needsBedrockRegion && bedrockAccessKeyId && !apiKey) return

    let key = apiKey
    if (needsAccountId) {
      key = `${accountId}:${apiKey}`
    } else if (needsBedrockRegion) {
      key = bedrockAccessKeyId
        ? `${accountId}:${bedrockAccessKeyId}:${apiKey}`
        : `${accountId}:${apiKey}`
    }

    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = [...PLATFORMS, CUSTOM_ENTRY].map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  return (
    <div>
      <PageHeader
        title="密钥"
        description="为 Groq、Google、Hugging Face、Together AI 等提供商添加密钥。客户端设置在「指南」标签页。"
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
              {checkAll.isPending ? '检查中…' : '全部检查'}
            </Button>
          )
        }
      />

      <div className="space-y-8">
        <UnifiedKeySection />

        <section>
          <h2 className="text-sm font-medium mb-3">添加提供商密钥</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
            <div className="space-y-1.5">
              <Label className="text-xs">平台</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="选择提供商" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {platform && PLATFORM_KEY_HELP[platform] && (
                <p className="text-[11px] text-muted-foreground max-w-[280px] leading-snug">
                  {PLATFORM_KEY_HELP[platform]}
                </p>
              )}
            </div>
            {needsCompoundKey && (
              <div className="space-y-1.5">
                <Label className="text-xs">{needsBedrockRegion ? 'AWS 区域' : '账户 ID'}</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder={needsBedrockRegion ? 'us-east-2' : 'a1b2c3d4…'}
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            {needsBedrockRegion && (
              <div className="space-y-1.5">
                <Label className="text-xs">访问密钥 ID</Label>
                <Input
                  value={bedrockAccessKeyId}
                  onChange={e => setBedrockAccessKeyId(e.target.value)}
                  placeholder="AKIA… (IAM, 可选)"
                  className="w-[200px] font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">
                {needsAccountId
                  ? 'API 令牌'
                  : needsBedrockRegion
                    ? (bedrockAccessKeyId ? '秘密访问密钥' : 'Bedrock API 密钥或密码')
                    : 'API 密钥'}
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={
                  needsBedrockRegion
                    ? (bedrockAccessKeyId ? 'secret key' : 'ABSK… 或密码 (使用 IAM)')
                    : needsAccountId
                      ? 'Bearer token'
                      : '在此粘贴密钥'
                }
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">标签</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="可选"
                className="w-[160px]"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={
                !platform
                || !apiKey
                || (needsCompoundKey && !accountId)
                || (needsBedrockRegion && !!bedrockAccessKeyId && !apiKey)
                || addKey.isPending
              }
            >
              {addKey.isPending ? '添加中…' : '添加密钥'}
            </Button>
          </form>
          {addKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
          )}
        </section>

        <CustomProviderSection />

        <section>
          {false && (
            <div>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">加载中…</p>
              ) : keys.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    还没有提供商密钥。在上面添加一个开始路由。
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {grouped.map(group => (
                    <div key={group.value}>
                      <div className="flex items-baseline justify-between mb-2">
                        <h3 className="text-sm font-medium">{group.label}</h3>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {group.keys.length} key{group.keys.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="rounded-lg border divide-y bg-card overflow-hidden">
                        {group.keys.map(k => {
                          const h = healthKeyMap.get(k.id)
                          const status = h?.status ?? k.status
                          const lastChecked = h?.lastCheckedAt
                          return (
                            <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                              <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                              <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                              {k.platform === 'custom' && k.baseUrl && (
                                <code className="text-xs font-mono text-muted-foreground">{k.baseUrl}</code>
                              )}
                              {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                              <span className="text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
                              <div className="flex-1" />
                              {lastChecked && (
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>
                                检查
                              </Button>
                              <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                                移除
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
