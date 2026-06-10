import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'

import HomePage from '@/views/HomePage'

export default function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
