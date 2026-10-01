# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (port 5173)
npm run build         # tsc -b && vite build
npm run lint           # eslint .
npm run format          # prettier --check (src/**/*.{ts,tsx,css}, root *.{js,json,html}, supabase/tests/**/*.ts)
npm run format:write     # prettier --write, same globs
npm run typecheck        # tsc -b --pretty false
npm run test           # vitest run
npm run test:watch        # vitest
npx vitest run src/services/evidence/scoring.test.ts   # run a single test file
```

Test files are colocated as `*.test.ts` next to source (e.g. `src/config/env.test.ts`, `src/providers/registry.test.ts`), plus contract tests in `supabase/tests/*.test.ts`. Vitest runs in `environment: 'node'` (not jsdom). `supabase/functions/**` (Deno) is excluded from ESLint and is not part of the vitest/tsc project.

## Product overview

AI Sales OS — a multi-tenant (single-tenant-constant today, see `src/domain/tenant.ts`) sales/lead-gen automation system. Closed-loop workflow: **Product → Audience → Route + Find → Engage → Track + Learn**, with human approval required before external/mutating actions. Full spec lives in `docs/AI Sales OS — Product & System Requirements (v2).md`, engineering plan in `docs/AI_Sales_OS_V2_Engineering_Implementation_Plan.md`, and `docs/Admin_Analytics_Engineering_Implementation_Plan.md` for the admin analytics layer.

Core domain concepts (each maps to a `src/services/<name>` module and usually a `supabase/functions/sales_os-*` edge function):

- **product** — the input software product; a "Product Sales Profile" (problems solved, ICP triggers, pricing) is canonical context for everything downstream.
- **audience** — hypothesized buyer segments, evidence-validated, with lifecycle `Proposed → Approved → Active → Paused → Rejected`.
- **discovery** — "Route + Find": Social/Community (e.g. Reddit) vs Direct/Cold (org → role → contact) routes that produce "opportunities". `routeGuard.ts` enforces which route rules apply.
- **evidence** — deterministic scoring rubric (`EVIDENCE_RUBRIC_V1`: evidence count, source diversity, signal specificity, recency) producing a Confidence score, kept distinct from the AI's qualitative Fit Assessment.
- **contacts** — verified contact info plus per-product suppression/do-not-contact lists (never shared across products).
- **engagement** — drafting/executing the recommended action under human approval; community posts must go out via a fixed, manually-created branded account (never an AI-selected identity).
- **events** — funnel tracking (Found → Qualified → ... → Purchased), retaining the source/signal/CTA/provider dimensions that produced each event.
- **attribution** — records both first-touch (origin) and last-touch-within-30-day-window (closer) per conversion; neither is discarded.
- **learning** — periodic analysis of outcomes into evidence-backed "learnings" (observation, sample size, confidence, recommended change) that require approval before being applied.
- **budget** — deterministic per-product spend cap that pauses runs *before* overspend, not just after-the-fact reporting.
- **console** — AI Sales Console for issuing commands; routes through the same approval workflow as any other mutation.
- **settings** — operating configuration (autonomy levels, engagement limits, etc).
- **jobs** — background job/worker queue driving the phases above asynchronously.
- **analytics** — admin-facing reporting layer.

## Architecture

Layering is UI → services → providers/persistence, with `domain`/`config` as shared cross-cutting primitives:

- **`src/app/`** — React Router pages (`ProductsPage`, `OpportunitiesPage`, `EngagePage`, `LearningPage`, `ConsolePage`, `SettingsPage`, `AudienceMapPage`, `PerformancePage`, `AdminAnalyticsPage`). Calls into `src/services/*` only.
- **`src/services/*`** — business logic, one directory per domain concept listed above. Services compose each other directly (e.g. `audience/generation.ts` calls `scoreEvidence()` from `evidence/`) and call Supabase edge functions via `supabaseBrowserClient.functions.invoke('sales_os-<name>', ...)` for anything server-side.
- **`src/providers/`** — adapter pattern for external AI/data providers. `capabilities.ts` defines capability names (e.g. `reasoning`, `findContact`) and the `CapabilityProvider` interface; `registry.ts` (`ProviderRegistry`) selects a qualified provider by priority and only allows fallback for capabilities with 2+ qualified providers; `runner.ts` / `guarded.ts` wrap execution with guardrails. Concrete adapters live in `src/providers/adapters/` (`anthropic.ts`, `reddit.ts`, `gmail.ts`, `http.ts`, `unavailable.ts` null-object fallback). Services must go through this registry rather than calling provider SDKs/`fetch` directly.
- **`src/ai/promptCatalog.ts`** — centralized AI prompt/template catalog, kept out of individual services.
- **`src/lib/supabase/`** — Supabase client factories only: `browser.ts` (anon-key client, used by the frontend) and `server.ts` (service-role client, for server-side/script contexts). All Postgres/edge-function access goes through these.
- **`src/domain/`** — shared primitives: `types.ts` (`SalesOsTenantId`, `AuthenticatedUser`), `tenant.ts` (`SALES_OS_TENANT_ID` constant used for row scoping everywhere).
- **`src/config/`** — `env.ts` / `env-schema.ts` validate `SALES_OS_*` env vars and expose `browserEnv`.
- **`src/services/state/transitions.ts`** — the state-machine layer: `StateEntity` union (`product | audience | opportunity | engagement | learning | approval | job`) and `stateTransitions` enforcing valid status changes per entity. Consult this before adding any new status value or transition.

### Edge functions (`supabase/functions/`)

Deno runtime, separate from `src/` (no imports between them — verified no `../../src` imports exist). Pattern:

```
src/services/* → supabaseBrowserClient.functions.invoke('sales_os-<name>', ...)
  → supabase/functions/sales_os-<name>/index.ts
  → supabase/functions/_shared/*.ts (parallel Deno-side logic, not literally shared code)
  → Postgres (service-role client) / external provider APIs
```

- `sales_os-worker/index.ts` claims jobs via RPC `sales_os_claim_next_job` and dispatches by `job_type` (`attribution`, `engagement_batch`, etc.) into `_shared/workerAnalysis.ts`.
- `sales_os-scheduler/index.ts` is gated by a `SALES_OS_CRON_SECRET` header; enqueues learning analysis via `_shared/learning.ts` then triggers `sales_os-worker` via plain `fetch`.
- `_shared/` contains `supabase.ts` (client bootstrap), `tenant.ts`, `attribution.ts`, `learning.ts`, `workerAnalysis.ts`.

### Migrations (`supabase/migrations/`)

Naming convention: `<timestamp>_sales_os_<feature>.sql`. Evolves in phases matching the docs/tests phase numbering (`phase1_foundation`, `phase8_channel_accounts`, `phase9_attribution_audit`, etc.) — check existing phase migrations before writing a new one to keep numbering/naming consistent.

## Environment variables

All app config is prefixed `SALES_OS_` (see `.env.example` for the full list — Supabase URL/keys, `ANTHROPIC`/`OPENAI` provider keys + model + cost-per-million-token rates for budget calc, `EXA`/`FIRECRAWL`/`HUNTER` search/enrichment keys, `GMAIL_*` OAuth, `REDDIT_*` OAuth, `POSTHOG_*`, `STRIPE_*`, `CRON_SECRET`). Notably, `vite.config.ts` whitelists exactly `SALES_OS_SUPABASE_URL` and `SALES_OS_SUPABASE_ANON_KEY` via `envPrefix` to reach the client bundle — every other `SALES_OS_*` var stays server/edge-function only. Do not widen this whitelist without checking whether the var is meant to be public.
