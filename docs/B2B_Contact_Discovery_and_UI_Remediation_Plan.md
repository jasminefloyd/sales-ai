# B2B Contact Discovery and App-Wide UI Remediation

Review date: September 30, 2026.

Status: implementation in progress. The audit findings below remain the source of truth for the remaining work; completed local changes and verification are recorded at the end of this document. Live provider execution, migration application, and function deployment remain separate release steps.

## 1. Outcome

For an approved B2B audience, Sales OS must identify real organizations and relevant people, obtain and verify available professional contact details, explain the evidence, and present recipient-linked email copy for manual use. A strategic audience description is not a contact list. Generated email text without a recipient does not satisfy this workflow.

The UI must preserve the clean cream/white/orange visual system and product-centered five-step workflow. This is a reliability and consistency repair, not another wholesale redesign or addition of mandatory pages.

## 2. What was actually reviewed

- Traced the deployed-worker entry path in local source, direct discovery, provider selection/adapters, audience approval, enrichment, jobs, and contact presentation.
- Inspected the existing workflow redesign guide and audience-intelligence plan for the intended behavior. Their completion claims were not accepted as runtime evidence.
- Logged into the local app at `http://localhost:5173` using the supplied demo account, connected to its configured Supabase database.
- Captured 51 screenshots: 17 routes/states at widths 1440, 768, and 390 pixels, with a 1000-pixel viewport height.
- Examined desktop pages, the five workflow panels, representative tablet/mobile screenshots, DOM overflow measurements, and the computed layout of the draft list.
- Read current product, audience, route, job, provider registration, provider-run, account, contact, opportunity, engagement, and ICP data under the demo user's permissions.
- Reproduced the invalid product-column query using a read-only request.

### Coverage and limitations

Routes: Products, Today, Signals (`opportunities`), Copy (`engage`), Learning, Performance, Console, Settings, Activation, Audience Definitions, Admin Analytics, Admin Audience Intelligence; plus Source, Sales Profile, Audiences, Outreach, and Copy states within the product workflow.

This was a read-only review, not a live business-workflow test. Edge-function requests were intercepted and non-read REST requests were blocked so mounting the app could not execute queued jobs or write analytics. Authentication was allowed. Consequently, function-fed views and mutation responses were not validated. No paid provider calls, discovery retries, approvals, publishing, exports, or CRM syncs were triggered. All visual screenshots used the local frontend, not a separately verified production frontend bundle.

Only one product was visible to this user, so multi-product isolation, populated contact tables, alternate job states, dark mode, all dialogs, every admin tab, keyboard accessibility, and every disclosure require additional fixtures/testing. No claim of complete E2E coverage or pixel-perfect compliance is made.

Artifacts are temporary local files in `/private/tmp/sales-os-review/`: `report.json`, `data.json`, and the PNG screenshots. They contain user/product data; do not commit raw diagnostic data or credentials. Preserve sanitized regression fixtures in the repository during implementation.

## 3. Verified current business state

Product: `b2c4ee7a-26cf-4a5b-ab04-9cf309480493`, RunScene AI — Product Requirements Document.

| Record | Observed state |
|---|---|
| Performing Arts Schools & Drama Programs | Approved B2B organization audience, ID `8baf3712-2491-4447-9e6b-d21e1c08e4c4` |
| Its direct route | Active, ID `907851f9-575a-4456-9d1f-c50f46e4157b` |
| Its discovery job | Failed, ID `e1355405-507a-41f0-8a54-a8fc991edaee`; saved error is only `worker_exception / Worker execution failed.` |
| Accounts / contacts / opportunities | Zero visible records in each table |
| Generated copy | Three drafts awaiting approval: two Reddit, one email; all have null `contact_id` |
| School engagement-generation job | Completed with `engagementId: null`, ID `ee50c4ad-b9dc-4ca9-9259-4ef845bbcc63` |
| Parent ICP visibility | No ICP rows returned, including an explicit query for the two IDs referenced by visible audiences |
| Audience revisions | Four visible rows, including repeated actor-audience titles; an actor-oriented proposed audience references the school ICP |
| Provider registry | Hunter `find_contact` enabled; Exa `search_web` enabled; no registrations for `find_company`, `find_person`, or `verify_contact` |

Parent ICP absence from this user's query does **not** establish database-wide absence. RLS, tenant/product linkage, deployed schema, and record existence must be checked before repairing data or policies.

Historical provider runs from September 29 include successful reasoning runs following failed reasoning runs reporting exhausted OpenAI credits, successful web searches, and a `scrapePage` failure reporting a missing Firecrawl API key. These establish failures at those run times, not the current availability of credentials. No provider-run row was returned for the failed direct job in the fetched product history.

## 4. B2B defects and affected code

### B1 — Invalid database field blocks the direct worker (P0)

`runDirectFindForWorker` in `supabase/functions/_shared/workerAnalysis.ts` selects `name,website_url,description`. The database rejects `description` with `42703`; the existing input field is `description_input`.

This is a verified incompatibility between local worker code and the live schema. The historical failed job's generic error prevents proving its exact deployed exception without logs/build verification. Fixing this field alone will not fix the remaining pipeline defects.

### B2 — Required providers cannot be selected/executed (P0)

The same file's `loadProviders` matches the requested capability exactly or in snake_case, then filters provider keys to OpenAI, Anthropic, Exa, Firecrawl, Gmail, and Reddit. Hunter is excluded. `callProvider` also has no Hunter dispatch. The live registry lacks company/person discovery and verification registrations.

Enabling Hunter in Settings currently does not establish a usable worker contact-finding path. The registered `reddit_web` key also differs from the worker allowlist's `reddit`; verify that shared-registry changes preserve the working social workflow.

### B3 — Provider requests and responses do not meet the pipeline contract (P0)

The worker sends company discovery `{product, audience, approvedLearnings}`. Its Exa handler expects `input.query` and otherwise sends an empty string. The handler returns raw search results, while direct discovery requires normalized `name`, `domain`, `websiteUrl`, and evidence fields. Merely adding capability registrations would still leave this mismatch.

`src/services/discovery/directFindService.ts` and `src/providers/adapters/http.ts` are a second implementation, not the deployed worker's direct path. The Exa adapter advertises person/contact capabilities that its handler rejects. The Hunter adapter's parameter/response handling also needs contract tests before reuse. Do not assume wiring existing files together is sufficient.

### B4 — Partial failures disappear (P0)

The direct worker continues silently after failed person discovery, missing person evidence, or missing email. It does not persist an identifiable person without an email. Final success does not necessarily represent successful contact discovery. The main worker catch also reduces non-`Error` database exceptions to a generic message.

This prevents users from distinguishing no matching companies, unavailable providers, no named people, unavailable email, failed verification, and actual successful results.

### B5 — Strategy, identity, and approval integrity need repair (P1)

- Direct discovery reads product input and audience text but does not load the full approved profile/ICP targeting contract at its entry point.
- Audience approval updates the audience before later route/definition/job operations complete, allowing partial success.
- Suggested-audience processing coerces structured values with `String(...)`; the school card visibly displays `[object Object]`.
- Rediscovery must preserve the user-suggested school/business targeting rather than produce a generic actor audience under that ICP.
- The current UI cannot resolve the visible audiences' parent ICP records.

Relevant files: `sales_os-review-audience/index.ts`, `workerAnalysis.ts`, `ProductWorkflowPage.tsx`, `src/services/audience/suggestionService.ts`.

### B6 — The UI cannot accurately explain direct discovery (P1)

- The B2B target section is guarded by `buyer_type === 'organization'`, not a shared approved direct-outreach strategy predicate.
- It renders contacts through opportunities, hiding useful partial account/person records.
- The school card says discovery is queued or has not returned a qualified target even though its job failed.
- “Retry enrichment” is offered with no discovered members to enrich.
- Buying intent is hardcoded to Pending; enrichment readiness is based on the existence of a rollup rather than its actual outcome.
- Generic email copy and recipient-specific copy are insufficiently distinguished.

### B7 — Existing regression tests do not prove the path works (P0 release gate)

`supabase/tests/b2b_direct_workflow.test.ts` reads files and asserts that strings exist. Those tests cannot detect an invalid SQL field, missing provider mapping, malformed result, inaccessible ICP, or completed job returning no draft. Add executable tests; keep string checks only as supplemental architecture checks.

## 5. Verified visual and UX findings

| Area | Verified issue | Required direction |
|---|---|---|
| Shared navigation | Products and Add product highlighted together; long selected name truncated; mobile navigation links clipped | One active destination; distinct import action; accessible product selector; compact mobile menu |
| Mobile shell | Sidebar retains viewport-height minimums; content begins below approximately an entire screen of blank navigation space | Reset desktop height/sticky rules on mobile; compact header and drawer |
| Tablet workflow | At 768px, document measures 926px wide; Outreach/Copy steps are clipped | Responsive stepper based on available content width, not only viewport assumptions |
| Engage | 278px list card gives title only 127px while status consumes 114px; long message-angle text becomes an enormous narrow column | Short title, separate status row, two-line preview, full rationale in detail |
| Engage tablet | Document width 775px at a 768px viewport | Earlier list/detail stacking and shrinkable context grid |
| Audiences | Empty-looking panel header followed by detached cards; missing parent context; duplicated-looking revisions; `[object Object]` | ICP-contained audience cards, typed rendering, explicit unavailable-parent state, version grouping |
| Workflow status | Audiences shows a green check/Approved while also saying one is awaiting review | Shared counts and aggregate status for current revisions; distinguish partial approval |
| Profile | Raw JSON-like activation-funnel array remains; chip labels cut meaning mid-sentence; very uneven grid heights | Structured conversion flow, meaningful short labels, expandable full text, avoid forced equal-height empty cells |
| Source | Desktop controls are reasonably grouped; long filename risks mobile clipping | Preserve desktop layout, wrap filenames, test expanded content and controls on small screens |
| Outreach | Repeated similar channel cards across audiences; audience identity truncates | Group by ICP/audience; concise summaries, full identity on expansion; show recipient readiness for email |
| Copy workflow | Very long repeated rationale above drafts; generic and recipient-specific copy not obvious | Short draft summaries with recipient/channel metadata; rationale in disclosures; preserve editing/actions |
| Signals | Direct visit shows “No products” and raw invalid UUID error despite an existing product | Load/validate product scope before dependent queries; separate errors from genuine empty states |
| Products | Card layout is broadly usable; Needs attention does not identify failed stage | Preserve layout, link to relevant failed discovery, de-emphasize destructive action |
| Today | Older send-centric terminology and progression separate from current product workflow | Align counts, actions, and manual-copy language with shared workflow state |
| Learning | Product picker and tall run button have inconsistent sizing; empty state touches preceding card | Shared toolbar and section spacing; retain visible job progress |
| Performance | Dense KPI grid and implementation-focused subtitle | Group user outcomes separately from operations; responsive metrics and readable units |
| Console | “Canonical-state assistant” and backend-oriented explanatory copy | Plain “Ask Sales OS”; compact examples; preserve approval semantics |
| Settings | Raw capability names/priorities; enabled state presented without operational readiness; PostHog entry remains | Group by purpose, distinguish configured/available/enabled; remove obsolete PostHog surface after dependency check |
| Activation | JSON mapping exposed as primary form; wide action buttons and unexplained disabled request | Field-mapping controls, staged readiness, explicit missing prerequisites; advanced details optional |
| Audience definitions | Current empty state gives little recovery guidance | Explain strategy versus reusable definition and link to correct product/audience action |
| Admin analytics | Mobile metric columns visibly clipped even though document width reports 390px | Responsive grids, bounded horizontal table regions; inspect child geometry, not just page width |
| Audience intelligence | Large stacked filters and repeated technical metrics | Compact responsive filter toolbar, grouped lifecycle metrics, details on demand |

No JavaScript page errors were captured during the baseline route scan. That is not evidence of correct layouts or working mutations. Several overflow rules hide content instead of fixing layout.

## 6. Implementation phases

Execute in order. Phase 4 visual foundations can proceed in parallel with backend work once baseline fixtures are preserved. Do not declare B2B complete after Phase 1 alone.

### Phase 0 — Establish a reproducible baseline and resolve unknowns

- [ ] Preserve sanitized examples of the current school audience, failed job, orphan-parent response, duplicate revisions, long product names, and structured profile fields.
- [ ] Verify deployed worker version against local source and capture the original failed-job exception if retained in logs.
- [ ] Inspect live schema, grants, RLS, and tenant/product links for the two referenced ICP IDs. Determine why user-visible child rows have invisible parents; do not weaken access control to make the UI work.
- [ ] Check server-side provider configuration presence without exposing secrets; distinguish historical Firecrawl failure from current readiness.
- [ ] Inventory executable provider capabilities, registry entries, secrets, normalizers, and all call sites. Record supported versus unsupported capabilities honestly.
- [ ] Inventory reachable routes, deep links, and existing actions. Retain action parity throughout the visual work.
- [ ] Add baseline failure tests for invalid column, missing provider capabilities, orphan ICP visibility, invalid product scope, mobile sidebar height, and tablet stepper overflow.

Exit: each unresolved observation has evidence or an explicit blocker. No data backfill or policy change is performed on assumptions.

### Phase 1 — Repair worker/provider execution contracts

- [ ] Replace invalid product select with schema-valid fields; load the approved sales profile and correct approved ICP/audience revision.
- [ ] Introduce one canonical capability mapping and adapter dispatch used by the worker. Consolidate/remove duplicate direct-discovery execution paths after testing parity.
- [ ] Add real company discovery and person discovery implementations, not capability aliases that call incompatible endpoints.
- [ ] Build nonempty structured search queries from product fit, organization characteristics, buying roles, and optional geography. Keep buyer roles separate from end users (e.g. school program director versus student).
- [ ] Normalize search/scrape results into typed account/person candidates with source URL, excerpt, observed timestamp, and confidence.
- [ ] Wire Hunter contact lookup and verification into the actual worker with explicit parameter mapping and response normalization.
- [ ] Register only implemented capabilities through an idempotent migration/configuration update. Resolve `reddit`/`reddit_web` compatibility without breaking social discovery.
- [ ] Reject invalid provider output with a typed contract error; never invent names, email addresses, quotations, or verification.
- [ ] Apply the same structured-output validation to OpenAI and Anthropic, including user-suggested audience tasks. Reasoning fallback is not a substitute for unavailable contact data.
- [ ] Add prerequisite checks for absent capability/key/configuration before expensive discovery work. Settings must reflect these checks, not merely the enabled flag.

Exit: executable adapter tests prove company → person → email → verification using representative success/error payloads; schema queries pass against the migration-built test database.

### Phase 2 — Make contact discovery resumable and truthful

- [ ] Use a documented stage sequence: validate approved scope → discover accounts → identify people → find email → verify → suppression/quality checks → persist eligible opportunities.
- [ ] Persist partial accounts and named contacts even when no email is available, with explicit not-ready reasons and provenance. Reuse existing entities/members rather than introducing a second contact model.
- [ ] Maintain product/audience/ICP/definition lineage and deduplicate normalized domains/emails; avoid merging distinct people by name alone.
- [ ] Check audience/route approval and current revision again when the job executes. Handle paused/rejected/superseded targets safely.
- [ ] Check suppression before creating usable outreach targets and again at export/manual-handoff boundaries. Keep source evidence, email verification, intent, and permission separate.
- [ ] Treat unverified, invalid, catch-all, stale, and unavailable email as explicit states; do not mark them “ready” based on an evidence score alone.
- [ ] Persist stage counts: accounts found, people identified, emails found, verified contacts, suppressed, ineligible, failed, and ready.
- [ ] Preserve provider/database error codes and stage names in protected diagnostics; return concise actionable messages to the UI.
- [ ] Distinguish completed-with-results, completed-with-no-matches, partial, blocked, failed, cancelled, and running in the presentation contract. Add DB states only if existing status/result fields cannot represent this safely.
- [ ] Retry the failed stage with checkpoints and idempotency; prevent duplicate opportunities/drafts on retries or concurrent clicks.
- [ ] Ensure a new explicit discovery run can execute after a previous completed/failed run; do not reuse an activation-only idempotency key as a discovery retry.
- [ ] Make approval, route/definition creation, and job enqueue atomic where possible, or explicitly resumable with an operation ID and recoverable partial-state handling.
- [ ] Replace “completed with null engagementId” success with an explicit blocked/no-output result when no eligible contact exists.

Exit: integration tests prove partial records survive, errors identify the failed stage, retry resumes correctly, and repeated approval does not duplicate/reset approved decisions.

### Phase 3 — Deliver the B2B recipient experience inside each product

- [ ] Define one direct-outreach eligibility predicate shared by generation, review, and UI; cover B2B and relevant B2B2C audiences, not only organization buyer type.
- [ ] Show a compact Contacts area inside each approved ICP/audience, not a mandatory new page.
- [ ] Display organization, person, job title/buying role, professional email if available, verification state/date, fit explanation, and source evidence.
- [ ] Separate “Ready to email” from “Needs enrichment,” “Unverified,” and “Unavailable/suppressed.” Render partial accounts/people even before an opportunity exists.
- [ ] Present progress and failure per audience: current stage, last attempt, counts, concise reason, and the correct next action.
- [ ] Use “Find contacts” before discovery, “Retry discovery” after discovery failure, and “Enrich contacts” only when records exist and enrichment can help.
- [ ] Offer filtering, selection, pagination, and responsive card/table views for real contact volume.
- [ ] Generate drafts for selected eligible recipients using their organization/role and approved outreach decision; persist contact/account/audience links and relevant evidence snapshot.
- [ ] Show To, organization/role, subject, and body together; copy/download for manual engagement without auto-sending.
- [ ] Label existing recipient-less email as an audience template, not ready-to-send personalized outreach. Preserve historical copy; do not fabricate a recipient/backfill association.
- [ ] Resolve ICP visibility and display one primary plus up to five secondary ICP families with current audience versions; put history behind a disclosure.
- [ ] Keep user-suggested audiences and rediscovery anchored to the edited intent, parent ICP, and explicit user choice.
- [ ] Replace hardcoded Buying intent/Pending and rollup-exists/Ready with actual data states and “Not evaluated” when unknown.

Exit: fixture E2E shows two independently approved B2B audiences, different real-shaped contact sets, recipient-bound drafts, and no cross-audience leakage. Social outreach behavior remains intact.

### Phase 4 — Repair the shared visual foundation

- [ ] Consolidate conflicting global/component rules in `app.css` and `productWorkflow.css`; do not append another broad override layer.
- [ ] Establish shared page widths, gutters, section gaps, heading/body line heights, field spacing, button heights, and card padding using existing visual tokens.
- [ ] Reset sidebar and inner-sidebar `min-height`, `max-height`, sticky positioning, and flex behavior on small screens. Use a compact header with accessible navigation drawer.
- [ ] Correct active-navigation matching; make Add product an actual intake action rather than a second active Products link.
- [ ] Keep product context in a shared route-aware selection model. Resolve valid product IDs before scoped queries and cancel/discard stale responses after switching.
- [ ] Define shrinkable grid tracks (`minmax(0, 1fr)`), `min-width: 0` on flex/grid children, filename/URL wrapping, and intentional table scrolling. Remove clipping used to conceal overflow.
- [ ] Adapt the workflow stepper to available content width; all five steps must remain discoverable at tablet/mobile sizes.
- [ ] Standardize compact icon actions with accessible names/tooltips and icon-plus-label primary actions. Keep explicit labels for consequential approval/deletion actions.
- [ ] Reuse typed renderers for strings, arrays, nested objects, URLs, and Markdown. No `[object Object]`, raw JSON arrays, `undefined`, or snake_case in primary user copy.
- [ ] Generate meaningful short labels with full detail accessible on click/focus; do not simply chop paragraphs into chips.
- [ ] Add consistent skeleton, empty, no-results, error, retry, and stale-data components; loading errors must never look like successful empty results.
- [ ] Preserve focus, keyboard operation, expanded state, unsaved edits, and scroll position during polling.

Exit: shared shell and primitives pass desktop/tablet/mobile screenshot, geometry, and accessibility checks before page-level polish.

### Phase 5 — Apply cohesive layouts across the app

- [ ] Product workflow: place each audience inside its ICP panel, align headers/actions, show current revisions by default, and use one shared status model for stepper/panel/rail.
- [ ] Profile: render nested conversion goals/funnel as readable facts/steps; avoid huge equal-height empty Evidence cells; preserve complete information in disclosures.
- [ ] Source: retain grouped controls, wrap filenames, constrain expanded documents, preserve source replacement/editing.
- [ ] Outreach: group channels by audience and show compact recipient readiness/counts; retain approval controls and full reasoning.
- [ ] Copy: compact summary and recipient header, readable draft body, collapsed rationale/history; keep edit, request-changes, approve, and manual-copy actions.
- [ ] Engage: move status off the title's reserved grid column; use a short title and bounded preview; responsive list/detail layout; remove irrelevant budget/send-readiness language from manual-copy flows after checking actual semantics.
- [ ] Signals: fix the empty-UUID initial load; use the shared product context, correct empty/error state, and distinct person versus community presentation.
- [ ] Products: actionable failed-stage summary, compact consistent status, less dominant delete control, clear import action.
- [ ] Today: reuse current workflow counts and make recommendations product-specific; label drafts as needing review rather than implying ready to send.
- [ ] Learning: aligned toolbar, standard button sizing, spaced empty state, persisted analysis progress and actionable failures.
- [ ] Performance: responsive outcome groups, operational metrics in a secondary section, readable latency units, consistent undefined-denominator handling.
- [ ] Console: plain-language title/instructions, concise example chips, consistent result/error cards and approval affordances.
- [ ] Settings: group AI/research/contact capabilities; show disabled, missing configuration, unavailable, and ready separately. Keep keys server-side and advanced provider priorities out of the primary view.
- [ ] Activation: visual field mapping with optional advanced JSON, staged destination/readiness/review UI, clear disabled-action reasons; preserve human approval.
- [ ] Audience definitions: readable rule summaries, meaningful empty recovery links, responsive preview tables, raw rules only in advanced details.
- [ ] Admin analytics/intelligence: compact responsive filters, unclipped metric grids, intentional table scroll, cohesive tabs, plain-language state labels.
- [ ] Regression-check upload/intake, edit dialogs, rediscovery, bulk approval, delete confirmation, and errors even though these were not all exercised during this baseline audit.
- [ ] Verify light/dark token consistency wherever supported; do not add a second design language.

Exit: route-by-route parity checklist and reviewed screenshots, with no removed information or functionality disguised as simplification.

### Phase 6 — Verification, data repair, and controlled rollout

- [ ] Add executable worker orchestration tests, adapter contract tests, schema/RLS integration tests, and React interaction tests. File-content assertions are not acceptance evidence.
- [ ] Build a migration-applied test database and validate actual SELECT/UPSERT columns, unique constraints, triggers, and authenticated parent/child reads.
- [ ] Test provider unavailable, malformed output, missing key, 429, timeout, zero matches, partial enrichment, failed verification, suppression, concurrent retries, and interrupted persistence.
- [ ] Test primary/secondary ICPs, multiple approved audiences, suggested B2B audience on a B2C product, rediscovery, superseded revisions, missing/inaccessible parents, and approval recovery.
- [ ] Add browser fixtures for 0/1/50 contacts, long names/emails/URLs, mixed statuses, nested profile objects, unavailable data, and multiple products.
- [ ] Capture deterministic visual baselines at 390, 768, 1024, and 1440px; test browser zoom and long content. Mask timestamps only, not broken components.
- [ ] Assert no unexpected document overflow, offscreen/clipped interactive elements, or viewport-height mobile blank shell. Check child bounds because `overflow:hidden` can conceal defects.
- [ ] Verify keyboard focus/order, disclosure semantics, dialogs, selected states, loading announcements, and accessible icon controls.
- [ ] Run type checking, lint, build, unit/integration suites, and fixture-based browser workflows; record exact commands/results.
- [ ] Write narrowly scoped, rerunnable migrations only where required. Preserve approved revisions, provenance, append-only audit events, and user edits; do not rewrite approved content merely to shorten labels.
- [ ] Prepare an explicit repair list for affected product/audience IDs. Reconcile current/history relationships before any recovery run. Back up affected records and document rollback.
- [ ] Deploy only changed functions plus necessary configuration/migrations in a documented order; verify deployed version and provider readiness.
- [ ] Keep paid/live discovery, real verification, exports, and external syncs as a separately approved/user-conducted test. Supply the test script and expected observations.

Exit: report independently whether implementation, local integration, deployed configuration, and live provider validation passed. Never collapse these into a single “fully working” claim.

## 7. Acceptance scenarios

1. **School B2B audience:** approved school ICP/audience discovers organizations and named relevant staff, with source evidence and verified available professional emails. The UI identifies who to contact and presents matching email drafts for manual use.
2. **No email found:** named person remains visible as not email-ready. No address is guessed and no generic draft masquerades as recipient-specific output.
3. **Provider failure:** job and audience show the exact failed stage and a safe next action; no permanent spinner or false empty success.
4. **Multiple approved audiences:** each has independent contacts/progress/drafts; retrying one does not alter the others.
5. **Suppression/stale verification:** ineligible contacts cannot be treated as ready for handoff/export, even with strong fit evidence.
6. **Social regression:** existing Reddit/community evidence, channel approval, and copy continue working without forced company/contact fields.
7. **New session/deep link:** Signals and every scoped page load a valid selected product before querying; no empty UUID error.
8. **Responsive workflow:** all five steps and actions remain accessible at all test widths, with no giant mobile navigation gap, squeezed title columns, or clipped analytics metrics.
9. **Data integrity:** parent ICP visibility is tested under the real authorization model, current revisions are distinct from history, and UI state reflects actual approvals/jobs.
10. **Recipient-linked copy:** changing audience/contact selection cannot silently associate existing approved copy with a different recipient; revisions and approvals remain traceable.

Live discovery cannot guarantee a minimum number of deliverable contacts for every arbitrary market. Acceptance requires correct evidence-backed results when available and an honest, actionable result when they are not. Fixture tests must prove nonzero success paths; live tests validate provider availability and real data quality separately.

## 8. Recommended delivery order and boundaries

1. P0: invalid field, provider registry/dispatch, normalized contracts, useful errors, executable tests.
2. P1: resumable discovery, approval/lineage repair, recipient-linked copy, truthful B2B UI.
3. P1 visual: mobile shell, tablet stepper, draft list, Signals initialization, raw-object rendering.
4. P2: remaining page consistency, progressive disclosure, analytics/admin polish.
5. Release gates: schema/auth tests, browser fixtures, user live validation, narrowly scoped recovery of affected records.

Do not add automatic sending, rebuild working community outreach, invent contact data, replace failed research with fabricated success, or introduce new paid vendors without approval. No new top-level Contacts page is required for this plan; the default experience remains inside each product.

## 9. Change summary and current verification

The following remediation work is now present in the local repository:

- The deployed worker path uses the schema field `description_input` for product discovery context.
- Direct discovery dispatches through company discovery, person discovery, contact lookup, and verification contracts, with Hunter request/response normalization and Exa result normalization.
- Partial people are persisted as not-yet-ready contacts, suppression and verification states remain explicit, and fresh verified-email checks are required before an opportunity is created.
- The product workflow includes audience-scoped contact presentation and clearer discovery failure/empty-result states.
- Shared UI fixes cover product navigation, mobile sidebar behavior, tablet workflow-step overflow, compact engagement list layout, and typed rendering of nested values.
- `workerError` now preserves structured PostgREST/provider code, message, details, and hint values instead of collapsing non-`Error` objects to `Worker execution failed.`
- Interactive job retry/resume now invokes `sales_os-worker` after changing queue state, so a retry cannot silently remain queued waiting for an unrelated scheduler invocation.
- Route activation and manual enrichment retry now invoke the worker immediately; a failed direct-discovery job is presented as “Retry discovery” instead of “Retry enrichment.”
- Direct-discovery retry now uses the dedicated `sales_os-run-find` operation for the selected active route, rather than sending an activation request to `sales_os-review-audience`; the UI blocks the operation with an explicit parent-ICP approval message when the parent is not approved.
- Audience-definition creation no longer sends the nonexistent `state_changed_by` field to `sales_os_audience_definitions`; this fixes the verified `PGRST204` failure without changing the database schema.
- The Audiences stage no longer reports “Approved” when parent ICP rows are unavailable or any linked parent ICP is still proposed; it now reports “ICP review required.”
- ICP approval now requires core ICP fields and supporting evidence, while budget fit, purchase readiness, and commercial evidence may remain explicitly pending human review. Fallback and rediscovery paths use that explicit state instead of creating empty required-looking fields.
- Executable provider contract coverage is in `supabase/tests/directProviders.test.ts`.

Verified locally on September 30, 2026:

- `npm test -- --reporter=dot`: 78 files, 206 tests passed.
- `npm run typecheck`: passed.
- `npx --yes deno check supabase/functions/sales_os-worker/index.ts supabase/functions/sales_os-review-audience/index.ts`: passed.

The latest live failed contact-discovery job was read-only inspected and had `progress.stage = queued` with only `worker_exception / Worker execution failed.` The local serializer fix will expose the actual structured failure on the next deployed run; it does not retroactively change that historical row.

Still required before claiming release completion: apply the two new migrations, deploy the changed Edge functions, verify provider capability/key configuration, and run the user-controlled live discovery test. The implementation checkboxes above are intentionally not represented as fully complete until those boundaries are verified.
