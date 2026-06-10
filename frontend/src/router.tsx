import type { ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAccessibleTools } from '@/hooks/useAccessibleTools'

import HomePage from '@/views/HomePage'
import Ask from '@/views/ask/Ask'
import ReleaseNotes from '@/views/release-notes/ReleaseNotes'
import SprintSummary from '@/views/sprint-summary/SprintSummary'
import Sync from '@/views/sync/Sync'
import Planner from '@/views/planner/Planner'
import PromptBuilder from '@/views/prompt-builder/PromptBuilder'
import FlowMetrics from '@/views/flow-metrics/FlowMetrics'
import Hygiene from '@/views/hygiene/Hygiene'

/** Port of the Vue router's beforeEach guard — block disabled tools. */
function RequireTool({ toolId, children }: { toolId: string; children: ReactNode }) {
  const { ids, loaded } = useAccessibleTools()
  if (!loaded) return null                       // wait for the one-time fetch
  if (!ids.includes(toolId)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />

        <Route path="/ask" element={<RequireTool toolId="ask"><Ask /></RequireTool>} />
        <Route path="/release-notes" element={<RequireTool toolId="release-notes"><ReleaseNotes /></RequireTool>} />
        <Route path="/sprint-summary" element={<RequireTool toolId="sprint-summary"><SprintSummary /></RequireTool>} />
        <Route path="/sync" element={<RequireTool toolId="sync"><Sync /></RequireTool>} />
        <Route path="/planner" element={<RequireTool toolId="planner"><Planner /></RequireTool>} />
        <Route path="/prompt-builder" element={<RequireTool toolId="prompt-builder"><PromptBuilder /></RequireTool>} />
        <Route path="/flow-metrics" element={<RequireTool toolId="flow-metrics"><FlowMetrics /></RequireTool>} />
        <Route path="/hygiene" element={<RequireTool toolId="hygiene"><Hygiene /></RequireTool>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
