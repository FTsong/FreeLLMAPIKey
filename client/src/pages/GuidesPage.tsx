import { PageHeader } from '@/components/page-header'
import { IntegrationsGuide } from '@/components/integrations-guide'
import { UnifiedKeySection } from '@/components/unified-key-section'

export default function GuidesPage() {
  return (
    <div>
      <PageHeader
        title="指南"
        description="本地代理和工厂回滚的客户端设置 — VS Code、Claude Code CLI、Codex 和 OpenAI SDK。"
      />

      <div className="space-y-8">
        <UnifiedKeySection />
        <IntegrationsGuide />
      </div>
    </div>
  )
}
