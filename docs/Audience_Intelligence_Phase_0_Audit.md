# Audience Intelligence and Activation — Phase 0 Audit

**Audit date:** 2026-09-28  
**Repository:** `sales_ai`  
**Phase status:** Local repository audit complete; deployed-environment verification remains an operator/live-testing step.

## 1. Audit method and evidence boundary

This audit was performed against the checked-out repository without changing application source, migrations, or Edge Function source.

Verified locally:

- Migration source files and their SQL definitions.
- Frontend routes, services, and Supabase table consumers.
- Edge Function directories and shared worker source.
- Provider capability declarations, adapters, registry, fallback logic, and run accounting.
- Tenant, foreign-key, suppression, approval, attribution, analytics, and lineage source contracts.
- Existing automated tests, typecheck, lint, formatting, and production build.

Not verified here because it requires access to the deployed environment or live providers:

- Which migrations have actually been applied to Supabase.
- Deployed Edge Function source versions and environment variables.
- Runtime provider rows, enabled flags, priorities, and credential validity.
- Live provider, CRM, webhook, CSV, or destination behavior.

No deployed state is inferred from local files.

## 2. Existing schema inventory

The current schema is centered on one fixed `sales_os` tenant. The canonical state migration creates the existing product-to-outreach workflow objects and later migrations extend them.

| Object | Current responsibility | Relevant relationships | Current plan relevance |
| --- | --- | --- | --- |
| `sales_os_products` | Product intake, workflow state, spend settings | Root product object | Product scope for every future audience object |
| `sales_os_product_sources` | Imported source records and parsed content | Product → source | Source evidence for profiles and downstream objects |
| `sales_os_product_profiles` | Versioned Product Sales Profiles | Product → profile | Source of truth for ICP and intent evaluation |
| `sales_os_icps` | Versioned primary/secondary ICP strategy | Product → ICP | Parent strategy for audience definitions |
| `sales_os_audiences` | Versioned audience proposals and review state | Product → ICP → audience | Strategic audience definition predecessor |
| `sales_os_audience_routes` | Social/direct route decisions | Audience → route | Outreach and activation channel context |
| `sales_os_sources` | Discovered public/provider sources | Product → source | Evidence and discovery provenance |
| `sales_os_signals` | Audience-linked discovery signals | Product → audience → signal | Input to product-specific intent scoring |
| `sales_os_accounts` | Discovered organization records | Product → account | Existing B2B operational target record |
| `sales_os_contacts` | Discovered person/contact records | Product → account/contact | Existing B2B recipient record |
| `sales_os_opportunities` | Qualified outreach opportunities | Product/audience/source/signal/account/contact | Existing operational conversion point |
| `sales_os_engagements` | Drafted, approved, and executed manual/outbound actions | Product/opportunity/contact | Existing outreach/copy layer |
| `sales_os_conversations` | Conversation state | Product/opportunity/contact | Existing response tracking |
| `sales_os_suppression_records` | Channel/contact suppression rules | Product/contact/channel | Must be enforced by future member and activation paths |
| `sales_os_approvals` | Human approval records | Product/entity/action | Approval foundation for future merges and activations |
| `sales_os_events` | Product workflow and outcome events | Product plus optional opportunity/audience/account/contact/etc. | Existing operational analytics/event ledger |
| `sales_os_conversions` | Conversion outcomes and attribution | Product/conversion/opportunity/engagement | Outcome and learning input |
| `sales_os_conversion_attribution_history` | Attribution audit history | Conversion/product | Attribution preservation requirement |
| `sales_os_provider_runs` | Provider execution, cost, status, and provenance | Product/job/provider | Existing provider accounting foundation |
| `sales_os_providers` | Runtime provider capability configuration | Tenant/capability/provider | Existing provider registry persistence |
| `sales_os_jobs` | Background work queue and retry state | Product/job | Future enrichment, scoring, and sync orchestration |
| `sales_os_workflow_lineage` | Product workflow artifact lineage | Product/source/profile/ICP/audience/decision/engagement | Must be extended for members, enrichment, and activation |
| `sales_os_admin_events` | First-party product analytics | Product/user/attribution/opportunity/engagement | Existing analytics foundation |
| `sales_os_channel_accounts` | Configured branded/manual channel accounts | Product/channel | Existing channel configuration |
| `sales_os_operating_settings` | Product operating/provider settings | Product | Existing provider/settings UI backing object |
| `sales_os_learning_configurations` | Approved learning configuration | Product/learning target | Existing learning loop foundation |
| `sales_os_learnings` | Learning proposals and applied changes | Product/audience/signal/provider | Future intent and quality feedback input |
| `sales_os_budget_reservations` | Provider cost reservations | Product/job | Existing provider guardrail; not an activation model |

The plan-required first-class audience intelligence objects are not present in local source:

- `sales_os_audience_definitions`
- `sales_os_audience_members`
- `sales_os_identity_candidates`
- `sales_os_identity_merges`
- `sales_os_enrichment_records`
- `sales_os_audience_quality_snapshots`
- `sales_os_intent_scores`
- `sales_os_audience_activations`
- `sales_os_activation_records`
- `sales_os_activation_sync_runs`

## 3. Current relationship and workflow dependency map

```text
sales_os_products
  ├── sales_os_product_sources
  ├── sales_os_product_profiles
  ├── sales_os_icps
  │     └── sales_os_audiences
  │           ├── sales_os_audience_routes
  │           ├── sales_os_signals
  │           └── sales_os_opportunities
  │                 ├── sales_os_accounts
  │                 ├── sales_os_contacts
  │                 ├── sales_os_engagements
  │                 └── sales_os_conversations
  ├── sales_os_sources
  ├── sales_os_jobs
  ├── sales_os_provider_runs
  ├── sales_os_events
  ├── sales_os_conversions
  ├── sales_os_approvals
  ├── sales_os_workflow_lineage
  └── sales_os_learning_configurations / sales_os_learnings
```

Current workflow consumers verified in source:

| Workflow area | Primary source files | Reads/writes |
| --- | --- | --- |
| Product intake/source parsing | `src/app/ProductsPage.tsx`, `src/services/product/sourceService.ts`, `src/services/product/sourceParser.ts`, `src/services/product/pdfImport.ts` | Products, product sources, jobs |
| Profile generation/review | `src/app/ProductWorkflowPage.tsx`, `src/services/product/*`, `sales_os-review-product-profile`, `sales_os-edit-product-profile` | Profiles, approvals, jobs, lineage |
| ICP/audience generation/review | `src/app/ProductWorkflowPage.tsx`, `src/services/audience/*`, `sales_os-review-audience` | ICPs, audiences, routes, jobs |
| Community/direct discovery | `src/services/discovery/*`, `workerAnalysis.ts`, `sales_os-run-find` | Sources, signals, accounts, contacts, opportunities, events |
| Outreach/copy | `src/services/outreach/*`, `src/services/engagement/*`, `workerAnalysis.ts` | Decisions, engagements, conversations, events |
| Learning | `src/services/learning/*`, `sales_os-run-learning-analysis`, `sales_os-review-learning` | Events, learnings, learning configuration |
| Analytics/attribution | `src/services/analytics/*`, `src/services/attribution/*`, `src/app/AdminAnalyticsPage.tsx` | Admin events, sales events, conversions, provider runs |

## 4. Constraints, indexes, RLS, and safety controls

Verified in migration source:

- Tenant identifiers are constrained to the fixed `sales_os` tenant on current tables.
- Composite tenant/entity uniqueness is used throughout the canonical schema.
- Product relationships generally use composite tenant-aware foreign keys.
- Product deletion migration explicitly cleans product-scoped operational records and uses a cleanup session setting for append-only records.
- Provider runs, jobs, and budget reservations have indexes/locking for queue and cost control.
- Product, ICP, audience, opportunity, engagement, job, approval, and learning transitions are guarded by database transition functions/triggers and service-level transition helpers.
- Account dedupe uses normalized domains.
- Contact dedupe uses normalized professional email where present.
- Suppression has an active unique index by tenant/product/channel/identifier.
- Events and workflow lineage have append-only triggers with an explicit product-cleanup exception.
- RLS is enabled in migration source for the current sensitive/configuration tables, including provider guardrails, channel accounts, attribution history, learning configuration, operating settings, product sources, outreach decisions, admin events, and workflow lineage. The canonical-state migration also enables RLS for its canonical tables through a dynamic block.

Compatibility requirement for Phase 1: all new audience-intelligence tables must use the same tenant-aware composite-FK, RLS, audit metadata, append-only/event, suppression, and approval conventions rather than introducing a parallel security model.

## 5. Provider capability matrix — local source contract

This is a source-level capability matrix. It does not assert that keys are present or that runtime provider rows are enabled.

| Provider/adapter | Declared capabilities | Current fallback behavior |
| --- | --- | --- |
| OpenAI | `reasoning` | Reasoning candidate when configured |
| Anthropic | `reasoning` | Reasoning fallback when configured and the failure is eligible |
| Exa | `searchWeb`, `findCompany`, `findPerson`, `findContact` | No generic fallback in the current registry for these capabilities |
| Firecrawl | `scrapePage` | No generic fallback in the current registry |
| Hunter | `findContact`, `verifyContact` | Contact fallback is supported by the provider runner |
| Reddit/community | `searchCommunity`, `publishResponse` | Community adapter path |
| Gmail | `sendEmail` | Email execution adapter path |
| Unavailable adapter | Declares configured capability names without credentials | Returns unavailable/provider failure behavior |

Current provider-neutral TypeScript capability names are camelCase (`findCompany`, `findPerson`, `findContact`, `verifyContact`). The plan’s future contract names such as `enrich_company`, `resolve_identity`, and `export_audience` do not yet exist. A Phase 2 adapter layer must normalize the naming without breaking existing discovery calls.

## 6. Edge Function source inventory

Current local Edge Function directories:

- `sales_os-worker`
- `sales_os-scheduler`
- `sales_os-job-control`
- `sales_os-run-find`
- `sales_os-run-learning-analysis`
- `sales_os-console`
- `sales_os-settings`
- `sales_os-delete-product`
- `sales_os-review-product-profile`
- `sales_os-edit-product-profile`
- `sales_os-review-audience`
- `sales_os-review-opportunity`
- `sales_os-review-outreach-decision`
- `sales_os-review-engagement`
- `sales_os-complete-manual-engagement`
- `sales_os-review-learning`
- `sales_os-record-conversion`
- `sales_os-ingest-product-event`
- `sales_os-ingest-reply`
- `sales_os-ingest-stripe-webhook`

The shared worker currently owns product analysis, audience generation, find/discovery, engagement generation/execution, attribution recomputation, and learning analysis. There is no standalone local activation, enrichment, identity-resolution, quality-recalculation, audience-member, or audience-sync Edge Function.

The deployed function names and source versions are intentionally marked **unverified** until checked against Supabase by the operator.

## 7. Analytics, suppression, and consent baseline

Verified current analytics dimensions:

- `sales_os_events` has first-class product, opportunity, audience, account, contact, engagement, source, signal, provider, dimensions JSON, external event, and idempotency fields.
- `sales_os_admin_events` has user/anonymous/session identifiers, attribution ID, opportunity/engagement carry-forward, UTM fields, page/referrer, internal-event flag, and idempotency key.
- `sales_os_engagements` has channel, message angle, CTA, status, contact, and execution fields.
- `sales_os_opportunities` has audience, route, source, signal, account, contact, evidence, and first-touch dimensions.
- Analytics services currently calculate operational breakdowns by audience, route, source, signal, engagement type, message angle, CTA, and provider.

Verified safeguards:

- Contact suppression is checked by channel/identifier in existing discovery and engagement code paths.
- Email verification state is stored on contacts (`unknown`, `valid`, `risky`, `invalid`) with provider and verification timestamp.
- Manual approval services exist before audience/opportunity/outreach/engagement actions.

Not yet established for the future plan:

- Audience-member consent/readiness state independent of contacts.
- Activation-specific suppression propagation and destination deletion.
- Freshness/quality/intent event taxonomy and snapshots.
- Reconciliation events for activation exports and sync runs.

## 8. Required compatibility changes before Phase 1

These are verified design dependencies from the current source structure, not speculative implementation claims:

1. Add a canonical audience-definition/member layer without replacing `sales_os_audiences`; existing audience approvals and product workflow queries must continue to work.
2. Add nullable/versioned links from the new objects to product, ICP, audience, account, contact, signal, and source records using tenant-aware foreign keys.
3. Preserve existing direct-discovery account/contact/opportunity writes while allowing new enrichment and member records to reference them.
4. Extend lineage and event dimensions for member, enrichment, quality, intent, identity, activation, and sync identifiers.
5. Keep existing `sales_os_providers` and `sales_os_provider_runs` compatible while introducing normalized Phase 2 capabilities.
6. Add jobs/job types or an equivalent orchestration contract for enrichment, identity, quality, intent, and activation retries without changing existing job state semantics.
7. Extend product deletion cleanup to every new product-scoped object, including append-only audit/event exceptions through the established cleanup mechanism.
8. Add approval entity/action handling for identity merges and external activation; do not bypass existing human approval gates.
9. Preserve attribution when account/contact identities are merged or when an audience member is refreshed.
10. Add UI consumers incrementally: existing Product Workflow remains valid; new intelligence and activation surfaces should be additive until their contracts are stable.

## 9. Migration and deployment checklist for future phases

- Use phase-numbered migration filenames, for example `*_phase_01_audience_data_model.sql`.
- Make migrations safe against existing data and explicitly document all backfills.
- Validate duplicate, partial, rollback, and rerun behavior before operator application.
- Do not assume local migration order equals deployed migration order.
- After backend changes, redeploy affected Edge Functions through the operator’s Supabase workflow.
- Verify deployed source/version and environment configuration separately from local static checks.
- Run automated tests, typecheck, lint, formatting, and build before handoff.
- Record live-provider and destination limitations separately from repository verification.

### Existing migration rerun risks

The migration directory is not a replay-safe schema snapshot. The following migration groups contain unguarded `CREATE TABLE`, `ALTER TABLE`, trigger, policy, index, function, or data-backfill operations and therefore require applied-state verification before any operator rerun:

- `20260922001000_sales_os_canonical_state.sql` — creates the canonical tables, indexes, triggers, policies, and functions without making the entire migration rerunnable.
- `20260922002000_sales_os_provider_guardrails.sql` — creates budget reservations and replaces transition/budget functions.
- `20260922003000_sales_os_phase8_channel_accounts.sql` — creates channel-account structures and alters engagements.
- `20260922004000_sales_os_phase9_attribution_audit.sql` — creates attribution history and related policies/functions.
- `20260922005000_sales_os_learning_configuration.sql` — creates learning configuration structures and policies.
- `20260922006000_sales_os_operating_settings.sql` — creates operating settings and policies.
- `20260922007000_sales_os_background_jobs.sql` — alters jobs, adds indexes, and replaces job/transition functions.
- `20260922009000_sales_os_admin_analytics.sql` — creates the append-only admin event ledger, indexes, policies, and trigger.
- `20260923010000_sales_os_icp_strategy_orchestration.sql` through `20260923070000_sales_os_product_delete.sql` — extend existing objects and include constraints, indexes, triggers, backfills, and deletion behavior that depend on current schema/data state.
- `20260924020000_sales_os_phase2_product_sources.sql` through `20260925010000_sales_os_recipient_specific_copy.sql` — continue the same incremental stateful pattern; several are repairs for earlier migrations and must be selected based on the actual deployed state.

The safe operating rule for future phases is: inspect the deployed migration history first, apply only the phase migration that matches that state, and use explicit repair/backfill migrations when a prior migration partially ran. The Phase 0 audit does not claim that any listed migration has or has not been applied remotely.

## 10. Regression and validation baseline

The repository currently passes the following local checks as of the audit date:

- `npm test -- --run`: 44 test files, 96 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format`: passed.
- `npm run build`: passed; existing dependency annotation and bundle-size warnings remain non-fatal.

Existing regression coverage includes product intake/parsing, workflow state, ICP/audience hierarchy, discovery, suppression, provider fallback, engagement guards, attribution, analytics, learning, lineage, and phase-contract checks.

The following Phase 1+ regression suites do not exist yet and are intentionally deferred:

- Audience-member persistence and materialization.
- Identity candidate/merge conflict handling and reversibility.
- Enrichment freshness and partial-success behavior.
- Quality/readiness recalculation.
- Product-specific intent score history.
- Activation eligibility, idempotent sync, suppression propagation, and destination reconciliation.

## 11. Phase 0 conclusion

The local baseline is now documented and suitable for Phase 1 design. The existing system has a usable product-centered foundation, but the new audience intelligence platform must be additive and compatibility-preserving.

Phase 0 is complete for repository/source verification. The only remaining Phase 0 items are deployed-environment checks that require live Supabase access and are not claimed here:

- Applied migration parity.
- Deployed Edge Function source/version parity.
- Runtime provider rows, priorities, enabled state, and credentials.
- Deployed RLS/constraint behavior.
