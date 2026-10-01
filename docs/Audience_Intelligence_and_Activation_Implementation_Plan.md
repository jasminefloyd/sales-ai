# Sales OS Audience Intelligence and Activation Implementation Plan

## 1. Purpose

This plan defines the complete implementation required to extend Sales OS from a product-to-outreach workflow into a product-aware audience intelligence and activation system.

The selected capability areas are:

1. Canonical audience data model
2. Account and contact enrichment
3. Provider-neutral identity and enrichment contracts
4. Audience quality and freshness scoring
5. Reusable audience definitions — optional, but the data model must support them
6. Audience and signal analytics
7. Product-specific intent scoring
8. Evidence-backed explanations
9. Human-approved audience activation

The implementation must preserve the existing product-centered workflow:

```text
Product source
→ Product Sales Profile
→ ICPs
→ Audiences
→ Outreach decisions
→ Generated copy
```

The expanded workflow becomes:

```text
Product source
→ Product Sales Profile
→ ICPs
→ Audience definition
→ Accounts and contacts
→ Enrichment and verification
→ Quality and intent scoring
→ Human review
→ Approved activation
→ Outreach and copy
→ Analytics and learning
```

## 2. Verified current state

The repository already contains the following relevant capabilities:

- Product source ingestion and parsing.
- Product Sales Profile generation and review.
- Versioned ICP and audience workflow.
- B2B account, contact, and opportunity records.
- Community and public-signal discovery.
- Evidence scoring and provenance.
- Outreach-channel recommendations.
- Generated email, community, Reddit, and social collateral.
- Human approval gates.
- Suppression checks and engagement safeguards.
- Provider registry and provider-run tracking.
- OpenAI and Anthropic reasoning fallback.
- Attribution, analytics, and learning proposals.

The following capabilities are not yet established as complete first-class platform features and are in scope for this plan:

- A unified audience-member data model.
- Reusable enrichment and identity contracts.
- Provider-neutral enrichment orchestration.
- Record and audience freshness handling.
- Audience quality states.
- Product-specific intent scoring.
- Audience and signal analytics.
- Evidence explanations for data and recommendations.
- Destination activation with human approval.

The current state must be re-verified at the beginning of each implementation phase. No phase should rely on an assumed schema, function, deployed function, or provider configuration.

## 3. Product principles

### 3.1 Product context remains the source of truth

Audience and intent decisions must be evaluated against the approved Product Sales Profile and approved ICP. Generic provider classifications must not override product-specific reasoning.

### 3.2 Strategic audiences and operational members are separate concepts

An audience definition describes who should be targeted. Audience members are the actual accounts, contacts, or pseudonymous entities that currently satisfy that definition.

### 3.3 Evidence and quality are different

- Evidence answers: “Why does this audience or record fit?”
- Quality answers: “Can this record be safely and effectively used right now?”

Both must be stored and displayed independently.

### 3.4 Human approval remains required

Human review is required before:

- An ICP becomes active.
- An audience becomes active.
- An audience is activated externally.
- A low-confidence identity merge is accepted.
- A learning change is applied.

### 3.5 Providers are replaceable

Provider-specific responses must be normalized into Sales OS contracts. Product logic must not depend directly on one enrichment or identity vendor.

### 3.6 No unsupported claims

Every score, recommendation, and explanation must identify its source evidence or explicitly state that evidence is insufficient.

## 4. Scope boundaries

### In scope

- Canonical audience and member data.
- Account and contact enrichment.
- Provider-neutral contracts.
- Identity candidates and deterministic matching.
- Quality, freshness, and readiness scoring.
- Product-specific intent scoring.
- Audience and signal analytics.
- Evidence-backed explanations.
- Human-approved export and activation.
- Reusable audience definitions at the data-model level.

### Optional later scope

- A visual audience-rule builder.
- Automated membership refresh schedules.
- Multiple CRM destinations.
- Advertising-platform destinations.
- Anonymous-to-known identity stitching.
- Probabilistic identity resolution.
- Agency and white-label audience operations.

### Explicitly out of scope for the initial implementation

- Building a proprietary database at AudienceLab scale.
- Building a 60B-event third-party behavioral graph.
- A proprietary DSP or ad exchange.
- Raw personal-data resale.
- Broad anonymous person-level identification.
- Fully autonomous cold outreach.
- Automatic low-confidence identity merges.
- Supporting every CRM and advertising network at launch.

## 5. Phase 0 — Repository, schema, and deployment audit

### Objective

Establish the verified baseline before changing the data model or workflow.

### Checklist

- [x] Inventory existing Sales OS tables, columns, constraints, indexes, and RLS policies. (Local source audit complete.)
- [x] Inventory existing account, contact, opportunity, audience, signal, event, provider, and analytics objects. (Local source audit complete.)
- [ ] Verify deployed Edge Functions and their current source versions. (Requires operator/live Supabase verification; not claimed locally.)
- [ ] Verify current provider capabilities and enabled provider rows. (Source adapters verified locally; runtime rows/credentials require operator/live verification.)
- [x] Verify all existing product-to-ICP-to-audience relationships. (Local schema and frontend/worker consumers audited.)
- [x] Verify all existing account and contact foreign keys. (Local migration source audited.)
- [x] Verify current suppression and consent behavior. (Local service and schema paths audited; live policy behavior remains unverified.)
- [x] Verify current analytics event dimensions. (Local schema, analytics service, and tracking code audited.)
- [x] Identify all frontend services that read or write affected tables. (Local consumer inventory complete.)
- [x] Identify existing migrations that cannot be safely rerun. (Concrete migration groups and the applied-state rule are recorded in `Audience_Intelligence_Phase_0_Audit.md`; remote applied-state parity remains unverified.)
- [x] Record schema discrepancies before implementation. (See `docs/Audience_Intelligence_Phase_0_Audit.md`.)

### Deliverables

- Baseline schema inventory.
- Existing workflow dependency map.
- Provider capability matrix.
- Migration and deployment checklist.
- Verified list of required compatibility changes.

### Acceptance criteria

- Every affected table and function has a verified owner and dependency list.
- No implementation begins from an assumed column or endpoint.
- Existing product workflow behavior has regression coverage.

### Phase 0 audit record

The local repository audit is recorded in [`Audience_Intelligence_Phase_0_Audit.md`](./Audience_Intelligence_Phase_0_Audit.md). It documents the current schema, dependency map, provider matrix, source Edge Function inventory, compatibility requirements, migration/deployment checklist, and validation baseline. Deployed-environment checks remain explicitly unverified until the operator performs them.

## 6. Phase 1 — Canonical audience data model

### Objective

Create the shared data layer connecting products, ICPs, audiences, members, accounts, contacts, signals, enrichment, quality, and activation.

### Data objects

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

Existing tables should be extended only where the relationship is clear and backward-compatible.

### Required fields

Every new entity must support:

- Tenant ID.
- Product ID where product-specific.
- ICP ID where ICP-specific.
- Audience ID where audience-specific.
- Stable internal ID.
- Source system.
- Source record ID.
- First-seen timestamp.
- Last-seen timestamp.
- Freshness timestamp.
- Confidence score.
- Provenance JSON.
- Consent state where applicable.
- Suppression state where applicable.
- Created and updated metadata.

### Checklist

- [x] Create migration for canonical audience objects. (`20260928010000_sales_os_phase_01_audience_data_model.sql`.)
- [x] Add foreign keys and tenant scoping.
- [x] Add uniqueness rules for source records.
- [x] Add indexes for product, ICP, audience, account, contact, status, and freshness.
- [x] Add RLS policies for tenant isolation.
- [x] Add state constraints and allowed values.
- [x] Add compatibility views or adapters where existing UI expects the current shape. (Existing tables remain unchanged; additive typed/persistence adapters were added.)
- [x] Add typed frontend and Edge Function contracts. (`src/services/audience/intelligenceContracts.ts`.)
- [x] Add persistence services. (`src/services/audience/intelligenceService.ts`.)
- [x] Add migration tests. (`supabase/tests/phase1_audience_data_model.test.ts`.)
- [x] Add CRUD and relationship contract tests. (Local contract/builders cover member identity, merge safety, activation, and relationship payloads; live database CRUD remains operator verification.)

### UI impact

No major UI change. Existing audience and B2B target cards can consume the new relationships after the backend is stable.

### Acceptance criteria

- Every audience can have zero or more operational members.
- Every member can link to an account, contact, or supported non-person entity.
- Existing audiences continue to render.
- Existing product-to-ICP-to-audience approvals continue to work.

### Phase 1 implementation record

Phase 1 local implementation is recorded in `docs/Audience_Intelligence_Phase_0_Audit.md` under the Phase 1 compatibility findings and in the phase-numbered migration and contract tests. The migration must be manually applied before runtime persistence can be verified.

## 7. Phase 2 — Provider-neutral data contracts

### Objective

Allow enrichment, identity, verification, signal, and activation providers to be added or replaced without changing workflow logic.

### Capability contracts

Initial capability names:

- `find_company`
- `find_contact`
- `enrich_company`
- `enrich_contact`
- `verify_email`
- `resolve_identity`
- `find_intent_signal`
- `export_audience`

### Checklist

- [x] Define normalized request and response schemas for each capability. (`src/providers/intelligenceContracts.ts`.)
- [x] Define provider error categories.
- [x] Define retryable versus non-retryable errors.
- [x] Define provider timeout behavior.
- [x] Define provider fallback behavior.
- [x] Add provider priority and capability registration. (`intelligenceRegistry.ts` and config compatibility loader.)
- [x] Add provider cost tracking. (Provider run recorder persists estimated/actual cost through the existing run ledger.)
- [x] Add provider health tracking. (Phase 2 migration adds health state, timeout, failure, and timestamp metadata.)
- [x] Add provenance persistence. (Normalized evidence is persisted to provider runs and returned in the contract.)
- [x] Add provider contract tests. (`intelligenceContracts.test.ts`, `intelligenceRunner.test.ts`, and migration contract test.)
- [x] Add mock provider adapters for local and automated testing. (`src/providers/adapters/mockIntelligence.ts`.)
- [x] Confirm fallback behavior when the preferred provider is unavailable. (Automated retryable-failure and policy-failure tests cover both paths; live provider behavior remains operator verification.)

### Phase 2 implementation record

Phase 2 is implemented locally through the phase-numbered migration, normalized contracts, compatibility adapter, health-aware registry, timeout/fallback runner, run recorder, mock provider, and contract tests. The migration must be manually applied before the new provider-run columns can be used against Supabase.

### UI impact

No user-facing UI change initially. Provider details should be visible through provenance and admin analytics rather than exposed in every workflow interaction.

### Acceptance criteria

- A provider can be replaced without changing ICP, audience, scoring, or activation logic.
- Provider failures do not silently create unverified data.
- Every returned field records its provider and observed timestamp.
- The system can distinguish “no result” from “provider failure.”

## 8. Phase 3 — Account and contact enrichment

### Objective

Turn approved B2B audience strategy into usable, verified account and contact records.

### Enrichment fields

- Company name.
- Domain.
- Industry.
- Company size.
- Revenue range where available.
- Location.
- Contact name.
- Job title.
- Seniority.
- Department.
- Professional email.
- Email verification state.
- Phone where lawfully available.
- Social profile.
- Technology indicators.
- Hiring or funding indicators.
- Buying role.

### Checklist

- [x] Queue enrichment after approved B2B audience creation.
- [x] Enrich organization before contact where required.
- [x] Enrich only missing or stale fields.
- [x] Normalize provider responses.
- [x] Store old and new values with provenance.
- [x] Verify email before marking a contact activation-ready.
- [x] Add retry and fallback handling.
- [x] Apply suppression and consent checks.
- [x] Record enrichment status per account and contact.
- [x] Record provider cost and latency.
- [x] Add partial-success behavior so one failed record does not fail the batch.
- [x] Add manual retry for failed records.
- [x] Add enrichment service tests.
- [x] Add worker integration tests.

### UI impact

Small-to-medium update to B2B target cards:

- Enrichment status.
- Verification badge.
- Last enriched date.
- Missing-field warnings.
- Retry action.
- Provider/source details.

### Acceptance criteria

Phase 3 is implemented locally through the phase-numbered schema migration, normalized
enrichment lifecycle helpers, approved-audience and post-find job queueing, worker
organization/contact enrichment, verification and suppression gates, partial-success
handling, manual retry UI, and contract/integration wiring tests. The migration must be
manually applied before the new columns/job type are available in Supabase; live provider
execution and deployment remain operator verification.

- Approved organization audiences can produce named account and contact targets.
- Contact verification status is explicit.
- Stale and incomplete records cannot appear activation-ready.
- Enrichment is idempotent.
- A failed provider does not erase previously verified data.

## 9. Phase 4 — Identity resolution

### Objective

Prevent duplicate accounts and contacts while preserving human control over uncertain matches.

### Matching rules

Deterministic matches:

- Normalized professional email.
- Verified phone.
- CRM record ID.
- Provider record ID.
- Canonical company domain.

Candidate matches:

- Name.
- Company.
- Job title.
- Location.
- Social profile.

### Checklist

- [x] Normalize email, phone, domain, and names.
- [x] Add deterministic match service.
- [x] Add identity candidate records.
- [x] Add confidence thresholds.
- [x] Add human review for uncertain matches.
- [x] Add reversible merge history.
- [x] Add conflict-resolution rules.
- [x] Add suppression checks against merged identities.
- [x] Add duplicate detection tests.
- [x] Add merge audit events.
- [x] Verify attribution survives a merge.

### UI impact

Small UI initially:

- Duplicate warning.
- Match confidence.
- Review-merge action.
- Link to supporting records.

A dedicated identity review page can follow if volume requires it.

### Acceptance criteria

Phase 4 is implemented locally through the phase-numbered identity schema migration,
normalization and deterministic-match service, candidate review records, approved/rejected/
reversible merge function, relationship re-pointing, append-only merge audit events, and
identity UI warnings/actions. Deterministic domain/email/phone/provider/CRM keys are
idempotent; uncertain name/title matches remain human-review candidates. Attribution
relationships remain attached to the canonical target when opportunities and engagements
are re-pointed. The migration must be manually applied before these identity columns and
indexes are available in Supabase; live duplicate records and deployed-function execution
remain operator verification.

- Deterministic duplicates resolve idempotently.
- Low-confidence matches are never merged automatically.
- Every merge is reversible and audited.
- A contact cannot be activated twice because of duplicate source records.

## 10. Phase 5 — Audience quality and freshness

### Objective

Separate strategic fit from operational readiness.

### Quality dimensions

- ICP fit.
- Evidence strength.
- Identity confidence.
- Contact verification.
- Signal recency.
- Source freshness.
- Duplicate risk.
- Suppression status.
- Consent state.
- Reachability.
- Enrichment completeness.

### Checklist

- [x] Define deterministic quality rubric.
- [x] Define freshness windows by field and source.
- [x] Add score calculation service.
- [x] Add audience-level rollups.
- [x] Add record-level quality states.
- [x] Add stale-record transitions.
- [x] Add “needs enrichment” transitions.
- [x] Add activation-readiness checks.
- [x] Add score history.
- [x] Add quality recalculation jobs.
- [x] Add test fixtures for stale, suppressed, incomplete, and verified records.

### Quality states

```text
ready
needs_enrichment
stale
low_confidence
suppressed
blocked
```

### UI impact

Small UI update initially:

- Quality badge on audience cards.
- Ready/member counts.
- Stale count.
- Missing-data count.
- Last refreshed timestamp.

### Acceptance criteria

Phase 5 is implemented locally through the phase-numbered quality/freshness migration,
deterministic operational quality rubric, freshness calculations, member snapshots,
audience rollups, quality recalculation jobs, explicit readiness state transitions, the
database activation gate, UI quality/count indicators, and stale/suppressed/incomplete/
verified test fixtures. Strategic evidence scoring remains separate from operational
quality. The migration must be manually applied before the new rollup columns, job type,
and activation gate are available in Supabase; live data recalculation and deployed worker
execution remain operator verification.

- Quality and evidence scores remain distinct.
- Activation rejects blocked, suppressed, or insufficiently verified records.
- Quality changes are explainable and auditable.

## 11. Phase 6 — Product-specific intent scoring

### Objective

Determine whether a signal indicates intent for this specific product, ICP, and audience.

### Signal inputs

- Product category.
- Problems solved.
- Primary use cases.
- ICP attributes.
- Audience attributes.
- Signal type.
- Signal recency.
- Signal frequency.
- Competitor or alternative references.
- Conversion goal.
- Prior engagement.
- Negative signals.

### Checklist

- [x] Define normalized signal taxonomy.
- [x] Map Product Sales Profile fields to signal categories.
- [x] Define signal weights.
- [x] Define recency decay.
- [x] Define repeated-signal boosts.
- [x] Define negative-signal penalties.
- [x] Define ICP-specific weights.
- [x] Define audience-specific weights.
- [x] Persist intent score and score explanation.
- [x] Persist score history.
- [x] Allow human override with reason.
- [x] Feed outcomes into learning proposals.
- [x] Add deterministic scoring tests.
- [x] Add provider-signal normalization tests.

### UI impact

Small-to-medium update:

- Intent score on signal cards.
- Intent score on B2B target cards.
- “Why this score?” expandable explanation.
- Signal timeline.

### Acceptance criteria

- The same signal can score differently for different products.
- Score includes recency and ICP fit.
- Every score has a deterministic explanation.
- Missing evidence produces an explicit low-confidence state rather than an invented rationale.

Phase 6 is implemented locally through the phase-numbered intent-scoring migration,
normalized signal taxonomy, deterministic product/ICP/audience scoring, recency and
frequency adjustments, negative-signal penalties, score history, learning events, human
override endpoint, worker follow-up, and UI score explanations. The migration must be
manually applied before the new columns, taxonomy, and job type are available in
Supabase; Edge Function deployment and live provider execution remain operator
verification.

## 12. Phase 7 — Evidence-backed explanations

### Objective

Make audience membership, scores, recommendations, and activation decisions reviewable.

### Explanations required

- Why this person belongs to the audience.
- Why this company matches the ICP.
- Why this signal indicates intent.
- Why this channel was selected.
- Why this copy angle was selected.
- Why a record was excluded.
- Why activation is blocked.
- Which sources support the recommendation.

### Checklist

- [x] Standardize evidence records.
- [x] Link evidence to source records.
- [x] Link evidence to scores.
- [x] Link evidence to outreach decisions.
- [x] Preserve evidence snapshots.
- [x] Add deterministic explanation templates.
- [x] Use AI only to summarize available evidence.
- [x] Reject unsupported AI claims.
- [x] Add insufficient-evidence states.
- [x] Add evidence links and snippets.
- [x] Add explanation tests.

### UI impact

Small UI update in existing cards:

- Expandable “Why?” sections.
- Evidence source list.
- Confidence label.
- Missing-evidence message.
- Source links where available.

Phase 7 is implemented locally through the phase-numbered evidence migration, append-only
evidence snapshots, safe existing-record backfill, deterministic explanation states,
source links/snippets, explicit insufficient-evidence records, Product Details evidence
disclosures, and automated schema/UI/explanation tests. The migration must be manually
applied before the evidence table and capture triggers exist in Supabase; updated Edge
Function deployment and live evidence verification remain operator verification.

### Acceptance criteria

- Every material recommendation has linked evidence or an explicit evidence gap.
- The UI never represents a qualitative AI statement as verified fact.
- Evidence remains available after a record is refreshed or re-enriched.

## 13. Phase 8 — Audience and signal analytics

### Objective

Measure the complete data-to-outcome pipeline.

### Required funnel

```text
Discovered
→ Resolved
→ Enriched
→ Verified
→ Audience-ready
→ Activated
→ Engaged
→ Qualified opportunity
→ Converted
```

### Required dimensions

- Product.
- ICP.
- Audience.
- Account.
- Contact.
- Signal.
- Source.
- Provider.
- Channel.
- Outreach motion.
- Message angle.
- CTA.
- Destination.
- Activation status.

### Checklist

- [x] Add audience-member lifecycle events.
- [x] Add enrichment events.
- [x] Add identity-resolution events.
- [x] Add quality-state events.
- [x] Add activation events.
- [x] Add match-rate events.
- [x] Add sync and reconciliation events.
- [x] Extend analytics aggregation service.
- [x] Add audience funnel metrics.
- [x] Add signal performance metrics.
- [x] Add provider quality metrics.
- [x] Add activation performance metrics.
- [x] Add conversion metrics.
- [x] Add first-touch and last-touch views.
- [x] Add period comparison.
- [x] Add analytics data-quality tests.

### UI impact

Major UI update.

Add an Audience Intelligence area with:

- Overview.
- Audiences.
- Signals.
- Enrichment.
- Activation.
- Providers.

Product Details should show summary metrics only, not become the full analytics console.

### Acceptance criteria

- Funnel totals reconcile across lifecycle stages.
- Analytics can be filtered by product, ICP, audience, provider, and channel.
- Retried jobs do not create false conversions.
- Timezone and attribution conventions are explicit.
- A user can identify where an audience lost records.

Phase 8 is implemented locally through the phase-numbered analytics migration, lifecycle
event instrumentation, idempotent match/sync/provider events, audience funnel and signal
aggregation, provider and activation quality metrics, first/last-touch attribution,
retry-safe conversion deduplication, and the new Audience Intelligence analytics area
with product, ICP, audience, provider, and channel filters. The migration must be
manually applied before lifecycle triggers and analytics indexes exist in Supabase; live
event generation and deployed dashboard behavior remain operator verification.

## 14. Phase 9 — Human-approved activation

### Objective

Move approved audiences into external systems without bypassing review or suppression controls.

### Initial destinations

Implement in this order:

1. CSV export.
2. Webhook.
3. One CRM connector.
4. Additional CRM connectors.
5. Advertising destinations.

### Activation flow

```text
Audience ready
→ Review members
→ Review quality and suppression results
→ Select destination
→ Configure field mapping
→ Preview records
→ Approve activation
→ Run sync
→ Review results
```

### Checklist

- [x] Add destination model.
- [x] Add secure credential storage.
- [x] Add destination capability contracts.
- [x] Add API-key setup through Edge Function secret references.
- [x] Add field-mapping configuration.
- [x] Add activation preview.
- [x] Add activation approval records.
- [x] Add full and incremental/retry sync modes.
- [x] Add idempotent upserts.
- [x] Add deletion and suppression propagation.
- [x] Add retry and rate-limit handling.
- [x] Add destination-side identifiers.
- [x] Add sync logs.
- [x] Add reconciliation.
- [x] Add failed-record review.
- [x] Add disconnect and credential rotation boundary.
- [x] Add activation audit events.
- [ ] Add end-to-end connector tests with mocks.

### UI impact

Major UI update.

Add an Activation area with:

- Destination connections.
- Audience preview.
- Field mapping.
- Approval step.
- Sync status.
- Failed-record review.
- Sync history.
- Re-sync controls.

Activation must remain separate from copy approval and message sending.

### Acceptance criteria

- No audience is activated without explicit approval.
- Suppressed records never leave Sales OS through activation.
- Re-running a sync does not duplicate destination records.
- Deleted or suppressed members are propagated where the destination supports it.
- Failed records are visible and retryable.
- Every activation can be traced to a specific audience version and approval.

Phase 9 is implemented locally through the phase-numbered activation migration, secure
destination references, CSV/webhook/HubSpot activation contracts, readiness preview,
explicit approval records, worker-backed idempotent sync, suppression/removal
reconciliation, sync logs, failure retry controls, and an Activation UI. The migration
must still be applied manually and the `sales_os-activation` and `sales_os-worker`
functions must be redeployed by the operator. Mock connector end-to-end tests and live
provider execution remain outstanding; no provider credentials were used during local
verification.

## 15. Phase 10 — Reusable audience definitions

### Objective

Make audience definitions refreshable and reusable without forcing the visual builder into the first release.

### Initial implementation

- Store audience rules as versioned JSON.
- Generate the rules from approved ICP and audience strategy.
- Show the rules in the existing audience workflow.
- Re-evaluate membership on demand.
- Store membership changes.
- Show refresh timestamp and member count.

### Later visual builder

- Filter builder.
- Inclusion and exclusion rules.
- Signal recency filters.
- Company and contact filters.
- Audience preview.
- Overlap analysis.
- Saved templates.

### Checklist

- [x] Define audience-rule schema.
- [x] Version the rule set.
- [x] Validate rule inputs.
- [x] Evaluate rules deterministically.
- [x] Materialize memberships.
- [x] Track additions and removals.
- [x] Add refresh jobs.
- [x] Add preview counts.
- [x] Add rule explanation.
- [x] Add rule regression tests.

### UI impact

Initial implementation: small UI update.

Full visual builder: major new page.

Phase 10 is implemented locally through the phase-numbered reusable-audience migration,
refresh-run and membership-change history, deterministic rule evaluation, preview and
refresh Edge Function, worker execution, and the Audience definitions UI. The initial
release evaluates the persisted audience-member universe; provider discovery and the
later visual rule builder remain outside this phase. The migration must be applied
manually and `sales_os-refresh-audience` plus `sales_os-worker` must be redeployed by
the operator.

## 16. Cross-cutting security and compliance

### Checklist

- [ ] Confirm lawful basis and permitted use for each data source.
- [ ] Store consent and purpose metadata where required.
- [ ] Apply region-specific restrictions.
- [ ] Support deletion and export requests.
- [ ] Propagate do-not-contact records.
- [ ] Store provider licensing restrictions.
- [ ] Encrypt credentials.
- [ ] Audit access to personal data.
- [ ] Enforce tenant isolation.
- [ ] Define retention windows.
- [ ] Add incident and provider-breach handling.
- [ ] Obtain legal review before person-level behavioral identification or paid audience activation.

## 17. Testing and verification strategy

### Unit tests

- Normalization.
- Identity matching.
- Enrichment response parsing.
- Verification state transitions.
- Freshness decay.
- Quality scoring.
- Intent scoring.
- Evidence explanations.
- Audience-rule evaluation.
- Activation eligibility.

### Integration tests

- Product-to-ICP-to-audience persistence.
- Audience-to-member persistence.
- Enrichment worker execution.
- Provider fallback.
- Suppression handling.
- Activation approval.
- Incremental sync.
- Retry and idempotency.
- Analytics event generation.

### End-to-end scenarios

- B2B product creates verified account and contact targets.
- B2C/community product creates non-contact audience members.
- Stale records are excluded from activation.
- A provider failure falls back to another provider.
- A suppressed contact is blocked.
- A human rejects an identity merge.
- A user approves an audience activation.
- A sync partially fails and can be retried.
- A conversion is attributed to the correct audience and signal.

### Verification rule

Each phase is complete only when:

- Source code is implemented.
- Required migrations exist.
- Required functions are deployed by the operator.
- Automated tests pass.
- Typecheck and lint pass.
- UI behavior is verified where UI changed.
- The implementation checklist is updated.
- Remaining live-provider limitations are explicitly recorded.

## 18. Migration and deployment policy

Every database phase must include migrations named with the phase number, for example:

```text
supabase/migrations/<timestamp>_phase_01_audience_data_model.sql
supabase/migrations/<timestamp>_phase_02_enrichment_contracts.sql
supabase/migrations/<timestamp>_phase_04_quality_freshness.sql
```

Migrations must be:

- Idempotent where practical.
- Safe against existing data.
- Compatible with manually applied deployment.
- Explicit about backfills.
- Tested against duplicate and partial-state conditions.

Edge Functions must be redeployed after backend source changes. The implementation must report source verification and live deployment verification separately.

## 19. Final definition of done

The initiative is complete when Sales OS can:

1. Import a product source and generate an approved Product Sales Profile.
2. Generate approved primary and secondary ICPs.
3. Generate a versioned audience definition for each approved ICP.
4. Resolve audience members into accounts, contacts, or supported audience entities.
5. Enrich and verify records through provider-neutral contracts.
6. Score evidence, quality, freshness, and product-specific intent separately.
7. Explain every material membership, score, recommendation, and exclusion.
8. Show audience and signal performance analytics.
9. Require human approval before external activation.
10. Activate approved audiences through at least CSV, webhook, and one CRM connector.
11. Reconcile activation results and surface failures.
12. Attribute outcomes back to product, ICP, audience, signal, provider, channel, and copy.
13. Produce human-reviewed learning proposals from those outcomes.

The result should be a product-aware audience intelligence and activation system, not a generic data warehouse and not an uncontrolled autonomous outreach engine.
