import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { formatLocalDateTime, formatLocalTime, formatTimelineLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'

type TimeRange = '24h' | '7d' | '30d'

function formatTokens(n?: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function Stat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-1 ${className ?? ''}`}>{value}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const axisStyle = { fontSize: 11, fill: 'var(--muted-foreground)' } as const
const gridStyle = 'var(--border)'
const primaryFill = 'var(--foreground)'

export default function AnalyticsPage() {
  const queryClient = useQueryClient()
  const [range, setRange] = useState<TimeRange>('7d')

  const resetMutation = useMutation({
    mutationFn: () => apiFetch<{ deleted: number }>('/api/analytics/reset', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['fallback', 'token-usage'] })
    },
  })

  const clearErrorLogMutation = useMutation({
    mutationFn: () => apiFetch<{ deletedDb: number; clearedFile: boolean }>('/api/analytics/error-log/reset', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics', 'error-log'] })
    },
  })

  function handleResetAnalytics() {
    const ok = window.confirm(
      '删除所有请求历史？分析图表和降级链的月度 token 柱状图将重置为零。详细错误日志会保留以便调试。API 密钥和降级顺序不会改变。',
    )
    if (!ok) return
    resetMutation.mutate()
  }

  function handleClearErrorLog() {
    const ok = window.confirm('删除详细错误日志（数据库 + error.log 文件）？')
    if (!ok) return
    clearErrorLogMutation.mutate()
  }

  const { data: summary } = useQuery({
    queryKey: ['analytics', 'summary', range],
    queryFn: () => apiFetch<any>(`/api/analytics/summary?range=${range}`),
  })

  const { data: byPlatform = [] } = useQuery({
    queryKey: ['analytics', 'by-platform', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-platform?range=${range}`),
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['analytics', 'timeline', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/timeline?range=${range}`),
  })

  const { data: byModel = [] } = useQuery({
    queryKey: ['analytics', 'by-model', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-model?range=${range}`),
  })

  const { data: errors = [] } = useQuery({
    queryKey: ['analytics', 'errors', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/errors?range=${range}`),
  })

  const { data: errorDist } = useQuery({
    queryKey: ['analytics', 'error-distribution', range],
    queryFn: () => apiFetch<{ byCategory: any[]; byPlatform: any[]; detailed: any[] }>(`/api/analytics/error-distribution?range=${range}`),
  })

  const { data: fallbackSettings } = useQuery({
    queryKey: ['fallback'],
    queryFn: () => apiFetch<{ visionOnlyRouting: boolean }>('/api/fallback'),
  })

  const { data: usageLog } = useQuery({
    queryKey: ['analytics', 'usage-log', range],
    queryFn: () => apiFetch<{ entries: any[] }>(`/api/analytics/usage-log?range=${range}&limit=100`),
  })

  const { data: errorLog } = useQuery({
    queryKey: ['analytics', 'error-log', range],
    queryFn: () => apiFetch<{ filePath: string; entries: any[] }>(`/api/analytics/error-log?range=${range}&limit=100`),
  })

  return (
    <div>
      <PageHeader
        title="分析"
        description="请求量、延迟、token 使用量和失败情况。视觉列显示哪些模型可以接受图片（与降级链相同）。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-md border p-0.5">
              {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
                <Button
                  key={r}
                  variant={range === r ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => setRange(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearErrorLog}
              disabled={clearErrorLogMutation.isPending}
            >
              {clearErrorLogMutation.isPending ? '清除中…' : '清除错误日志'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAnalytics}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? '重置中…' : '重置分析'}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {fallbackSettings?.visionOnlyRouting && (
          <p className="text-sm text-muted-foreground rounded-lg border bg-card px-4 py-3">
            <span className="font-medium text-foreground">仅视觉路由已开启。</span>{' '}
            下方标记为视觉的模型才会被用于所有 API 流量（包括 Codex）。此表中的纯文本模型是启用该设置之前的历史记录。
          </p>
        )}

        {/* Summary stats */}
        <p className="text-xs text-muted-foreground">
          Token counts for the selected time range ({range}). Streaming requests use estimated input size unless the provider reports usage.
          Failed fallback hops no longer add duplicate input. The Fallback budget bar uses calendar-month usage and may differ.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="请求数" value={summary?.totalRequests ?? 0} />
          <Stat label="成功率" value={`${summary?.successRate ?? 0}%`} />
          <Stat label="输入 tokens" value={formatTokens(summary?.totalInputTokens)} />
          <Stat label="输出 tokens" value={formatTokens(summary?.totalOutputTokens)} />
          <Stat label="平均延迟" value={`${summary?.avgLatencyMs ?? 0} ms`} />
          <Stat label="预估节省" value={`$${summary?.estimatedCostSavings ?? '0.00'}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel title="按提供商统计请求">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="requests" fill={primaryFill} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="按提供商统计平均延迟">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis unit="ms" tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="avgLatencyMs" name="Latency (ms)" fill="var(--muted-foreground)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <div className="lg:col-span-2">
            <Panel title="随时间变化的请求">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={timeline} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                    <XAxis
                      dataKey="timestamp"
                      tick={axisStyle}
                      tickLine={false}
                      axisLine={{ stroke: gridStyle }}
                      tickFormatter={(v) => formatTimelineLabel(String(v), range === '24h')}
                    />
                    <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(v) => formatTimelineLabel(String(v), range === '24h')}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="line" />
                    <Line type="monotone" dataKey="successCount" name="成功" stroke={primaryFill} strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="failureCount" name="失败" stroke="var(--destructive)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-2">
            <Panel title="每模型明细">
              {byModel.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto -mx-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">模型</TableHead>
                        <TableHead>视觉</TableHead>
                        <TableHead>提供商</TableHead>
                        <TableHead className="text-right">请求数</TableHead>
                        <TableHead className="text-right">成功</TableHead>
                        <TableHead className="text-right">延迟</TableHead>
                        <TableHead className="text-right">输入 tokens</TableHead>
                        <TableHead className="text-right pr-4">输出 tokens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byModel.map((m: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4 text-sm font-medium">{m.displayName}</TableCell>
                          <TableCell>
                            {m.supportsVision ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                                是
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.platform}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.requests}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.successRate}%</TableCell>
                          <TableCell className="text-right tabular-nums">{m.avgLatencyMs} ms</TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(m.totalInputTokens)}</TableCell>
                          <TableCell className="text-right tabular-nums pr-4">{formatTokens(m.totalOutputTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="错误分布">
            {!errorDist?.byCategory?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">No errors</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={errorDist.byCategory} margin={{ top: 6, right: 6, left: -12, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis
                    dataKey="category"
                    tick={axisStyle}
                    tickLine={false}
                    axisLine={{ stroke: gridStyle }}
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="按提供商统计错误">
            {!errorDist?.byPlatform?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">No errors</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={errorDist.byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="最近错误">
            {errors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No errors</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto -mx-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">提供商</TableHead>
                      <TableHead>消息</TableHead>
                      <TableHead className="text-right pr-4">时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errors.slice(0, 20).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="pl-4 text-xs">{e.platform}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{e.error}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums pr-4">
                          {formatLocalTime(e.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="使用日志">
          <p className="text-xs text-muted-foreground mb-3">
            选定时间范围 ({range}) 内每次成功的路由请求，按最新优先。用于确认 Continue、Cline、Playground 或其他兼容 OpenAI 的客户端何时访问代理，以及由哪个提供商/模型处理了请求。重置分析时会被清除。
          </p>
          {!usageLog?.entries?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">暂无成功请求</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto -mx-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">时间</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>提供商</TableHead>
                    <TableHead>视觉</TableHead>
                    <TableHead className="text-right">输入</TableHead>
                    <TableHead className="text-right">输出</TableHead>
                    <TableHead className="text-right pr-4">延迟</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageLog.entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatLocalDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{e.displayName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.platform}</TableCell>
                      <TableCell className="text-xs">
                        {e.supportsVision ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                            是
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{formatTokens(e.inputTokens)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{formatTokens(e.outputTokens)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums pr-4">{e.latencyMs} ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="错误日志 (调试)">
          <p className="text-xs text-muted-foreground mb-3">
            故障排除的详细失败信息（端点、视觉标志、重试、完整消息）。
            同时保存到{' '}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">{errorLog?.filePath ?? 'server/data/error.log'}</code>
            。重置分析时不会清除。
          </p>
          {!errorLog?.entries?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">无错误日志条目</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto -mx-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">时间</TableHead>
                    <TableHead>端点</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>类别</TableHead>
                    <TableHead>标志</TableHead>
                    <TableHead className="pr-4">消息</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errorLog.entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatLocalDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">{e.endpoint}</TableCell>
                      <TableCell className="text-xs">
                        {e.displayName ?? e.platform ?? '—'}
                        {e.attempt != null && (
                          <span className="text-muted-foreground"> · try {e.attempt + 1}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{e.errorCategory}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {e.hasImages && <Badge variant="outline" className="text-[10px]">img</Badge>}
                          {e.requiresVision && <Badge variant="outline" className="text-[10px]">vision</Badge>}
                          {e.willRetry && <Badge variant="outline" className="text-[10px]">retry</Badge>}
                          {e.stream && <Badge variant="outline" className="text-[10px]">stream</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs pr-4 max-w-md whitespace-pre-wrap break-words">
                        {e.errorMessage}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
