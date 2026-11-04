# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

- The requirements and demo design spec is `医药招商与流向库存系统_功能需求与Demo设计_V0.2.docx` (V0.2, 2026-11-03). It is the source of truth.
- `demo/` holds the base demo: React 18, Vite, TypeScript, antd 5 and @ant-design/plots. It is a frontend-only SPA with no backend; the "service layer" is simulated in the browser.

Commands (run inside `demo/`):
- `npm run dev`: dev server at http://localhost:7321
- `npm run build`: `tsc -b` plus a Vite build. The type check is strict with `noUnusedLocals`.
- `npm test`: vitest. Run a single test with `npx vitest run --globals -t "<test name>"`.

`src/metrics/metrics.test.ts` locks in the scenario numbers seeded in the mock data:
- Sep ¥1.2M → Oct ¥960k; customer A −¥150k, customer B −¥60k; the top 2 account for 87.5% of the drop
- SKU-X averages 8 boxes/day; 25 days ≈ 200 boxes
- A batch present in two warehouses counts as 1
- Duplicate imports are deduplicated

If you change `src/data/mock.ts`, these tests must still pass.

Code layout (`demo/src`):
- `data/mock.ts`: the single seeded dataset (fixed random seed, fictional names).
- `data/query.ts`: permission scope by role, `makeMeta`, CSV export.
- `data/store.tsx`: React context holding the writable state for the four business-development pages and the task center. All state changes go through action functions that return `Result` (they validate, write history and never delete records). State is persisted to localStorage.
- `data/targets.ts`: demo sales targets (owner × region, Jul–Dec 2026; Oct total ¥1.2M) and the customer → owner mapping. Kept separate from `mock.ts` so the seeded RNG sequence is untouched.
- `metrics/salesMgmt.ts`: sales-manager rules (customer churn risk scoring with `RISK_RULES`, target progress, Q4 time progress), locked by `salesMgmt.test.ts`. `ai/manager.ts` uses them for the churn, target-gap, team and meeting-pack answers.
- `metrics/index.ts`: deterministic metrics and rules (net sales, comparisons and contributions, expiry, coverage, authorization status and scope hits). Pages and the AI share it.
- `ai/engine.ts`: rule-parsing mode with no LLM connected. Questions become a `query_spec`, the metrics layer computes, and the answer comes back with a definitions card, `query_id` and evidence. `ai/AiPanel.tsx` provides the side drawer and the chat, and pages register their context through `usePageAiContext`.
- `ai/tier2.ts`: business-development funnel diagnosis, expiring-stock clearance suggestions (candidate customers) and authorization/promotion health, locked by `ai/tier2.test.ts`. `ai/insights.ts` builds the AI经营洞察 cards (`/insights`, an extra menu entry outside the spec's 14 pages). The header "异动" badge counts its high-priority items; reminder tasks are created only after the user confirms.
- `components/AiDiag.tsx`: in-page AI diagnosis panel (`AiDiagPanel` with KPIs, inline analysis of observed vs to-verify items, and a task-draft confirm modal). It is shown as an "AI …" tab next to the list on Opportunities (funnel), Inventory (clearance), Authorizations (health), SalesCompare (change explanation) and the FlowQuery pages. `ai/flowAnalysis.ts` analyzes the current query result against the same filters in the previous period, locked by `flowAnalysis.test.ts`.
- `components/BriefDoc.tsx`: the 经营简报 tab on `/insights`, showing the monthly brief and the weekly meeting pack as a document preview with editing and Word/Markdown download or print.
- `components/common.tsx`: `ResultTable` (current-page selection vs. select-all-results, export creates a task-center record), `MetaBar`, `StatusTag` (text plus icon).
- `components/drill.tsx`: global SKU and customer drill-down drawers.
- `pages/`: one file per page. `FlowQuery.tsx` is the shared template for P05, P06 and P08.

To read the spec without pandoc:
`unzip -p *.docx word/document.xml | sed -e 's/<\/w:p>/\n/g' -e 's/<[^>]*>//g'`
Chapters: 4 (page specs), 5 (data model and metric definitions), 6 (AI), 7 (architecture and API), 8 (mock data and acceptance cases AC01–AC20).

## What is being built

The project rebuilds a pharma business-development (招商), flow (流向) and inventory query and analysis platform as a **demo**. The demo does not cover transactions: no ordering, warehouse operations, finance, commissions or settlement. It has 14 page entries, and the page IDs are fixed by the spec:

- P01 经营工作台 (dashboard)
- Business development (招商), four separate pages in this nav order: P03 招商进度管理 (opportunities), P13 合伙人授权 (partner authorizations), P02 招商目录管理 (catalogue), P14 合伙人推广 (partner promotions)
- Queries: P04 客户汇总, P05 进货流向, P06 销售流向, P07 调拨流向 (query and compare tabs), P08 仓储流向, P09 销售对比, P10 库存管理 (SKU and batch tabs)
- P11 任务中心: business to-dos, kept separate from import/export jobs
- P12 AI经营助手: a standalone chat page, plus a context-aware side panel on every page

## Architecture (spec ch. 7)

Layers: pages/interaction → business services (permissions enforced server-side) → **metrics and rules layer, shared by the web pages and the AI** → AI orchestration (calls controlled tools only) → data/ingestion. No microservices are needed for the demo.

- All pages read **one shared, linked mock dataset** through one data service. Do not create per-page fake data. Mock-data scale and the required edge cases are in spec ch. 8.
- The fixed demo date is **2026-11-03**. History runs from 2025-09 to 2026-10. Inventory uses one fixed snapshot. Label the UI "演示数据" (demo data).
- Every query response carries `query_id`, `data_as_of`, `metric_version`, `applied_filters` and `permission_scope_summary`. Lists, totals, exports and AI answers share the same query spec and data version.
- Write and state-change endpoints use an idempotency key plus `expected_version`. State transitions go through separate action endpoints (for example `POST /authorizations/{id}/actions`), not generic PATCH requests.
- Date ranges are half-open `[start, end)` internally and shown as inclusive dates in the UI.
- Model API keys stay on the backend. If the model fails, reports and queries must keep working. Scripted (pre-recorded) AI answers must be labelled as script mode.

## Domain rules that are easy to get wrong

- **Units:** never add up quantities across SKUs or across units (盒/瓶/支 = box/bottle/vial). Group by SKU and base unit.
- **Inventory terms:** 总库存 (total), 有效库存 (effective), 当前库存 (current) and 可用库存 (available) are four different metrics. Do not merge or rename them. Never compute an inventory value from sale prices.
- **Net sales:** sales count as positive and returns as negative. If the comparison base is ≤0, show no percentage change. Days of coverage are available quantity divided by the 30-day average daily external net sales. Internal transfers are excluded. If that 30-day net sales figure is ≤0, show no estimate.
- **Expiring batches:** count each (owner, SKU, batch) once, even when the same batch sits in several warehouses. Windows of 30, 60 and 90 days are demo settings.
- **Joins:** aggregate flows and inventory per SKU and scope before joining, so many-to-many joins cannot inflate the numbers.
- Missing, 0 and unknown are three different states. Never show 0 when a value is missing.
- **Business development objects are independent**, each with its own ID and state:
  - Confirming an opportunity only creates an authorization *draft*.
  - An authorization has two separate state dimensions: review (草稿/待确认/已通过/已退回/已撤回 = draft/pending/approved/returned/withdrawn) and business (未生效/生效中/已暂停/已到期/已终止 = not yet effective/effective/suspended/expired/terminated).
  - Renewals and changes create new versions. Inside one scope item, every dimension must match. Across scope items, the result is the union. An empty scope means incomplete, never "unlimited".
  - Finishing a promotion is not a deal. Pausing a catalogue item does not revoke authorizations.
  - Business authorizations **never** widen a user's system data permissions.
- **AI:** the LLM turns questions into a structured `query_spec` (see the AI01 example in ch. 6). The metrics service does the calculations, and permissions are injected server-side, never taken from the model. Observed changes are kept apart from unverified explanations. The AI never auto-approves, auto-confirms or sends anything externally. Generated tasks and reports are drafts until a user confirms them.

## UI conventions (spec ch. 3)

- Layout: left nav, dense tables, an "advanced filters" section and a collapsible AI side panel on the right.
- Target viewport is 1440×900; also check 1280×720. Blue and white palette. Show risk with text and an icon, not color alone.
- Default page size is 20 (50 and 100 also available). A new search returns to page 1. "Select all" means the current page only; selecting the full result set is a separate action.
- Say whether a total covers the current page or the full result set.
- Drill-downs keep their filters, and going back keeps the list position.
- Show the "no permission" state separately from "no results".
- **Query pages show data with default filters as soon as they open** (the user asked for this explicitly). Don't show a "not queried yet" empty state that waits for a click on Search; Search and Reset only change the filters.
