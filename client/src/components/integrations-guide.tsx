import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { getOpenAiBaseUrl, getProxyOrigin } from '@/lib/proxy-url'

/** Shown in setup snippets only — never the real key from the API. */
const KEY_PLACEHOLDER = 'YOUR_UNIFIED_KEY'

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {children}
    </pre>
  )
}

function IntegrationCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform mt-0.5">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-5 pb-5 pt-0 space-y-3 border-t">{children}</div>
    </details>
  )
}

export function IntegrationsGuide() {
  const origin = getProxyOrigin()
  const openAiBase = getOpenAiBaseUrl()
  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

  const claudeSettingsPath = isWindows
    ? '%USERPROFILE%\\.claude\\settings.json'
    : '~/.claude/settings.json'

  const codexConfigPath = isWindows
    ? '%USERPROFILE%\\.codex\\config.toml'
    : '~/.codex/config.toml'

  const codexCatalogPath = isWindows
    ? '%USERPROFILE%\\.codex\\freellmapikey-models.json'
    : '~/.codex/freellmapikey-models.json'

  const codexCatalogPathToml = isWindows
    ? 'C:\\\\Users\\\\<you>\\\\.codex\\\\freellmapikey-models.json'
    : '/Users/<you>/.codex/freellmapikey-models.json'

  const syncCatalog = useMutation({
    mutationFn: () =>
      apiFetch<{ path: string; modelCount: number; configSnippet: string }>('/api/codex/sync-catalog', {
        method: 'POST',
        body: '{}',
      }),
  })

  const codexConfig = `model_provider = "freellmapikey"
model = "auto"
model_reasoning_effort = "medium"
model_catalog_json = "${codexCatalogPathToml}"

[model_providers.freellmapikey]
name = "FreeLLMAPIKey (local)"
base_url = "${openAiBase}"
env_key = "CUSTOM_API_KEY"
wire_api = "responses"
requires_openai_auth = false

# Windows only — if Codex shows "Couldn't set up admin sandbox":
sandbox_mode = "danger-full-access"
approval_policy = "never"

[windows]
sandbox = "unelevated"

[sandbox_workspace_write]
network_access = true`

  const continueConfigPath = isWindows
    ? '%USERPROFILE%\\.continue\\config.yaml'
    : '~/.continue/config.yaml'

  const continueModelEntry = `  - name: FreeLLMAPIKey
    provider: openai
    model: auto
    apiBase: ${openAiBase}
    apiKey: ${KEY_PLACEHOLDER}
    roles:
      - chat
      - edit
      - apply
    capabilities:
      - tool_use
    defaultCompletionOptions:
      temperature: 0.7
      maxTokens: 4096`

  const continueConfigFull = `name: FreeLLMAPIKey (local)
version: 1.0.0
schema: v1
models:
${continueModelEntry}`

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        先在 <strong>密钥</strong> 页面添加提供商密钥。在代码片段中使用你的统一密钥（
        <code className="font-mono">{KEY_PLACEHOLDER}</code>）。VS Code 扩展和其他兼容 OpenAI 的客户端使用 <code className="font-mono">{openAiBase}</code>。Claude Code CLI 和 Codex 各自有{' '}
        <strong>配置本地代理</strong> 和 <strong>恢复工厂</strong> 部分见下方。通过代理的视觉请求会路由到支持视觉的模型（Gemini、Llama 4 等）。
      </p>

      <p className="text-xs font-medium text-foreground pt-1">VS Code 扩展</p>

      <IntegrationCard
        title="Continue (VS Code)"
        subtitle="Continue 扩展 — config.yaml 含 apiBase → 本地 /v1/chat/completions"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            在 VS Code 中安装{' '}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=Continue.continue"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Continue
            </a>{' '}
            扩展（此仓库的 <code className="font-mono">.vscode/extensions.json</code> 推荐安装）。
          </li>
          <li>启动 FreeLLMAPIKey 并在密钥页面添加提供商密钥。</li>
          <li>从上方复制你的统一密钥。</li>
          <li>
            打开 Continue 的配置：聊天输入 → 右上角 configs 下拉菜单 → <strong>本地配置</strong> 旁边的齿轮，或直接编辑{' '}
            <code className="font-mono">{continueConfigPath}</code>。
          </li>
          <li>
            使用下方其中一个 YAML 块添加 FreeLLMAPIKey（替换{' '}
            <code className="font-mono">{KEY_PLACEHOLDER}</code>），保存，如果模型未出现则重新加载 VS Code 窗口（<code className="font-mono">开发者：重新加载窗口</code>）。
          </li>
          <li>
            在 Continue 中，聊天前从模型/配置下拉菜单中选择 <strong>FreeLLMAPIKey</strong>。
          </li>
        </ol>
        <div
          className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-foreground"
          role="note"
        >
          <strong>已有配置？</strong> 不要替换整个文件。保留你现有的{' '}
          <code className="font-mono">name</code>、<code className="font-mono">version</code>、{' '}
          <code className="font-mono">schema</code>、<code className="font-mono">context</code> 和其他{' '}
          <code className="font-mono">models</code> 条目 — 在{' '}
          <code className="font-mono">models:</code> 下追加一个新的列表项（只能有一个 <code className="font-mono">models:</code>{' '}
          键）。只有当你希望 FreeLLMAPIKey 作为唯一模型时才替换整个文件。
        </div>
        <p className="text-xs font-medium text-foreground">已有配置 — 在 models 下追加：</p>
        <CodeBlock>{continueModelEntry}</CodeBlock>
        <p className="text-xs font-medium text-foreground">新安装 — 完整 config.yaml：</p>
        <CodeBlock>{continueConfigFull}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono">apiBase</code> 必须以 <code className="font-mono">/v1</code> 结尾（与 OpenAI SDK 的 <code className="font-mono">base_url</code> 相同）。使用 <code className="font-mono">model: auto</code> 跟随你的面板降级链，或从{' '}
          <code className="font-mono">GET {openAiBase}/models</code> 选择一个 slug（例如{' '}
          <code className="font-mono">gemini-2.5-flash</code>）。当路由的模型支持工具时，<code className="font-mono">tool_use</code> 启用 Continue Agent 模式。
        </p>
        <p className="text-xs text-muted-foreground">
          验证：发送一条简短聊天消息，然后在 <strong>分析 → 使用日志</strong> 中查看新行。响应头包含 <code className="font-mono">x-routed-via</code>，显示处理请求的提供商/模型。Continue 仅使用 Chat Completions——它不使用 Codex 的{' '}
          <code className="font-mono">/v1/responses</code> 或 Claude 的{' '}
          <code className="font-mono">/v1/messages</code>。
        </p>
        <p className="text-xs font-medium text-foreground">配置后使用 Continue</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            打开 Continue 侧边栏：<code className="font-mono">Ctrl+L</code>（Windows/Linux）或{' '}
            <code className="font-mono">Cmd+L</code>（macOS），或点击活动栏中的 Continue 图标。
          </li>
          <li>
            在聊天输入上方，打开配置/代理下拉菜单 → 如有提示选择 <strong>本地配置</strong>。
          </li>
          <li>
            选择 <strong>FreeLLMAPIKey</strong> 作为活动模型，然后发送消息（例如{' '}
            <code className="font-mono">回复内容精确为：freellmapikey-OK</code>）。
          </li>
          <li>
            在 <strong>分析 → 使用日志</strong> 中确认新行。标签页自动补全使用单独的模型，除非你添加 <code className="font-mono">autocomplete</code> 角色条目。
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          文档：{' '}
          <a
            href="https://docs.continue.dev/reference/"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            config.yaml 参考
          </a>
          。
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="Cline (VS Code)"
        subtitle="OpenAI 兼容提供商 — 设置 UI，Plan/Act 代理"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            在 VS Code 中安装{' '}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cline
            </a>{' '}
            （也在 <code className="font-mono">.vscode/extensions.json</code> 中推荐）。
          </li>
          <li>启动 FreeLLMAPIKey 并在密钥页面添加提供商密钥。</li>
          <li>从上方复制你的统一密钥。</li>
          <li>
            打开 Cline 面板（活动栏）→ <strong>设置</strong>（齿轮图标）→ 将{' '}
            <strong>API 提供商</strong> 设为 <strong>OpenAI Compatible</strong>（可能显示为{' '}
            <code className="font-mono">openai-compatible</code>）。
          </li>
          <li>
            填写 <strong>基础 URL</strong> <code className="font-mono">{openAiBase}</code>，<strong>API 密钥</strong>{' '}
            <code className="font-mono">{KEY_PLACEHOLDER}</code>，和 <strong>模型 ID</strong>{' '}
            <code className="font-mono">auto</code>（或从{' '}
            <code className="font-mono">GET {openAiBase}/models</code> 获取的 slug）。
          </li>
          <li>如果设置面板提供验证功能则使用 <strong>验证</strong>，然后在 Cline 聊天中开始一个任务。</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Cline 使用 <code className="font-mono">/v1/chat/completions</code> 并通过工具调用运行其代理循环。如果 Plan 和 Act 模式显示不同的模型字段，将两者都设为 <code className="font-mono">auto</code> 或相同的 slug。首次消息后检查 <strong>分析 → 使用日志</strong>。
        </p>
        <p className="text-xs text-muted-foreground">
          文档：{' '}
          <a
            href="https://docs.cline.bot/provider-config/openai-compatible"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI 兼容提供商
          </a>
          。
        </p>
      </IntegrationCard>

      <p className="text-xs font-medium text-foreground pt-2">Claude Code &amp; Codex</p>

      <IntegrationCard
        title="Claude Code (CLI)"
        subtitle="配置本地代理或恢复为 Anthropic 默认路由"
      >
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
          role="note"
        >
          <strong>仅限 CLI。</strong> 本地代理适用于 <code className="font-mono">claude</code> 终端命令。
          Claude <strong>桌面版</strong>（Code 标签页）无法覆盖{' '}
          <code className="font-mono">ANTHROPIC_BASE_URL</code>——它仍然使用{' '}
          <code className="font-mono">api.anthropic.com</code>。
        </div>

        <p className="text-xs font-medium text-foreground">配置本地代理</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>在密钥页面添加提供商密钥（如果发送图片请包含 Google 或 Llama 4）。</li>
          <li>从上方复制你的统一密钥。</li>
          <li>
            在终端中使用以下环境变量运行 <code className="font-mono">claude</code>（不要在 Claude 桌面版中运行）。
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">macOS / Linux</p>
        <CodeBlock>{`export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_API_KEY="${KEY_PLACEHOLDER}"
claude`}</CodeBlock>
        <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
        <CodeBlock>{`$env:ANTHROPIC_BASE_URL = "${origin}"
$env:ANTHROPIC_API_KEY = "${KEY_PLACEHOLDER}"
cd C:\\path\\to\\your\\project
claude`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">可选：settings.json</p>
        <p className="text-xs text-muted-foreground">
          CLI 也读取 <code className="font-mono">{claudeSettingsPath}</code>：
        </p>
        <CodeBlock>{`{
  "env": {
    "ANTHROPIC_BASE_URL": "${origin}",
    "ANTHROPIC_API_KEY": "${KEY_PLACEHOLDER}"
  }
}`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          如果看到关于 <strong>claude.ai 令牌</strong> 和{' '}
          <code className="font-mono">ANTHROPIC_API_KEY</code> 的警告，在 CLI 中运行 <code className="font-mono">/logout</code>，退出，只设置上述环境变量，然后重新运行 <code className="font-mono">claude</code>。用{' '}
          <code className="font-mono">回复内容精确为：freellmapikey-OK</code> 测试，然后在{' '}
          <strong>分析 → 使用日志</strong> 中确认（提供商应该是 google/groq/cerebras，不是 anthropic）。
        </p>
        <p className="text-xs text-muted-foreground">
          端点：<code className="font-mono">POST /v1/messages</code> 和{' '}
          <code className="font-mono">POST /v1/messages/count_tokens</code>。像{' '}
          <code className="font-mono">claude-sonnet-4-…</code> 这样的名称是标签——代理通过你的降级链自动路由。
        </p>

        <p className="text-xs font-medium text-foreground pt-2 border-t pt-3">恢复为 Anthropic 默认路由</p>
        <p className="text-xs text-muted-foreground">
          当你想再次使用 <code className="font-mono">https://api.anthropic.com</code> 和你的 Anthropic 或 claude.ai 订阅时使用此方法。
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            从 shell 配置文件、会话和{' '}
            <code className="font-mono">{claudeSettingsPath}</code> 中移除代理覆盖（如果{' '}
            <code className="font-mono">env</code> 块仅用于 FreeLLMAPIKey，则删除它）。
          </li>
          <li>
            如果混合了 FreeLLMAPIKey 密钥与 claude.ai 登录，在 <code className="font-mono">claude</code> 中运行 <code className="font-mono">/logout</code>，然后正常使用 Anthropic 登录。
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">macOS / Linux — 清除代理环境变量</p>
        <CodeBlock>{`unset ANTHROPIC_BASE_URL
unset ANTHROPIC_API_KEY   # 如果你在这里设置了 FreeLLMAPIKey 统一密钥
claude`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Windows (PowerShell) — 清除代理环境变量</p>
        <CodeBlock>{`Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
claude`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          恢复后，此面板中的使用日志应保持为空 — 流量不再经过 FreeLLMAPIKey。
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI Codex (CLI &amp; 桌面版)"
        subtitle="配置本地代理或恢复为 OpenAI 默认路由"
      >
        <p className="text-xs font-medium text-foreground">配置本地代理</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>启动 FreeLLMAPIKey 并在密钥页面添加提供商密钥。</li>
          <li>将 <code className="font-mono">CUSTOM_API_KEY</code> 设为你的统一密钥（与上方相同的值）。</li>
          <li>
            编辑 <code className="font-mono">{codexConfigPath}</code>（Codex → 设置 → 打开 config.toml），粘贴下面的代码块，保存，然后完全退出并重新打开 Codex。
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">环境变量</p>
        <CodeBlock>
          {isWindows
            ? `set CUSTOM_API_KEY=${KEY_PLACEHOLDER}`
            : `export CUSTOM_API_KEY="${KEY_PLACEHOLDER}"`}
        </CodeBlock>
        <p className="text-xs font-medium text-foreground">模型目录（可选）</p>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono">model = "auto"</code> 不需要。当你希望在配置或 CLI 中使用目录 slug（例如{' '}
          <code className="font-mono">gemini-2.5-flash</code>）时使用 <code className="font-mono">model_catalog_json</code>。更改密钥或降级链后重新生成。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncCatalog.isPending}
            onClick={() => syncCatalog.mutate()}
          >
            {syncCatalog.isPending ? '正在写入目录…' : '写入 Codex 模型目录'}
          </Button>
          {syncCatalog.isSuccess && (
            <span className="text-xs text-muted-foreground">
              已写入 {syncCatalog.data.modelCount} 个模型到 {syncCatalog.data.path}
            </span>
          )}
          {syncCatalog.isError && (
            <span className="text-xs text-destructive">无法写入目录——服务器是否在运行？</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          默认路径：<code className="font-mono">{codexCatalogPath}</code>。CLI：{' '}
          <code className="font-mono">npm run codex:model-catalog</code>
        </p>
        <p className="text-xs font-medium text-foreground">config.toml（本地代理）</p>
        <CodeBlock>{codexConfig}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          使用 <code className="font-mono">model = "auto"</code> 跟随你的降级链。固定一个 slug 如{' '}
          <code className="font-mono">gemini-2.5-flash</code> 来强制使用一个后端。在 Codex 消息后检查{' '}
          <strong>分析 → 使用日志</strong>。
        </p>

        <p className="text-xs font-medium text-foreground pt-2 border-t pt-3">恢复为 OpenAI 默认路由</p>
        <p className="text-xs text-muted-foreground">
          当你想让 Codex 使用 OpenAI 登录和 <code className="font-mono">api.openai.com</code> 时使用此方法。
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            从 <code className="font-mono">{codexConfigPath}</code> 中删除 <code className="font-mono">[model_providers.freellmapikey]</code> 和所有{' '}
            <code className="font-mono">model_provider = "freellmapikey"</code> 行。
          </li>
          <li>
            如果 <code className="font-mono">model_catalog_json</code> 指向{' '}
            <code className="font-mono">{codexCatalogPath}</code>，则移除它（可选：删除该 JSON 文件）。
          </li>
          <li>
            如果仅在此处使用则取消设置 <code className="font-mono">CUSTOM_API_KEY</code>（
            <code className="font-mono">Remove-Item Env:CUSTOM_API_KEY</code> 在 PowerShell 中）。
          </li>
          <li>
            将 <code className="font-mono">model_provider</code> 设为 <code className="font-mono">"openai"</code>，在 Codex 设置中用 OpenAI 登录，退出并重新打开 Codex。
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">config.toml（默认路由）</p>
        <CodeBlock>{`model_provider = "openai"
# model = "gpt-5.3-codex"   # 可选——登录后在 Codex UI 中选择`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          文档：{' '}
          <a
            href="https://developers.openai.com/codex/config"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Codex 配置
          </a>
          。
        </p>
      </IntegrationCard>

      <p className="text-xs font-medium text-foreground pt-2">本地代理（兼容 OpenAI）</p>

      <IntegrationCard
        title="OpenAI SDK &amp; 其他 Chat Completions 客户端"
        subtitle="Cursor、自定义应用——标准 /v1/chat/completions"
      >
        <CodeBlock>{`from openai import OpenAI

client = OpenAI(
    base_url="${openAiBase}",
    api_key="${KEY_PLACEHOLDER}",
)

client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
)`}</CodeBlock>
      </IntegrationCard>
    </section>
  )
}
