import type { ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAccessibleTools } from '@/hooks/useAccessibleTools'

import HomePage from '@/views/HomePage'
import Ask from '@/views/ask/Ask'
import Sync from '@/views/sync/Sync'

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
        <Route path="/sync" element={<RequireTool toolId="sync"><Sync /></RequireTool>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
