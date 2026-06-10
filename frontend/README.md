# Cadence frontend — React + TypeScript

The Cadence SPA: React 18 + TypeScript + Vite + TailwindCSS 4. (A complete
rewrite of the original Vue 3 frontend, which was retired in June 2026 —
backup tarball in /tmp.)

## Run

```bash
npm install
npm run dev      # Vite on :5173, proxies /api etc. to FastAPI on :8765
npm run build    # type-check + production build to dist/
```

## Shared layer (DRY core)

- `src/lib/` — `api.ts`, `tags.ts`, `jql.ts` (framework-agnostic utilities)
- `src/hooks/` — `useDarkMode`, `useProject`, `useAccessibleTools`
- `src/components/` — `AppSidebar`, `TagBadge`, `AppTooltip`, `AppCheckbox`,
  `AppRadio`, `DrillDrawer`, `AppInfoPanel`, `IssueRow`, `EmptyState`,
  `SquadSelector`, `TimeframePicker`
- `src/constants/`, `src/types/` — squads, tool metadata, domain types

## Migration status — ✅ complete

All 6 tools are ported and verified building (`tsc --noEmit` + Vite):
Home, the shared component/hook library, **Sync Now (sync)**,
**Release Notes**, **Sprint Summary**, **Ask**, **Squad Pulse**
(heatmap / dynamics / detail, PNG export, sparklines), and the
**Epic Planner** (simulation engine, scope table, drag-and-drop Gantt
timeline with lanes, release tails, and what-if scenarios).

(The product was slimmed to 6 modules in June 2026 — 7 tools were removed
from the registry; backup tarball in /tmp.)
