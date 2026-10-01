# Product Workflow Page Redesign: Implementation Guide

**Route:** `/sales-os/products/:productId`
**Current file:** `src/app/ProductWorkflowPage.tsx` (2,797 lines)
**Reference design:** `ProductWorkflowPage.jsx` (the approved mockup, delivered separately)
**Audience:** Frontend engineers working in the `sales-ai` repo

---

## 1. Why we are doing this

Users told us the Product Details page has too much copy, and that a lot of it reads like logs or code rather than product UI. The information itself is valuable, so the goal is **not** to remove functionality. The goal is to:

1. Show one workflow step at a time instead of stacking all five on one long page.
2. Replace system-facing strings (fallback messages, snake_case values, raw JSON, `[object Object]`) with plain language, and move the technical detail behind a "Technical details" disclosure.
3. Turn long comma-separated paragraphs into chips, short lists, and small visuals (icons, meters, a conversion flow).
4. Give the user a single, persistent "what do I do next" card instead of three competing status areas.

**Every action that exists on the page today must still exist after the redesign.** Section 9 is the parity checklist; treat it as a release gate.

---

## 2. Current state audit

This section records what we found in the code. Several items are bugs that cause the problems users reported, and they should be fixed first (PR 1) because they are independent of the visual work.

### 2.1 Structure

`ProductWorkflowPage.tsx` is a single component that owns:

- 16 row types (lines 23–245) and 3 formatting helpers (`parseStructuredValue`, `readableItems`, `readableObject`, `readableLabel`).
- ~35 `useState` hooks (lines 261–342).
- One `load()` function that runs 16 parallel Supabase queries (line 393) and is polled every 5 seconds (line 647).
- ~15 mutation handlers (ICP, audience, profile, outreach, copy, identity, enrichment, product input).
- ~1,800 lines of JSX for five stages, a sidebar, a stepper, a status card, a traceability panel, a profile history panel, and a rediscovery dialog.

There are no component tests (Vitest runs in `environment: 'node'`, so only `.ts` logic is tested). This is why the plan below moves all display logic into pure `.ts` presenter functions that can be unit tested.

### 2.2 Bugs and root causes behind the user feedback

| # | Symptom users see | Root cause | Location |
|---|---|---|---|
| B1 | Red "Needs attention" banner and an `error` pill while every step shows a checkmark | `deriveProductWorkflowView` returns `error` whenever **any** job for the product has `status = 'failed'` and nothing is running. The jobs query (line ~510) fetches every job ever created, so one old failure pins the page in `error` forever, even after a later retry succeeded. It also counts `find`, `learning_analysis`, `attribution`, and `console_action` jobs, which are not part of this workflow. | `workflowState.ts` line ~88; page line 1018 |
| B2 | Pill literally says `error` | The status pill prints `workflow.state.replaceAll('_', ' ')`, the raw state key | line 1272 |
| B3 | Every step shows a checkmark even though copy is still waiting for review | `workflowSteps[copy].complete` is `generatedCopy.length > 0`, so a draft awaiting approval counts as done. Rejected copy also counts. | line 1042 |
| B4 | `Follow-up: [object Object]` | `follow_up_strategy` is a `jsonb` column shaped `{ cadence, steps }`, but the `GeneratedCopy` type declares it `string \| null`, and it is interpolated into a template literal | type line 96; render line 2747 |
| B5 | `PRIMARYEVENT`, `SECONDARYEVENT` | `readableLabel('primaryEvent')` only replaces underscores, producing `PrimaryEvent`, and `.profile-detail-facts dt` applies `text-transform: uppercase` | page line 253; `app.css` ~line 1112 |
| B6 | `{ "evidenceCount": 3 }` | `evidence_score_detail` is rendered with `JSON.stringify` inside a `<pre>` | line 2086 |
| B7 | "Deterministic fallback derived from the persisted product profile after the reasoning provider returned an invalid audience shape." | This is the literal value of `outreach_motion_reason` written by the fallback path in `supabase/functions/_shared/workerAnalysis.ts` (~line 1023). The page renders it verbatim. | line ~2095 |
| B8 | "Fallback ICP; human review is required before discovery." | Literal `ai_fit_assessment` from the same fallback (~line 1032) | line ~2094 |
| B9 | `signup_focused_social_content` | `collateral_strategy.primaryType` printed with `String()` | line ~2100 |
| B10 | Raw markdown (`# Atelier.Gallery`, `**For Reddit/...:**`) | Source content and copy drafts are rendered as plain text in `<pre>` and `<textarea>` | lines ~1350, ~2755 |
| B11 | "Audiences for ICP" with no Section 3 header | The ICP section only renders when `icps.length > 0`, but audiences render separately (line ~2020) whenever the profile is approved. When no ICP rows load, audiences appear orphaned and the fallback heading reads "Audiences for ICP". | lines 1724, 2031 |
| B12 | Section numbering jumps from 2 to 4 | Same cause as B11 | — |
| B13 | Edits disappear while typing | `load()` calls `setInputDraft(...)` and `setProfileDraft(...)` on **every** 5-second poll, overwriting whatever the user is typing in the product input or profile edit form | lines 557, 579 |
| B14 | Error/success messages appear in the middle of the page | The `error` and `reviewSuccess` paragraphs are rendered between the ICP section and the audience list | line ~2005 |
| B15 | Dead CSS | `.product-workflow-page > *` flex `order` rules (`app.css` ~lines 803–826) target `.profile-panel`, `.source-panel`, etc. as direct children, but those elements are inside `.product-workflow-main`, so the rules never apply | `app.css` |

### 2.3 Backend behaviors the new UI must respect

These affect what the mockup is allowed to promise.

- **Copy "Request changes" does not regenerate a draft.** `sales_os-review-engagement` sets the engagement to `rejected` and stores `reviewNotes` on the approval row. Nothing re-drafts. The mockup's "A revised draft will appear here" text must change (see 6.8).
- **Copy approval cannot be undone.** The edge function rejects any engagement not in `awaiting_approval`. The mockup's "Undo" button must be removed.
- **`reviewEngagement` already accepts `reviewNotes`** (`src/services/engagement/reviewService.ts`). The page just never passes it. The new "What should change?" field can use it with no backend work.
- **Fallback audiences are detectable.** The fallback writes `buying_behavior.source = 'product_profile_fallback'`. The page doesn't currently select `buying_behavior`; add it to the audiences query so the UI can show the "Auto-generated, review suggested" badge reliably instead of string-matching the reason text.
- **Jobs have `job_type`, `workflow_stage`, and `created_at`.** `workflow_stage` is one of `product_input | profile_review | strategy_generation | outreach_review | copy_generation | learning | diagnostics`. Use it to scope failures to the workflow (B1).

---

## 3. Target architecture

Split the page into a data layer, a pure presenter layer, and presentational components. Keep the public import (`import { ProductWorkflowPage } from './ProductWorkflowPage'` in `App.tsx`) unchanged.

```
src/app/
  ProductWorkflowPage.tsx                  ← becomes a 1-line re-export (keeps App.tsx untouched)
  productWorkflow/
    ProductWorkflowPage.tsx                ← page shell: header, stepper, active panel, rail
    productWorkflow.css                    ← all styles for this page
    types.ts                               ← row types moved from the old file (fixed, see 4.2)
    useProductWorkflowData.ts              ← load(), polling, returns typed rows
    useProductWorkflowActions.ts           ← every mutation handler, busy keys, toasts
    presenters.ts                          ← PURE functions: statuses, summaries, humanized copy
    presenters.test.ts                     ← unit tests (node env)
    copy.ts                                ← all user-facing strings in one place
    components/
      primitives.tsx                       ← Badge, ChipList, Disclosure, InfoCard, PanelHeader, SourceList
      Stepper.tsx
      NextUpRail.tsx
      Toasts.tsx
      RediscoveryDialog.tsx
      MarkdownPreview.tsx
    panels/
      SourcePanel.tsx
      ProfilePanel.tsx
      ProfileEditForm.tsx
      AudiencesPanel.tsx
      IcpCard.tsx
      IcpEditForm.tsx
      AudienceCard.tsx
      AudienceEditForm.tsx
      B2BTargets.tsx
      OutreachPanel.tsx
      CopyPanel.tsx
      CopyCard.tsx
```

Rules:

- **Components never format data.** Anything that turns a DB value into display text lives in `presenters.ts` (so it's testable) or `copy.ts`.
- **`presenters.ts` must not import React.** Vitest only picks up `src/**/*.test.ts`.
- Named exports only (the repo convention; the mockup's `export default` must be changed).
- Keep `react-refresh/only-export-components` clean: don't export helpers from `.tsx` files.

---

## 4. Dependencies and foundations

### 4.1 Add an icon library

The repo has no icon library. Add `lucide-react` and **pin the version** (most deps in `package.json` use `latest`; don't add another floating one):

```bash
npm install lucide-react@0.460.0 --save-exact
```

Import icons individually (`import { Check } from 'lucide-react'`) so they tree-shake. Always pass `aria-hidden="true"` on decorative icons.

Icon mapping used across the page:

| Concept | Icon |
|---|---|
| Source step | `FileText` |
| Sales profile step | `Package` |
| Audiences step | `Target` |
| Outreach step | `Megaphone` |
| Copy step | `PenLine` |
| Approved | `Check` |
| Waiting / pending | `Clock` |
| Warning / auto-generated | `AlertTriangle` |
| Problems solved | `AlertTriangle` |
| Use cases | `Lightbulb` |
| Purchase friction | `Construction` |
| Alternatives | `ArrowLeftRight` |
| Conversion goal | `Flag` |
| Evidence | `ShieldCheck` |
| Conversion flow: trigger / primary / outcome / bonus | `Zap` / `MousePointerClick` / `BadgeCheck` / `TrendingUp` |
| Channel: reddit, community | `MessageSquare` / `Users` |
| Channel: email | `Mail` |
| Channel: professional social | `Briefcase` |
| Edit / Replace / Preview / History | `Pencil` / `Upload` / `Eye` / `History` |

Lucide removed brand logos, so don't use a Reddit logo. If design wants brand marks later, add them as local SVGs.

### 4.2 Add a markdown renderer

Source files and copy drafts are markdown. Add:

```bash
npm install react-markdown@9.0.1 --save-exact
```

Wrap it in `components/MarkdownPreview.tsx`. **Do not** enable `rehype-raw` or any HTML passthrough; this content comes from uploads and LLM output. Restrict allowed elements to `p, h1–h4, ul, ol, li, strong, em, a, blockquote, code, br` and force links to `target="_blank" rel="noreferrer"`.

### 4.3 Fix the row types

Move all types to `productWorkflow/types.ts` and fix:

```ts
export type FollowUpStrategy = {
  cadence?: string;
  steps?: Array<string | { delayDays?: number; action?: string; note?: string }>;
};

export type GeneratedCopy = {
  // ...existing fields
  follow_up_strategy: FollowUpStrategy | null;   // was: string | null  (bug B4)
};

export type Audience = {
  // ...existing fields
  buying_behavior: { source?: string } & Record<string, unknown>;   // new, for fallback detection
};

export type WorkflowJob = {
  id: string;
  job_type: string;          // new
  workflow_stage: string | null;  // new
  status: string;
  error: Record<string, unknown> | null;
  created_at: string;        // new
};

export type EvidenceScore = 'low' | 'medium' | 'high';  // matches the DB check constraint
```

Update the corresponding `select(...)` strings in the data hook (`buying_behavior` on audiences; `job_type, workflow_stage, created_at` on jobs).

### 4.4 Design tokens

The mockup used its own variable names. Map them onto the existing `:root` tokens in `app.css` instead of introducing a parallel palette. Add only one new token.

| Mockup variable | Use existing token | Value |
|---|---|---|
| `--canvas` | `--surface-100` | `#f6f3ee` |
| `--surface` | `--surface-0` | `#fff` |
| `--sunken` | **add** `--surface-50` | `#faf8f4` |
| `--ink` | `--ink` | `#1a1a1e` |
| `--muted` | `--ink-muted` | `#6b6558` |
| `--line` | `--border` | `#dad4c7` |
| `--brand` | `--ember` | `#d9531e` |
| `--brand-ink` | `--ember-strong` | `#b8431a` |
| `--brand-soft` | `--ember-tint` | `#fbe8df` |
| `--ok` / `--ok-soft` | `--success-text` / `--success-tint` | |
| `--warn` / `--warn-soft` | `--warning-text` / `--warning-tint` | |

Typography: keep the app fonts. Body is `IBM Plex Sans`; panel titles and the page title use `Space Grotesk` (matching `.outreach-list-item strong`). Don't import Instrument Sans.

### 4.5 CSS approach

Create `productWorkflow/productWorkflow.css` and import it from the new page shell. Prefix every class with `pw-` (the mockup used `ag-`; rename on port). Copy the mockup's rules, swap the variables per 4.4, and:

- Do **not** use uppercase eyebrow labels anywhere on this page (a direct user complaint). Remove the `eyebrow` usages.
- Use the existing breakpoints (960px and 760px) instead of the mockup's 900px and 640px.
- Delete the dead `order` rules listed in B15 and all selectors that only served the old layout (`.workflow-sidebar*`, `.workflow-outline*`, `.workflow-steps`, `.workflow-step*`, `.workflow-summary`, `.workflow-stage-*`, `.traceability-panel`, `.profile-history-panel`, `.detail-json` if unused elsewhere). Grep before deleting: some (`.status-pill`, `.evidence-meter`, `.route-row`) are shared with other pages.

---

## 5. Presenter layer (`presenters.ts`)

This is the heart of the change. It replaces the inline logic spread through the JSX and fixes B1–B9. All functions are pure and must have tests.

### 5.1 Scope failures to the current workflow (fixes B1)

```ts
const WORKFLOW_STAGES = new Set([
  'product_input', 'profile_review', 'strategy_generation',
  'outreach_review', 'copy_generation',
]);

/**
 * A failure only counts if it is the most recent job of its type
 * AND belongs to the product workflow. A later success clears it.
 */
export function currentWorkflowFailures(jobs: WorkflowJob[]): WorkflowJob[] {
  const latestByType = new Map<string, WorkflowJob>();
  for (const job of jobs) {
    if (!job.workflow_stage || !WORKFLOW_STAGES.has(job.workflow_stage)) continue;
    const prev = latestByType.get(job.job_type);
    if (!prev || job.created_at > prev.created_at) latestByType.set(job.job_type, job);
  }
  return [...latestByType.values()].filter((job) => job.status === 'failed');
}
```

Pass `currentWorkflowFailures(jobs).length` as `failedJobCount` into `deriveProductWorkflowView`. Do the same scoping for `activeJobCount`. Leave `workflowState.ts` itself unchanged, and add a test there that documents it expects pre-scoped counts.

### 5.2 Per-step status

Replace the boolean `complete` model with five statuses:

```ts
export type StepId = 'source' | 'profile' | 'audiences' | 'outreach' | 'copy';
export type StepStatus = 'locked' | 'working' | 'review' | 'attention' | 'approved';

export type StepView = {
  id: StepId;
  label: string;         // from copy.ts
  status: StepStatus;
  summary: string;       // one line under the step name, e.g. "1 draft to review"
};

export function deriveSteps(input: WorkflowData): StepView[];
export function defaultActiveStep(steps: StepView[]): StepId;
```

Rules (evaluate top to bottom per step, first match wins):

| Step | attention | review | working | approved | locked |
|---|---|---|---|---|---|
| **source** | latest `product_input` job failed | no input and no sources | — | has input or sources | — |
| **profile** | latest `profile_review` job failed | `review_status = 'needs_review'` | no profile yet and product is `draft`/`analyzing` | `review_status = 'approved'` | no input |
| **audiences** | latest `strategy_generation` job failed | any ICP or audience `proposed` | strategy job queued/running and no audiences | ≥1 audience `approved`/`active` | profile not approved |
| **outreach** | — | any decision `proposed` | strategy job running and no decisions | ≥1 decision `approved` | no approved audience |
| **copy** | latest `copy_generation` job failed, **or** all copy `rejected` | any copy `awaiting_approval` | `copy_generation` job queued/running | all non-rejected copy `approved` and ≥1 approved | no approved decision |

`defaultActiveStep`: the first step with `attention`; else the first with `review`; else the last step that isn't `locked`.

Summaries (all strings live in `copy.ts`):

| Step | Example summaries |
|---|---|
| source | "1 file", "2 sources", "Add product info" |
| profile | "Version 2 approved", "Version 2 to review", "Building…" |
| audiences | "1 audience", "3 to review", "Generating…" |
| outreach | "Reddit", "Reddit + 1 more", "2 to review" |
| copy | "1 draft to review", "3 approved", "Drafting…", "Rejected" |

### 5.3 Next-up card

```ts
export type NextUp = {
  tone: 'attention' | 'review' | 'waiting' | 'done';
  title: string;          // "Review 1 draft"
  body: string;           // one sentence
  actionLabel: string;    // "Review draft"
  targetStep: StepId;
};
export function deriveNextUp(steps: StepView[], data: WorkflowData, failures: WorkflowJob[]): NextUp;
```

This replaces **all three** of today's status areas: the "Current step" summary panel (line 1265), the sidebar "Needs you" card, and the sidebar "Product status" card. For `attention`, use `presentWorkflowJob(...).detail` from `workflowProgress.ts` for the body, and pass it through `humanizeSystemText` (5.4) first because `error.reason` can be a raw provider message.

Keep the existing `needs` array logic (line 1061) as the source for counts, but reword the strings per section 7.

### 5.4 Humanizing system text (fixes B5–B9)

```ts
/** snake_case / camelCase → "Sentence case" */
export function humanizeKey(value: string): string;
// 'primaryEvent' → 'Primary event'; 'signup_focused_social_content' → 'Signup focused social content'

export function collateralLabel(primaryType: string | undefined): string;
// Known map first, humanizeKey fallback:
//   signup_focused_social_content → 'Social content, sign-up focused'
//   personalized_email            → 'Personalized email'
//   segmented_email_and_community → 'Email and community, by role'
//   public_conversation_response  → 'Replies in public conversations'

export function motionLabel(motion: string | null): string;
//   b2c → 'Sells to individuals (B2C)'   b2b → 'Sells to businesses (B2B)'
//   b2b2c → 'Businesses and their customers (B2B2C)'   community → 'Community-led'
//   null → 'Motion pending'

export function channelLabel(channel: string): string;
//   reddit → 'Reddit', email → 'Email', professional_social → 'LinkedIn and professional social', ...

export function isFallbackAudience(a: Audience): boolean;
// a.buying_behavior?.source === 'product_profile_fallback'

export function isFallbackText(text: string | null | undefined): boolean;
// /deterministic fallback|fallback icp|invalid audience shape|fallback route/i
// Used for decisions, which don't carry buying_behavior.

export function formatFollowUp(f: FollowUpStrategy | null): string | null;
// { cadence: 'human_review_required', steps: [] } → null (hide it)
// { cadence: 'weekly', steps: [...] } → 'Weekly, 2 follow-ups'

export function conversionFlow(event: Record<string, unknown>): {
  steps: Array<{ key: 'trigger' | 'primaryEvent' | 'outcome'; title: string; text: string }>;
  bonus: { title: string; text: string } | null;
  other: Array<[string, string]>;   // unknown keys, rendered as a plain list
};
// Order: trigger → primaryEvent → outcome. secondaryEvent becomes `bonus`.

export function listDisplay(items: string[]): 'chips' | 'list';
// 'chips' when every item is ≤ 48 chars, otherwise 'list'.
// Profile fields are LLM sentences of varying length; long ones look bad as chips.

export function cleanDraft(content: string): string;
// Strips a leading label line such as "**For Reddit/Artist Community Posts:**"
// (regex: /^\s*\*\*for [^*]+:\*\*\s*\n+/i). Never alters the rest of the text.

export function evidenceSummaryText(count: number, confidence: EvidenceScore): string;
// 'Backed by 3 sources, medium confidence. Check them before treating claims as fact.'
```

Do **not** change `summarizeEvidence` in `src/services/evidence/explanations.ts`. Its wording is asserted in existing tests and used elsewhere. Rewrite its output in the presenter instead.

### 5.5 Rejected and superseded rows

Filter these out of default views (they currently inflate counts and clutter the page):

- ICPs, audiences, and decisions with `status = 'rejected'`: hide by default, show a "Show 2 rejected" link at the bottom of the panel.
- Copy with `status = 'rejected'`: same treatment.
- Only the current `is_active` profile is shown. History goes behind the "History" button.

---

## 6. Component specs

For each area: what it replaces, the layout, the exact behaviors, and the copy. Line numbers refer to the current `ProductWorkflowPage.tsx`.

### 6.1 Page shell (`productWorkflow/ProductWorkflowPage.tsx`)

**Replaces:** lines 1117–1275 (header, eyebrow, sidebar, stepper, "Current step" panel, the "versioned child of its ICP" sentence).

```
← Products
Atelier.Gallery
Turn your product details into audiences, outreach channels, and ready-to-use copy.

[Stepper: Source ─ Sales profile ─ Audiences ─ Outreach ─ Copy]

[Toasts]
┌──────────── active panel ─────────────┐ ┌─ NextUpRail (sticky) ─┐
│                                        │ │ Next up card          │
│                                        │ │ Progress: 4 of 5      │
│                                        │ │ How this was built ▾  │
└────────────────────────────────────────┘ └───────────────────────┘
```

Behavior:

- Active step is stored in the URL as `?step=copy` via `useSearchParams`. This lets other pages (Today, Engage) deep-link to a step. If `step` is missing or invalid, use `defaultActiveStep`.
- **Only initialize the default once per product.** Later polls must not yank the user to a different step. Store a `hasInitializedStep` ref keyed on `productId`.
- When the step changes, move focus to the panel's `<h2>` (give it `tabIndex={-1}`) and scroll to the top of the panel.
- Remove the "Product workflow" eyebrow, the "Current step" panel, and the sentence at line 1275.
- Grid: `minmax(0, 1fr) 300px`, 24px gap. Under 960px, single column with the rail **above** the panel (`order: -1`).

### 6.2 Stepper (`components/Stepper.tsx`)

**Replaces:** the top `workflow-steps` nav (line 1244), the sidebar outline (line 1172), and the Traceability panel (line 1355). The connectors between nodes now communicate the lineage visually.

- Render a `<nav aria-label="Workflow steps">` with one `<button>` per step. Use `aria-current="step"` on the active one.
- Each node: 48px circle with the step icon; a 20px status mark at bottom-right (green `Check` for approved, ember dot with count for review, warning `Clock` for working, warning `AlertTriangle` for attention, no mark for locked).
- Under the node: step label (600 weight) and the one-line summary (muted, 13px).
- Connector between node *i* and *i+1* is green at 50% opacity when both are `approved`, otherwise `--border`.
- `locked` steps are still clickable. They show an empty state explaining what unlocks them (6.3–6.8 each define one).
- Visually hidden text per button for screen readers, e.g. `"Copy, 1 draft to review"`. The icon marks are `aria-hidden`.
- Under 760px, the stepper scrolls horizontally (`overflow-x: auto`); each step keeps a 150px min width.

### 6.3 Next-up rail (`components/NextUpRail.tsx`)

- **Card** driven by `deriveNextUp`. Tones: `attention` (ember gradient, primary button), `review` (same as attention), `waiting` (warning icon, secondary button), `done` (green icon, secondary button). The button calls `setActiveStep(targetStep)`.
- **Progress:** "4 of 5 steps approved" plus a thin green bar. The count comes from `steps.filter(s => s.status === 'approved').length`.
- **"How this was built"** disclosure (collapsed by default). This preserves the lineage data from the old Traceability panel (parity). Render each `LineageRow` as a humanized chain using the step icons, e.g. `📄 Source → 📦 Profile v1`. No `relation_type` strings are shown.
- If there are additional open items beyond the first (`needs.length > 1`), list them as small links under the card: "Also: 2 audiences to review".

### 6.4 Toasts (`components/Toasts.tsx`) (fixes B14)

- Render directly under the stepper, above the grid.
- Errors: `role="alert"`, persist until dismissed, with a close button.
- Success: `role="status"`, auto-dismiss after 5s.
- All messages come from `copy.ts`. Also pass errors through `humanizeSystemText`: Supabase and edge function messages can be technical. Show the humanized version, and log the raw message with `console.error`.

### 6.5 Source panel (`panels/SourcePanel.tsx`)

**Replaces:** lines 1278–1354.

Header: `FileText` icon, "Product source", badge `Parsed` (green) when all sources have `parse_status = 'parsed'`, otherwise `Parsing…` (warning). Actions: "Edit product input" (`Pencil`), "Replace source" (`Upload`, keeps the existing link to `/sales-os/products?add=1`).

Body: one **file card** per source.

- Icon tile, then name (`file_name`, or "Typed product brief" for `source_type = 'free_text'`), then a one-line subtitle ("Product details were read from this file").
- "Preview" button toggles a `MarkdownPreview` of `content.slice(0, 4000)` (fixes B10). If content was truncated, add a muted "Showing the first part of this file" line.
- Remove: "Product information is stored and available to the workflow." and "Parsed fields are editable through the product input workflow."

"Edit product input" toggles the existing textarea and "Save product input" button. The handler `saveProductInput` is unchanged. **Initialize `inputDraft` when the user clicks Edit, not in `load()` (fixes B13).**

Locked/empty state (no input): icon, "Add product information to get started", buttons "Upload a file" and "Type a brief".

### 6.6 Sales profile panel (`panels/ProfilePanel.tsx`, `ProfileEditForm.tsx`)

**Replaces:** lines 1380–1722, including the profile history panel.

Header: `Package` icon, "Sales profile". Badges: status (`Approved` / `Needs your review`) and `Version N`. Actions: "History" (`History` icon, opens a popover listing versions with Current/Past and status; data from `profileHistory`) and "Edit profile".

Body, top section:

- `profile.category` as the lead line (17px, 600).
- `profile.description` clamped to 2 lines with "Read more / Show less".
- Motion badge using `motionLabel(profile.outreach_motion)`.
- `outreach_motion_reason` goes in a "Why this motion?" disclosure. If `isFallbackText(reason)`, show it only under "Technical details" instead.

Body, card grid (2 columns, 1 under 760px). Each card has an icon header:

| Card | Field | Display |
|---|---|---|
| Problems solved | `problems_solved` | `ChipList` or list per `listDisplay`, first 3 then "+N more" |
| Use cases | `primary_use_cases` | same |
| What slows buyers down | `readableItems(purchase_friction)` | bullet list, first 4 then "+N more" |
| Alternatives | `competitive_alternatives` | same as problems |
| Conversion goal (full width) | `conversion_event` | horizontal flow from `conversionFlow()`: 3 steps joined by arrows, plus a green "Bonus goal" tile if present. Unknown keys go in a plain `<dl>` below it, sentence-cased (fixes B5). |
| Backed by N sources (full width) | `source_evidence` | `SourceList`, each with a doc icon, a title (`sourceType` humanized) and a subtitle (url host or snippet, truncated to 80 chars). Replaces "3 source records · provenance required". |

Empty fields: **hide the card entirely** rather than printing "Unknown".

Review actions (when `review_status = 'needs_review'`): a footer row with "Approve profile" (primary) and "Request changes" (secondary). Handlers unchanged (`reviewProfile`).

Edit form (`ProfileEditForm.tsx`): move the existing form (lines ~1420–1620) as-is, with these improvements. None of them change the payload shape sent to `editProductProfile`.

- Initialize `profileDraft` from `profile` when the user clicks "Edit profile", not in `load()` (fixes B13).
- Replace the "(comma-separated)" textareas with a small tag input: Enter adds a chip, × removes one. Serialize to the same `string[]`.
- The three JSON fields (pricing, conversion event, collateral strategy): keep them, but put them under an "Advanced" disclosure and validate with `JSON.parse` on blur. Show "This must be valid JSON" inline instead of throwing on save.
- Labels in sentence case: "Pricing and business model", "Conversion goal".

Locked state (no profile yet): "Your sales profile is being built from the source file" with a spinner if a `profile_review` job is running; otherwise "Add product information first" with a button to go to Source.

### 6.7 Audiences panel (`panels/AudiencesPanel.tsx`, `IcpCard.tsx`, `AudienceCard.tsx`, `AudienceEditForm.tsx`, `B2BTargets.tsx`)

**Replaces:** lines 1724–2560. This is the largest panel and has the most parity risk.

**Fix B11/B12 first:** the panel owns both ICPs and audiences. Group audiences under their ICP using `groupAudiencesByIcp`. Audiences whose ICP isn't in `icps` go under an "Other audiences" group rather than an orphan "Audiences for ICP" heading.

**Bulk review bar:** keep the existing selection model (`selectedIcpIds`, `selectedAudienceIds`, `approveSelectedStrategy`). Show a sticky bar at the top of the panel when anything is selected: "3 selected", "Approve selected". Remove the "Select for approval" label text and use a checkbox with `aria-label="Select {name}"`.

**ICP card** (collapsed by default when approved, expanded when proposed):

- Title: `icp.name`. Badges: `Primary`/`Additional`, status, and an `EvidenceMeter` (existing component in `designSystem.tsx`) for `evidence_score`.
- `summary` as body text.
- A small 2×2 fact grid with icons: Core problem, Why it fits, Purchase trigger, Buying readiness (combines `budget_fit` and `purchase_readiness`).
- "Commercial validation" and `ai_fit_assessment` go in a "Why this ICP?" disclosure.
- Replace the ASCII tree (`└── Audience · 1/1 approved`) at ~line 1790 with three inline stat pills: "1/1 audiences approved", "1 channel approved", "1 copy item".
- Actions: Edit ICP; if proposed, Approve and Reject. The edit form moves unchanged to `IcpEditForm.tsx`, with the JSON field under "Advanced".

**Audience card:**

| Old (line) | New |
|---|---|
| Name + "Reachable audience v1 · ICP v1 · individual · b2c · priority medium" (~2060) | Title `audience.name`. Pills: `motionLabel`, buyer type ("Individuals"/"Organizations"), "Priority: Medium". Versions move to Technical details. |
| Status pill | Status badge; add a warning badge "Auto-generated, review suggested" when `isFallbackAudience` |
| `problem_use_case_fit` paragraph | Keep, as body text |
| "Triggers: ... · Terminology: ..." (2076) | "What makes them ready to buy" with `ChipList` (first 4). Terminology becomes its own chip list **only if non-empty** (no more "Terminology: None"). |
| "Evidence Score: high" + "AI Fit Assessment is qualitative and separate." (2082) | Metric tile "Evidence strength" with `EvidenceMeter`. Drop the sentence. The AI assessment moves to "Why this audience?". |
| "Evidence score detail" `<pre>` JSON (2086) | Removed from the default view; the raw JSON goes in Technical details (fixes B6) |
| `ai_fit_assessment` paragraph | Into "Why this audience?". Hide it if `isFallbackText`. |
| "Outreach strategy: ... Collateral: signup_focused_social_content" | "Suggested content: {collateralLabel}" as a single muted line. The reason goes in "Why this audience?" unless it's fallback text, in which case it goes in Technical details (fixes B7, B9). |
| `supporting_evidence` list + "Why this audience?" details (~2105–2185) | One "Why this audience?" disclosure. Top line is `evidenceSummaryText(...)`, then `SourceList` from `evidenceRecords` (max 5, "Show all" link), then the AI assessment. |
| "Operational quality: Needs Enrichment ... Enrichment has not run yet." (~2190) | Metric tile "Enrichment": `Not run yet` (clock), `Ready`, `12 of 20 ready`, or `Stale` using `quality_state` and the rollup. The last-refreshed date is a `title` tooltip. |
| "Intent score: awaiting signal evidence. No score was invented..." (2220) | Metric tile "Buying intent": `Pending signals` (clock) when there's no score, else "72%" with a "Why this score?" disclosure containing `explanation` and the signal timeline. The raw `score_explanation` JSON goes in Technical details. Show "Adjusted by you" if `override_score` is set. |
| B2B targets panel (2260–2440) | Move as-is into `B2BTargets.tsx`, rendered only for `buyer_type = 'organization'`. Restyle rows as compact cards (name, title at company, email link, status pills). The identity-candidate callout becomes a warning-toned box titled "Possible duplicates" with Merge/Keep separate buttons (labels only change; handlers unchanged). Text: "Check these before contacting anyone." |
| Edit audience context / Approve / Reject | Actions in the card header: "Edit audience" (secondary), and when proposed, "Approve" and "Reject" |
| Audience edit form | Move unchanged to `AudienceEditForm.tsx`. Triggers and terminology use the tag input. |

The metric tiles row is 3 columns (1 column under 760px), in the order Evidence strength, Buying intent, Enrichment.

"Technical details" disclosure (last element of each audience card) contains: audience version, ICP version, `outreach_motion_reason` if it was fallback text, `ai_fit_assessment` if fallback, `collateral_strategy.primaryType` raw, and `evidence_score_detail` as formatted JSON in a `<pre>` with `--surface-50` background. This preserves every data point for power users.

**Rediscovery dialog** (`components/RediscoveryDialog.tsx`, replaces lines 1129–1170): render as a real modal (backdrop, `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape closes, focus the first button on open, return focus to "Save audience" on close). Copy:

> **Rediscover this audience?**
> We'll save your edits as a new version. Rediscovery researches the new definition, updates its channels, and sends it back for your approval.
> [Save and rediscover] [Save changes only] [Cancel]

Locked state: "Approve the sales profile to generate audiences" with a button to the Profile step. Working state: "Finding audiences for this product…" with a spinner.

### 6.8 Outreach panel (`panels/OutreachPanel.tsx`)

**Replaces:** lines 2562–2672.

One **channel card** per decision (non-rejected by default):

- Icon tile per `channelLabel` (4.1 mapping), then channel name (17px, 650), then status badge.
- Subtitle: `collateralLabel(decision.collateral_type)`.
- Pill: "For: {audience name}".
- Goal line: `decision.objective`, prefixed "Goal:" as a muted label.
- "Why {channel}?" disclosure: `decision.rationale` (moved to Technical details if `isFallbackText`), then `evidenceSummaryText` and `SourceList` for `outreach_decision` evidence records. If there are none: "No sources are linked to this recommendation yet."
- Technical details: decision version, ICP version, audience version, motion code, collateral code.
- When proposed: "Approve channel" and "Reject". Handlers unchanged (`reviewDecision`).

Remove "Recommended channel: reddit · Approved · v1" and "Channels determined from the approved ICP and audience".

Locked state: "Approve an audience to get channel recommendations."

### 6.9 Copy panel (`panels/CopyPanel.tsx`, `CopyCard.tsx`)

**Replaces:** lines 2673–2790.

With **one** copy item, show it full width. With **several**, group them by audience (keep the `copyByAudience` grouping) and show a compact list: each row has a channel icon, copy type, status badge, and recipient if present. Expand the first `awaiting_approval` item by default.

Copy card:

- Header: "Community post" / "Email" / "Social post" / "Outreach message" (from `copy_type`, via `copy.ts`). Badges: status, channel. Action: "Edit text".
- **Recipient-specific copy** (`contact_id` set): a pill "To: {full_name}, {title} at {account}". Show the email only in Technical details.
- **Preview**, styled per channel:
  - `community_post` / `social_post`: the post layout from the mockup (vote column, meta line "Preview in {channel}", optional title from `subject`, body via `MarkdownPreview(cleanDraft(content))`).
  - `email`: mail layout. "Subject: {subject}" line, then the body.
  - `outreach_message`: a plain message bubble.
  - Content shown = `copyEdits[id] ?? final_content ?? draft_content`.
- **Call to action** callout (ember left border) from `copy.cta`. Omit it if empty. Don't show "CTA pending".
- **Follow-up**: `formatFollowUp(copy.follow_up_strategy)`. Omit it when null (fixes B4).
- `message_angle` goes in a "Why this angle?" disclosure.
- "Based on outreach decision v1" goes in Technical details.

**Edit text:** swaps the preview for the textarea (reuses `copyEdits`). While edited, the primary button reads "Approve edited copy" and calls `edit_approve`. Add "Discard edits".

**Review actions** (only when `awaiting_approval`):

- "Approve copy" (primary). Calls `reviewCopy(id, copyReviewAction(id))`, which is unchanged.
- "Request changes" (secondary). Reveals a "What should change?" textarea and a "Send request" button, disabled until non-empty. **Extend `reviewCopy`** to accept notes and pass `reviewNotes` to `reviewEngagement` (supported today; see 2.3).

**Post-action banners.** These are different from the mockup, which promised behavior the backend doesn't have:

- Approved: green banner "Approved and ready to post." **No Undo button.**
- Rejected: warning banner "Draft rejected. Your notes were saved." **Not** "A revised draft will appear here", because no regeneration is triggered (see open question Q1).

Keep "Open in Engage" (renamed from "Open copy review") as a single link in the panel header, since Engage is where posting happens.

Locked state: "Approve a channel in Outreach to generate copy." Working state: "Drafting copy…" with a spinner.

### 6.10 Shared primitives (`components/primitives.tsx`)

Port these from the mockup, adding types and swapping tokens:

- `Badge({ tone: 'approved' | 'review' | 'warn' | 'neutral', icon?, children })`
- `ChipList({ items, max = 3 })`, with an "+N more / Show less" toggle carrying `aria-expanded`
- `Disclosure({ label, defaultOpen?, children })`, with a `useId()`-based `aria-controls`
- `InfoCard({ icon, title, wide?, children })`
- `PanelHeader({ icon, title, meta?, actions? })`. The title is an `<h2 tabIndex={-1}>` for focus management.
- `SourceList({ items })`
- `TechnicalDetails({ rows: Array<[label, ReactNode]> })`, a `Disclosure` labeled "Technical details" with a `<dl>`

Reuse `EvidenceMeter` from `designSystem.tsx` rather than the mockup's `ConfidenceMeter`. Update its CSS to the 3-bar look (bars of 8/12/16px height) if design signs off.

---

## 7. Copy dictionary (`copy.ts`)

Every user-facing string on this page should come from `copy.ts`. The table below lists the replacements. Items marked **remove** have no replacement.

| Current string | New string |
|---|---|
| "Product workflow" (eyebrow) | **remove** |
| "Turn product source material into reviewed audiences, outreach decisions, and ready-to-use copy." | "Turn your product details into audiences, outreach channels, and ready-to-use copy." |
| "Current step" / "Needs attention" / `error` pill | Replaced by the Next-up card |
| "Review the failed step and retry or update the input." | "{Step} didn't finish. {humanized reason} Try again or update the input." |
| "Each audience is a versioned child of its ICP..." | **remove** |
| "1 · Source" / "Product input and parsing" | "Product source" |
| "1 source record · Product information available" | Step summary "1 file" |
| "Input controls" | **remove** |
| "Product information is stored and available to the workflow." | **remove** |
| "Sales_One_Pager.md · parsed" | File card + `Parsed` badge |
| "Parsed fields are editable through the product input workflow." | **remove** |
| "Traceability · view source relationships" | "How this was built" (rail) |
| "source to profile" / "source → profile →" | Icon chain "Source → Profile v1" |
| "2 · Sales profile" / "Product Sales Profile · v1" | "Sales profile" + `Version 1` badge |
| "Approved and available for ICP generation" | `Approved` badge |
| "Profile details" | **remove** |
| "Default outreach motion: b2c · ..." | Motion badge + "Why this motion?" |
| "Purchase friction" | "What slows buyers down" |
| `PRIMARYEVENT` / `SECONDARYEVENT` / `OUTCOME` / `TRIGGER` | Conversion flow tiles; bonus tile "Bonus goal" |
| "3 source records · provenance required" | "Backed by 3 sources" |
| "Product Sales Profile version history" | "History" button |
| "Audiences for {ICP}" / "Versioned ICP → Audience relationship" | ICP card heading; **remove** subtitle |
| "Reachable audience v1 · ICP v1 · individual · b2c · priority medium" | Pills + Technical details |
| "Triggers:" | "What makes them ready to buy" |
| "Terminology: None" | Hidden when empty |
| "Evidence Score: high" | "Evidence strength" tile |
| "AI Fit Assessment is qualitative and separate." | **remove** |
| "Evidence score detail" + JSON | Technical details |
| "Fallback ICP; human review is required before discovery." | `Auto-generated, review suggested` badge; raw text in Technical details |
| "Deterministic fallback derived from ..." | Same as above |
| "Collateral: signup_focused_social_content" | "Suggested content: Social content, sign-up focused" |
| "Supported · confidence medium" + "3 persisted evidence items support this recommendation. Review the linked source before treating qualitative claims as verified." | "Backed by 3 sources, medium confidence. Check them before treating claims as fact." |
| "Operational quality: Needs Enrichment" / "Enrichment has not run yet." | "Enrichment: Not run yet" |
| "Intent score: awaiting signal evidence. No score was invented while this audience has no scored observations." | "Buying intent: Pending signals" |
| "Edit audience context" | "Edit audience" |
| "4 · Outreach" / "Outreach decisions" | "Outreach channel(s)" |
| "1 channel decision · approve before copy is generated" | Step summary |
| "Decision details" / "Channels determined from the approved ICP and audience" | **remove** |
| "Recommended channel: reddit · Approved · v1" | Channel card: "Reddit" + `Approved` |
| "Why this channel: Deterministic fallback route derived from the approved b2c ICP motion. · Goal: ..." | "Goal: ..." + "Why Reddit?" (fallback text → Technical details) |
| "The rationale is not verified until source evidence is attached." | "No sources are linked to this recommendation yet." |
| "Approve outreach" | "Approve channel" |
| "5 · Copy" / "Generated copy" | "{Copy type}" header |
| "1 copy item available for review" | Step summary "1 draft to review" |
| "Copy review" / "Open copy review" | "Open in Engage" link |
| "Copy by approved channel" | **remove** |
| "community post · reddit · Needs your approval · ..." | Header + badges |
| "Based on outreach decision v1" | Technical details |
| "Audience-level copy" | **remove** (show the recipient pill only when there is one) |
| "CTA: ..." | "Call to action" callout |
| "CTA pending" | **remove** |
| "Follow-up: [object Object]" | `formatFollowUp` or hidden |
| "Copy approved for review." (success toast) | "Copy approved." |
| "Outreach decision approved; copy drafting queued." | "Channel approved. Drafting copy now." |
| "Audience approved and downstream work queued." | "Audience approved. Finding channels now." |
| "Product input saved. Review the next generated revision when ready." | "Saved. We'll rebuild the sales profile from your new input." |
| "Every current stage is approved and up to date." | "Everything is approved" (Next-up done state) |

Tone rules for anything not listed: sentence case, active voice, no "persisted", "deterministic", "provider", "record", "ICP v", or raw enum values in default views. The phrase "ICP" is acceptable as a section noun (users know it), but not in metadata strings.

---

## 8. Data hook and actions

### 8.1 `useProductWorkflowData(productId)`

- Move `load()` here unchanged except for the added columns (4.3). Return `{ data, error, reload }`.
- **Polling:** keep 5s, but pause when `document.visibilityState === 'hidden'` and resume on `visibilitychange`. Skip a tick if the previous `load()` hasn't resolved (a `useRef<boolean>` in-flight guard); today, overlapping requests can resolve out of order.
- **Don't set edit drafts here** (fixes B13).
- Consider (not required for this project) replacing the 16-query fan-out with a single RPC, and polling only `sales_os_jobs` while a job is active. Leave a `TODO` with a link to a ticket.

### 8.2 `useProductWorkflowActions({ productId, reload })`

- Move every handler (`reviewIcp`, `reviewAudience`, `approveSelectedStrategy`, `persistAudienceEdit`, `saveIcpEdit`, `saveProfileEdit`, `reviewProfile`, `reviewDecision`, `reviewCopy`, `saveProductInput`, `retryEnrichment`, `reviewIdentityCandidate`) here without changing its service calls.
- Centralize the repeated try/catch/busy-key pattern in a helper:

```ts
async function run(key: string, fn: () => Promise<void>, success: string) {
  setBusyKey(key);
  try {
    await fn();
    await reload();
    toast.success(success);
  } catch (err) {
    console.error(err);
    toast.error(humanizeSystemText(err instanceof Error ? err.message : ''));
  } finally {
    setBusyKey(null);
  }
}
```

- Change `reviewCopy` to `reviewCopy(copyId, action, notes?: string)` and forward `reviewNotes: notes`.
- After a successful mutation that changes the step (e.g. approving the profile), **do not** auto-advance the active step. The Next-up card will point to the new work; auto-jumping disorients people.

---

## 9. Feature parity checklist (release gate)

Every row must be verified in QA before the old component is deleted.

| Capability | Old location | New location | ✔ |
|---|---|---|---|
| Back to Products | header | header | ☐ |
| Edit product input (free text) + save | Source | Source → Edit product input | ☐ |
| Add or replace source (link) | Source | Source → Replace source | ☐ |
| View source content | Source `<details>` | Source → Preview (markdown) | ☐ |
| Lineage / traceability rows | Traceability panel | Rail → How this was built | ☐ |
| View profile (all displayed fields) | Profile | Profile cards | ☐ |
| Edit profile (all 14 fields, incl. JSON fields) | Profile | ProfileEditForm | ☐ |
| Approve / reject profile | Profile | Profile footer | ☐ |
| Profile version history | History panel | History popover | ☐ |
| ICP details (all 12 displayed fields) | Section 3 | ICP card + disclosures | ☐ |
| Edit ICP (all 10 fields) | Section 3 | IcpEditForm | ☐ |
| Approve / reject ICP | Section 3 | ICP card | ☐ |
| Bulk select + approve ICPs and audiences | Section 3 | Bulk review bar | ☐ |
| ICP progress (audiences / decisions / copy counts) | ASCII tree | Stat pills | ☐ |
| Audience details, triggers, terminology | Audience card | Audience card | ☐ |
| Evidence score + detail JSON | Audience card | Metric tile + Technical details | ☐ |
| Supporting evidence + evidence records with links | Audience card | Why this audience? | ☐ |
| Quality state, score, last refreshed, rollup counts | Audience card | Enrichment tile | ☐ |
| Intent score, override flag, explanation, JSON, timeline | Audience card | Buying intent tile + disclosure | ☐ |
| B2B targets: opportunities, contacts, emails, statuses | Audience card | B2BTargets | ☐ |
| Retry enrichment | B2B targets | B2BTargets | ☐ |
| Identity candidates: merge / reject | B2B targets | Possible duplicates box | ☐ |
| Edit audience (6 fields) + rediscovery prompt (3 choices) | Audience card | AudienceEditForm + RediscoveryDialog | ☐ |
| Approve / reject audience | Audience card | Audience card | ☐ |
| Outreach decisions: channel, audience, versions, motion, collateral, rationale, objective, evidence | Section 4 | Channel card + disclosures | ☐ |
| Approve / reject decision | Section 4 | Channel card | ☐ |
| Copy grouped by audience | Section 5 | Copy panel | ☐ |
| Copy: type, channel, status, angle, decision version, recipient, subject, CTA, follow-up | Section 5 | Copy card + disclosures | ☐ |
| Edit copy + approve edited (`edit_approve`) | Section 5 | Edit text | ☐ |
| Approve / reject copy | Section 5 | Copy card (now with notes) | ☐ |
| Link to Engage | Section 5 | Open in Engage | ☐ |
| Error and success messages | mid-page | Toasts | ☐ |
| Live updates while jobs run | 5s poll | 5s poll (visibility-aware) | ☐ |

---

## 10. Accessibility and responsive requirements

- All interactive elements are `<button>` or `<a>`, never clickable `<div>`s.
- Visible focus ring on everything: `outline: 2px solid var(--ember); outline-offset: 2px`.
- Every disclosure uses `aria-expanded` and `aria-controls`.
- Status is never communicated by color alone. Badges always include text; stepper marks have screen-reader text.
- Icons are `aria-hidden="true"`. Icon-only buttons (toast close, chip remove) have `aria-label`.
- `prefers-reduced-motion: reduce` disables transitions.
- Text contrast of at least 4.5:1. Check `--ink-muted` on `--surface-50` (it should pass; verify).
- Breakpoints:
  - **> 960px:** two columns (panel + 300px rail).
  - **761–960px:** one column, rail above the panel, stepper full width.
  - **≤ 760px:** stepper scrolls horizontally; card grids and metric tiles go to one column; panel actions wrap under the title.
- Test at 375px wide: nothing may scroll the page body horizontally.

---

## 11. Testing plan

### 11.1 Unit tests (`presenters.test.ts`, Vitest node env)

Minimum cases:

- `currentWorkflowFailures`
  - An old failure followed by a newer success of the same `job_type` → `[]`
  - A newest failure → returns it
  - A failed `find` / `learning_analysis` job → ignored
- `deriveSteps`
  - One case per status per step from the table in 5.2 (about 20 cases)
  - The user's exact scenario: profile approved, audience approved, decision approved, 1 copy `awaiting_approval`, an old failed `audience_discovery` followed by a completed one → copy step is `review`, every other step is `approved`, and **no step is `attention`**
- `defaultActiveStep`: attention wins over review; review wins over approved; all approved → `copy`
- `deriveNextUp`: one case per tone
- `humanizeKey`: `primaryEvent`, `signup_focused_social_content`, `PRIMARYEVENT` edge case
- `formatFollowUp`: `null`, the `human_review_required` default, a cadence with steps
- `isFallbackAudience`, `isFallbackText`
- `conversionFlow`: all 4 keys, missing keys, unknown keys
- `listDisplay`: short vs long items
- `cleanDraft`: strips the label line; leaves normal content untouched; handles no leading label

### 11.2 Existing tests

Run the full suite; nothing outside this page should change. In particular, `workflowState.test.ts`, `workflowProgress.test.ts`, `explanations.test.ts`, and `lineage.test.ts` must pass untouched.

```bash
npm run typecheck && npm run lint && npm run format && npm run test
```

### 11.3 Visual regression (optional but recommended)

`playwright` and `pixelmatch` are already in `devDependencies`. Add a script that logs in with the seed user, opens a seeded product, and screenshots each step at 1280px and 375px. Commit baselines after design sign-off.

### 11.4 Manual QA scenarios

Seed or find products in each of these states and walk the whole page:

1. Brand new product, no input
2. Profile needs review
3. Profile approved, strategy generating
4. ICPs and audiences proposed (test bulk approve)
5. B2B product with opportunities and identity candidates
6. Outreach decisions proposed
7. Copy awaiting approval: approve plain, approve edited, request changes with notes
8. Everything approved
9. A product with an old failed job and a later success (**must not** show attention)
10. A product whose latest `engagement_batch` job failed (**must** show attention on Copy with a readable reason)
11. A fallback audience (auto-generated badge visible, no fallback prose in the default view)
12. Multiple copy items across 2 audiences, including one recipient-specific email

For each: check that no raw enum, JSON, snake_case, or `[object Object]` appears outside a Technical details disclosure.

---

## 12. Rollout plan (suggested PR sequence)

Each PR should be independently shippable and reviewable.

| PR | Scope | Visible change |
|---|---|---|
| **1. Correctness fixes** | B1 (scoped failures), B3 (copy step completion), B4 (follow-up type + format), B5 (humanizeKey), B13 (stop clobbering drafts), B14 (move messages to top). Add `presenters.ts` with just these functions + tests. | Small, and immediately fixes the "error while all green" report |
| **2. Extract data + actions** | Move types, `load()`, and handlers into `productWorkflow/`. The old JSX stays and consumes the hooks. | None |
| **3. Foundations** | Add `lucide-react`, `react-markdown`, `productWorkflow.css`, tokens, primitives, `copy.ts` | None |
| **4. Shell** | New page shell, Stepper, NextUpRail, Toasts, `?step=` routing. Panels temporarily render the old section JSX inside the new shell. | Layout changes; content the same |
| **5. Source panel** | 6.5 | |
| **6. Profile panel** | 6.6 | |
| **7. Audiences panel** | 6.7 (largest; consider splitting ICP and audience cards into two PRs) | |
| **8. Outreach panel** | 6.8 | |
| **9. Copy panel** | 6.9, including `reviewNotes` | |
| **10. Cleanup** | Delete the old JSX and dead CSS (B15, 4.5); run the parity checklist; visual baselines | |

Put PRs 4–9 behind a flag if you want to ship incrementally: `const useNewWorkflowPage = import.meta.env.DEV || localStorage.getItem('pw-new') === '1'`. Note that `vite.config.ts` only whitelists two env vars for the client, so don't add a new `SALES_OS_*` var for this; use localStorage or a settings row.

---

## 13. Open questions for product and design

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Should "Request changes" on copy trigger a regenerated draft that uses the notes? This needs a backend change: enqueue an `engagement_batch` job with the notes as input. | Ship without regeneration; banner says "Draft rejected. Your notes were saved." |
| Q2 | Profile list items are often long sentences. Should we change the profile generation prompt (`src/ai/promptCatalog.ts`) to also return short labels (≤ 6 words) for chips? | Use `listDisplay` to fall back to bullet lists for long items |
| Q3 | Fallback audiences are named "{category} users with the core problem" by `workerAnalysis.ts`. Should the fallback generate a better name, e.g. from the first problem? This is a one-line backend change. | Leave as-is; the badge flags it for review |
| Q4 | Should the copy preview mimic real platform styling (Reddit, LinkedIn), or use one neutral "post" style? | One neutral post style, channel named in the meta line |
| Q5 | Should rejected items be permanently hidden or shown under "Show rejected"? | Show rejected, collapsed |
| Q6 | Is the 3-bar `EvidenceMeter` restyle approved for use app-wide (it's shared with other pages)? | Restyle only inside `.pw-` scope |

---

## 14. Definition of done

- [ ] All 10 PRs merged; the old 2,797-line component is deleted
- [ ] Parity checklist (section 9) fully checked in QA
- [ ] No raw enums, JSON, snake_case, "fallback"/"deterministic"/"persisted" prose, or `[object Object]` visible outside Technical details in any of the 12 QA scenarios
- [ ] The "error while all green" scenario (QA 9) shows no attention state
- [ ] `npm run typecheck && npm run lint && npm run format && npm run test` pass
- [ ] Keyboard-only walkthrough of every step succeeds
- [ ] 375px walkthrough: no horizontal page scroll
- [ ] Design sign-off on screenshots at 1280px and 375px
