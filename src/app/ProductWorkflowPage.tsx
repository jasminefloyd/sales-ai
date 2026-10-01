import { useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  FileText,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Pencil,
  PenLine,
  Target,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { retryAudienceEnrichment } from '../services/enrichment/enrichmentService';
import { reviewIdentity } from '../services/identity/reviewService';
import { reviewAudienceOrRoute } from '../services/audience/reviewService';
import { requestFind } from '../services/discovery/runFindService';
import { controlJob } from '../services/jobs/jobControlService';
import { suggestAudience } from '../services/audience/suggestionService';
import { runSalesOsWorker } from '../services/jobs/workerService';
import {
  editProductProfile,
  reviewProductProfile,
} from '../services/product/profileReviewService';
import { reviewEngagement } from '../services/engagement/reviewService';
import { partitionAudiencesByIcp } from '../services/audience/hierarchy';
import {
  reviewOutreachDecision,
  type OutreachDecisionReviewAction,
} from '../services/outreach/reviewService';
import { summarizeEvidence } from '../services/evidence/explanations';
import { displayStatus } from './status';
import { MarkdownPreview } from './productWorkflow/MarkdownPreview';
import { Disclosure } from './productWorkflow/Disclosure';
import { NextUpRail } from './productWorkflow/NextUpRail';
import { Stepper } from './productWorkflow/Stepper';
import { AudienceContacts } from './productWorkflow/AudienceContacts';
import type { WorkflowStepId } from './productWorkflow/types';
import {
  collateralLabel,
  formatFollowUp,
  channelLabel,
  humanizeKey,
  isFallbackAudience,
  isFallbackText,
  deriveWorkflowSteps,
  deriveNextUp,
  splitDecisionsByVersion,
  shorten,
  pickVariant,
  splitDraftVariants,
  textFor,
  chipsFor,
  isNearDuplicate,
  isPlaceholder,
} from './productWorkflow/presenters';
import type { DisplayLabels } from './productWorkflow/types';
import { COPY } from './productWorkflow/copy';
import {
  presentAudience,
  presentProfile,
  presentSource,
} from './productWorkflow/viewModels';

// Evidence contract label: "Why this recommendation?"; the visible UI uses contextual disclosures.

type Audience = {
  id: string;
  icp_id: string | null;
  icp_version: number;
  audience_version: number;
  audience_summary: string | null;
  name: string;
  buyer_type: string;
  problem_use_case_fit: string;
  purchase_triggers: string[];
  relevant_terminology: string[];
  supporting_evidence: Array<{
    url?: string;
    snippet?: string;
    sourceType?: string;
    type?: string;
    source?: string;
    relevance?: string;
  }>;
  evidence_score: string;
  evidence_score_detail: Record<string, unknown>;
  ai_fit_assessment: string;
  priority: string;
  outreach_motion: string | null;
  outreach_motion_reason: string | null;
  collateral_strategy: Record<string, unknown>;
  status: string;
  quality_state: string;
  quality_score: number | null;
  quality_last_calculated_at: string | null;
  buying_behavior: Record<string, unknown>;
  display_labels?: DisplayLabels;
};
type AudienceRoute = {
  id: string;
  audience_id: string;
  route_type: string;
  status: string;
  rationale: string | null;
};
type Icp = {
  id: string;
  name: string;
  version: number;
  buyer_type: string;
  summary: string;
  core_problem: string;
  why_product_fits: string;
  purchase_trigger: string;
  evidence_score: string;
  ai_fit_assessment: string;
  budget_fit: string;
  purchase_readiness: string;
  commercial_evidence: unknown[];
  validation_status: string;
  validation_rationale: string;
  priority: string;
  status: string;
  is_primary: boolean;
  display_labels?: DisplayLabels;
};
type OutreachDecision = {
  id: string;
  audience_id: string;
  channel: string;
  outreach_motion: string;
  objective: string;
  rationale: string;
  icp_id: string;
  icp_version: number;
  audience_version: number;
  collateral_type: string;
  status: string;
  version: number;
  display_labels?: DisplayLabels;
};
type GeneratedCopy = {
  id: string;
  outreach_decision_id: string | null;
  opportunity_id: string | null;
  contact_id: string | null;
  audience_id: string | null;
  channel: string;
  copy_type: string;
  subject: string | null;
  message_angle: string | null;
  cta: string | null;
  follow_up_strategy: {
    cadence?: string;
    steps?: Array<string | { delayDays?: number; action?: string; note?: string }>;
  } | null;
  draft_content: string;
  final_content: string | null;
  status: string;
  created_at: string;
};
type Account = {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  enrichment_status: string;
  last_enriched_at: string | null;
  enrichment_error: string | null;
};
type Contact = {
  id: string;
  account_id: string | null;
  full_name: string;
  title: string | null;
  professional_email: string | null;
  email_verification_status: string;
  professional_profile_url: string | null;
  enrichment_status: string;
  last_enriched_at: string | null;
  enrichment_error: string | null;
};
type Opportunity = {
  id: string;
  audience_id: string;
  account_id: string | null;
  contact_id: string | null;
  title: string;
  summary: string;
  status: string;
  evidence_score: string;
};
type WorkflowJob = {
  id: string;
  job_type: string;
  workflow_stage: string | null;
  status: string;
  error: Record<string, unknown> | null;
  created_at: string;
  input?: {audienceId?: string};
};
type IdentityCandidate = {
  id: string;
  member_id: string;
  candidate_contact_id: string | null;
  candidate_account_id: string | null;
  confidence: number;
  match_type: string;
  status: string;
  match_basis: Record<string, unknown>;
};
type QualityRollup = {
  audience_id: string;
  member_count: number;
  ready_count: number;
  stale_count: number;
  missing_data_count: number;
  readiness_state: string;
  calculated_at: string;
};
type IntentScore = {
  id: string;
  audience_id: string;
  member_id: string;
  signal_id: string | null;
  score: number;
  confidence: number;
  signal_type: string;
  explanation: string;
  score_explanation: Record<string, unknown>;
  override_score: number | null;
  override_reason: string | null;
  scored_at: string;
};
type EvidenceRecord = {
  id: string;
  subject_type: string;
  subject_id: string;
  source_type: string;
  source_url: string | null;
  source_reference: string | null;
  source_snippet: string | null;
  evidence_status: string;
  confidence: string;
  explanation: string;
};
type LineageRow = {
  id: string;
  relation_type: string;
  source_id: string | null;
  profile_id: string | null;
  icp_id: string | null;
  audience_id: string | null;
  outreach_decision_id: string | null;
  engagement_id: string | null;
};
type ProductSource = {
  id: string;
  source_type: string;
  file_name: string | null;
  parse_status: string;
  content: string;
  parsed_fields: Record<string, unknown>;
};
type Profile = {
  category: string;
  description: string;
  problems_solved: string[];
  core_capabilities: string[];
  primary_use_cases: string[];
  pricing_business_model: Record<string, unknown>;
  conversion_event: Record<string, unknown>;
  purchase_friction: string;
  competitive_alternatives: string[];
  source_evidence: Array<{ url?: string; snippet?: string; sourceType?: string }>;
  purchase_triggers: string[];
  positioning_value_props: string[];
  outreach_motion: string | null;
  outreach_motion_reason: string | null;
  collateral_strategy: Record<string, unknown>;
  version: number;
  review_status: string;
  is_active: boolean;
  display_labels?: DisplayLabels;
};

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readableItems(value: unknown): string[] {
  const parsed = parseStructuredValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) =>
      readableText(item),
    );
  }
  if (typeof parsed === 'string' && parsed.trim()) return [parsed];
  return [];
}

function readableText(value: unknown): string {
  const parsed = parseStructuredValue(value);
  if (Array.isArray(parsed)) return parsed.map(readableText).filter(Boolean).join(' · ');
  if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key,item])=>`${readableLabel(key)}: ${readableText(item)}`).join(' · ');
  return parsed == null ? '' : String(parsed);
}

function readableObject(value: unknown): Array<[string, string]> {
  const parsed = parseStructuredValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed).map(([key, item]) => [
    key,
    readableText(item),
  ]);
}

function readableLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ProductWorkflowPage() {
  const { productId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStep = searchParams.get('step');
  const [product, setProduct] = useState<{
    name: string;
    status: string;
    website_url: string | null;
    description_input: string | null;
  } | null>(null);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceRoutes, setAudienceRoutes] = useState<AudienceRoute[]>([]);
  const [icps, setIcps] = useState<Icp[]>([]);
  const [decisions, setDecisions] = useState<OutreachDecision[]>([]);
  const [generatedCopy, setGeneratedCopy] = useState<GeneratedCopy[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [sources, setSources] = useState<ProductSource[]>([]);
  const [lineage, setLineage] = useState<LineageRow[]>([]);
  const [workflowJobs, setWorkflowJobs] = useState<WorkflowJob[]>([]);
  const [copyEdits, setCopyEdits] = useState<Record<string, string>>({});
  const [copyReviewNotes, setCopyReviewNotes] = useState<Record<string, string>>({});
  const [editingCopyIds, setEditingCopyIds] = useState<Set<string>>(new Set());
  const loadInFlight = useRef(false);
  const warnedMissingIcpIds = useRef(new Set<string>());
  const [editingInput, setEditingInput] = useState(false);
  const [inputDraft, setInputDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [productNotFound, setProductNotFound] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [audienceSuggestion, setAudienceSuggestion] = useState('');
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileHistory, setProfileHistory] = useState<Profile[]>([]);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    category: '',
    description: '',
    problemsSolved: '',
    coreCapabilities: '',
    primaryUseCases: '',
    pricingBusinessModel: '{}',
    conversionEvent: '{}',
    purchaseFriction: '',
    competitiveAlternatives: '',
    outreachMotion: '',
    outreachMotionReason: '',
    collateralStrategy: '{}',
    triggers: '',
    props: '',
  });
  const [editingAudienceId, setEditingAudienceId] = useState<string | null>(null);
  const [editingIcpId, setEditingIcpId] = useState<string | null>(null);
  const [icpEdit, setIcpEdit] = useState({
    name: '',
    summary: '',
    coreProblem: '',
    whyProductFits: '',
    purchaseTrigger: '',
    priority: 'medium',
    budgetFit: '',
    purchaseReadiness: '',
    validationRationale: '',
    commercialEvidence: '[]',
  });
  const [audienceEdit, setAudienceEdit] = useState({
    name: '',
    problem: '',
    triggers: '',
    terminology: '',
    priority: 'medium',
    outreachMotion: 'b2c',
  });
  const [reviewBusyKey, setReviewBusyKey] = useState<string | null>(null);
  const [enrichmentBusyAudienceId, setEnrichmentBusyAudienceId] = useState<
    string | null
  >(null);
  const [identityCandidates, setIdentityCandidates] = useState<IdentityCandidate[]>([]);
  const [identityBusyId, setIdentityBusyId] = useState<string | null>(null);
  const [qualityRollups, setQualityRollups] = useState<QualityRollup[]>([]);
  const [intentScores, setIntentScores] = useState<IntentScore[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceRecord[]>([]);
  const [selectedIcpIds, setSelectedIcpIds] = useState<string[]>([]);
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<string[]>([]);
  const [pendingAudienceSave, setPendingAudienceSave] = useState<{
    audienceId: string;
    updates: Record<string, unknown>;
  } | null>(null);
  const [openStages, setOpenStages] = useState<Record<string, boolean>>(() => ({
    source: requestedStep ? requestedStep === 'source' : true,
    profile: requestedStep === 'profile',
    audiences: requestedStep === 'audiences',
    outreach: requestedStep === 'outreach',
    copy: requestedStep === 'copy',
  }));
  const toggleStage = (stageId: string) => {
    const shouldOpen = !openStages[stageId];
    setOpenStages({
      source: false,
      profile: false,
      audiences: false,
      outreach: false,
      copy: false,
      [stageId]: shouldOpen,
    });
    if (shouldOpen) setSearchParams({ step: stageId }, { replace: true });
  };
  const goToStage = (stageId: string) => {
    setOpenStages({
      source: false,
      profile: false,
      audiences: false,
      outreach: false,
      copy: false,
      [stageId]: true,
    });
    setSearchParams({ step: stageId }, { replace: true });
    window.requestAnimationFrame(() => {
      document.getElementById(stageId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };
  const { grouped: audiencesByIcp } = partitionAudiencesByIcp(
    audiences,
    icps.map((icp) => icp.id),
  );
  const copyByAudience = generatedCopy.reduce<Record<string, GeneratedCopy[]>>(
    (groups, copy) => {
      (groups[copy.audience_id ?? 'unassigned'] ??= []).push(copy);
      return groups;
    },
    {},
  );
  const draftVariantsForCopy = (copy: GeneratedCopy) =>
    pickVariant(
      splitDraftVariants(copy.final_content ?? copy.draft_content),
      copy.channel,
      copy.copy_type,
    );
  const mainDraftForCopy = (copy: GeneratedCopy) => {
    const variant = draftVariantsForCopy(copy).main.body;
    return variant || copy.final_content || copy.draft_content;
  };
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const opportunitiesForAudience = (audienceId: string) =>
    opportunities.filter((opportunity) => opportunity.audience_id === audienceId);
  const icpProgress = icps.map((icp) => {
    const linkedAudiences = audiences.filter((audience) => audience.icp_id === icp.id);
    const linkedAudienceIds = new Set(linkedAudiences.map((audience) => audience.id));
    const linkedDecisions = decisions.filter((decision) => decision.icp_id === icp.id);
    const linkedDecisionIds = new Set(linkedDecisions.map((decision) => decision.id));
    const linkedCopy = generatedCopy.filter(
      (copy) =>
        (copy.audience_id && linkedAudienceIds.has(copy.audience_id)) ||
        (copy.outreach_decision_id && linkedDecisionIds.has(copy.outreach_decision_id)),
    );
    return {
      icp,
      audiences: linkedAudiences,
      approvedAudiences: linkedAudiences.filter((audience) =>
        ['approved', 'active'].includes(audience.status),
      ).length,
      approvedDecisions: linkedDecisions.filter(
        (decision) => decision.status === 'approved',
      ).length,
      copyCount: linkedCopy.length,
    };
  });

  async function loadData() {
    if (!productId) return;
    setProductNotFound(false);
    const [
      productResult,
      icpResult,
      audienceResult,
      routeResult,
      profileResult,
      decisionResult,
      copyResult,
      accountResult,
      contactResult,
      opportunityResult,
      sourceResult,
      lineageResult,
      jobsResult,
      identityCandidateResult,
      qualityRollupResult,
      intentScoreResult,
      evidenceResult,
    ] = await Promise.all([
      supabaseBrowserClient
        .from('sales_os_products')
        .select('name, status, website_url, description_input')
        .eq('tenant_id', 'sales_os')
        .eq('id', productId)
        .single(),
      supabaseBrowserClient
        .from('sales_os_icps')
        .select(
          'id, name, version, buyer_type, summary, core_problem, why_product_fits, purchase_trigger, evidence_score, ai_fit_assessment, budget_fit, purchase_readiness, commercial_evidence, validation_status, validation_rationale, priority, status, is_primary, display_labels',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('is_primary', { ascending: false })
        .order('version', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_audiences')
        .select(
          'id, icp_id, icp_version, audience_version, audience_summary, name, buyer_type, problem_use_case_fit, purchase_triggers, relevant_terminology, supporting_evidence, evidence_score, evidence_score_detail, ai_fit_assessment, priority, status, outreach_motion, outreach_motion_reason, collateral_strategy, buying_behavior, quality_state, quality_score, quality_last_calculated_at, display_labels',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at'),
      supabaseBrowserClient
        .from('sales_os_audience_routes')
        .select('id, audience_id, route_type, status, rationale')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at'),
      supabaseBrowserClient
        .from('sales_os_product_profiles')
        .select(
          'category, description, problems_solved, core_capabilities, primary_use_cases, pricing_business_model, conversion_event, purchase_friction, competitive_alternatives, source_evidence, purchase_triggers, positioning_value_props, outreach_motion, outreach_motion_reason, collateral_strategy, version, review_status, is_active, display_labels',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('version', { ascending: false })
        .limit(20),
      supabaseBrowserClient
        .from('sales_os_outreach_decisions')
        .select(
          'id, audience_id, icp_id, icp_version, audience_version, channel, outreach_motion, objective, rationale, collateral_type, status, version, display_labels',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at'),
      supabaseBrowserClient
        .from('sales_os_engagements')
        .select(
          'id, outreach_decision_id, opportunity_id, contact_id, audience_id, channel, copy_type, subject, message_angle, cta, follow_up_strategy, draft_content, final_content, status, created_at',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_accounts')
        .select(
          'id, name, domain, industry, enrichment_status, last_enriched_at, enrichment_error',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('name'),
      supabaseBrowserClient
        .from('sales_os_contacts')
        .select(
          'id, account_id, full_name, title, professional_email, email_verification_status, professional_profile_url, enrichment_status, last_enriched_at, enrichment_error',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('full_name'),
      supabaseBrowserClient
        .from('sales_os_opportunities')
        .select(
          'id, audience_id, account_id, contact_id, title, summary, status, evidence_score',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('discovered_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_product_sources')
        .select('id, source_type, file_name, parse_status, content, parsed_fields')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_workflow_lineage')
        .select(
          'id, relation_type, source_id, profile_id, icp_id, audience_id, outreach_decision_id, engagement_id',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at'),
      supabaseBrowserClient
        .from('sales_os_jobs')
        .select('id, job_type, workflow_stage, status, error, created_at, input')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId),
      supabaseBrowserClient
        .from('sales_os_identity_candidates')
        .select(
          'id, member_id, candidate_contact_id, candidate_account_id, confidence, match_type, status, match_basis',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .eq('status', 'pending')
        .order('confidence', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_audience_quality_rollups')
        .select(
          'audience_id, member_count, ready_count, stale_count, missing_data_count, readiness_state, calculated_at',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId),
      supabaseBrowserClient
        .from('sales_os_intent_scores')
        .select(
          'id,audience_id,member_id,signal_id,score,confidence,signal_type,explanation,score_explanation,override_score,override_reason,scored_at',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('scored_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_evidence_records')
        .select(
          'id,subject_type,subject_id,source_type,source_url,source_reference,source_snippet,evidence_status,confidence,explanation',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at', { ascending: false }),
    ]);
    let loadedIcpRows = (icpResult.data ?? []) as Icp[];
    const missingIcpIds = [
      ...new Set(
        (audienceResult.data ?? [])
          .map((audience) => audience.icp_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ].filter((id) => !loadedIcpRows.some((icp) => icp.id === id));
    if (!icpResult.error && missingIcpIds.length > 0) {
      const recoveredIcpResult = await supabaseBrowserClient
        .from('sales_os_icps')
        .select(
          'id, name, version, buyer_type, summary, core_problem, why_product_fits, purchase_trigger, evidence_score, ai_fit_assessment, budget_fit, purchase_readiness, commercial_evidence, validation_status, validation_rationale, priority, status, is_primary, display_labels',
        )
        .eq('tenant_id', 'sales_os')
        .in('id', missingIcpIds);
      if (!recoveredIcpResult.error) {
        loadedIcpRows = [
          ...loadedIcpRows,
          ...((recoveredIcpResult.data ?? []) as Icp[]),
        ];
      }
    }
    const stillMissingIcpIds = missingIcpIds.filter(
      (id) => !loadedIcpRows.some((icp) => icp.id === id),
    );
    for (const id of stillMissingIcpIds) {
      if (!warnedMissingIcpIds.current.has(id)) {
        console.warn(`ICP ${id} referenced by an audience could not be loaded.`);
        warnedMissingIcpIds.current.add(id);
      }
    }
    const firstError =
      productResult.error ??
      icpResult.error ??
      audienceResult.error ??
      routeResult.error ??
      profileResult.error ??
      decisionResult.error ??
      copyResult.error ??
      accountResult.error ??
      contactResult.error ??
      opportunityResult.error ??
      sourceResult.error ??
      lineageResult.error ??
      jobsResult.error ??
      identityCandidateResult.error ??
      qualityRollupResult.error ??
      intentScoreResult.error ??
      evidenceResult.error;
    if (productResult.error?.code === 'PGRST116') {
      setProduct(null);
      setProductNotFound(true);
      setError(null);
    } else if (firstError) setError(firstError.message);
    else {
      setProduct(productResult.data);
      if (!editingInput) setInputDraft(productResult.data?.description_input ?? '');
      setIcps(loadedIcpRows);
      setAudiences((audienceResult.data ?? []) as Audience[]);
      setAudienceRoutes((routeResult.data ?? []) as AudienceRoute[]);
      setDecisions((decisionResult.data ?? []) as OutreachDecision[]);
      setGeneratedCopy((copyResult.data ?? []) as GeneratedCopy[]);
      setAccounts((accountResult.data ?? []) as Account[]);
      setContacts((contactResult.data ?? []) as Contact[]);
      setOpportunities((opportunityResult.data ?? []) as Opportunity[]);
      setSources((sourceResult.data ?? []) as ProductSource[]);
      setLineage((lineageResult.data ?? []) as LineageRow[]);
      setWorkflowJobs((jobsResult.data ?? []) as WorkflowJob[]);
      setIdentityCandidates(
        (identityCandidateResult.data ?? []) as IdentityCandidate[],
      );
      setQualityRollups((qualityRollupResult.data ?? []) as QualityRollup[]);
      setIntentScores((intentScoreResult.data ?? []) as IntentScore[]);
      setEvidenceRecords((evidenceResult.data ?? []) as EvidenceRecord[]);
      const profileRows = (profileResult.data ?? []) as Profile[];
      setProfileHistory(profileRows);
      setProfile(profileRows[0] ?? null);
      if (profileRows[0]) {
        const current = profileRows[0];
        if (!profileEditing)
          setProfileDraft({
            category: current.category,
            description: current.description,
            problemsSolved: current.problems_solved.join(', '),
            coreCapabilities: current.core_capabilities.join(', '),
            primaryUseCases: current.primary_use_cases.join(', '),
            pricingBusinessModel: JSON.stringify(
              current.pricing_business_model,
              null,
              2,
            ),
            conversionEvent: JSON.stringify(current.conversion_event, null, 2),
            purchaseFriction: current.purchase_friction,
            competitiveAlternatives: current.competitive_alternatives.join(', '),
            outreachMotion: current.outreach_motion ?? '',
            outreachMotionReason: current.outreach_motion_reason ?? '',
            collateralStrategy: JSON.stringify(
              current.collateral_strategy ?? {},
              null,
              2,
            ),
            triggers: current.purchase_triggers.join(', '),
            props: current.positioning_value_props.join(', '),
          });
      }
    }
  }

  async function load() {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      await loadData();
    } finally {
      loadInFlight.current = false;
    }
  }

  async function retryEnrichment(audienceId: string) {
    if (!productId) return;
    setError(null);
    setEnrichmentBusyAudienceId(audienceId);
    try {
      await retryAudienceEnrichment(supabaseBrowserClient, {
        productId,
        audienceId,
        actor: 'user',
      });
      await runSalesOsWorker();
      setReviewSuccess('Audience enrichment queued for retry.');
      await load();
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : 'Enrichment retry failed.',
      );
    } finally {
      setEnrichmentBusyAudienceId(null);
    }
  }

  async function reviewIdentityCandidate(
    candidateId: string,
    action: 'approve' | 'reject',
  ) {
    setIdentityBusyId(candidateId);
    setError(null);
    try {
      await reviewIdentity({ action, candidateId });
      await load();
      setReviewSuccess(
        action === 'approve' ? 'Identity match approved.' : 'Identity match rejected.',
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Identity review failed.',
      );
    } finally {
      setIdentityBusyId(null);
    }
  }

  useEffect(() => {
    void load();
    let timer: number | undefined;
    const startPolling = () => {
      if (document.visibilityState === 'hidden' || timer !== undefined) return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 5_000);
    };
    const stopPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopPolling();
      else {
        void load();
        startPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  function startAudienceEdit(audience: Audience) {
    setEditingAudienceId(audience.id);
    setAudienceEdit({
      name: audience.name,
      problem: audience.problem_use_case_fit,
      triggers: audience.purchase_triggers.join(', '),
      terminology: audience.relevant_terminology.join(', '),
      priority: audience.priority,
      outreachMotion: audience.outreach_motion ?? 'b2c',
    });
  }

  function startIcpEdit(icp: Icp) {
    setEditingIcpId(icp.id);
    setIcpEdit({
      name: icp.name,
      summary: icp.summary,
      coreProblem: icp.core_problem,
      whyProductFits: icp.why_product_fits,
      purchaseTrigger: icp.purchase_trigger,
      priority: icp.priority,
      budgetFit: icp.budget_fit || 'Pending human review',
      purchaseReadiness: icp.purchase_readiness || 'Pending human review',
      validationRationale: icp.validation_rationale,
      commercialEvidence: JSON.stringify(icp.commercial_evidence, null, 2),
    });
  }

  async function saveIcpEdit() {
    if (!editingIcpId) return;
    try {
      await reviewAudienceOrRoute({
        entityType: 'icp',
        entityId: editingIcpId,
        action: 'edit',
        updates: {
          name: icpEdit.name,
          summary: icpEdit.summary,
          core_problem: icpEdit.coreProblem,
          why_product_fits: icpEdit.whyProductFits,
          purchase_trigger: icpEdit.purchaseTrigger,
          budget_fit: icpEdit.budgetFit,
          purchase_readiness: icpEdit.purchaseReadiness,
          validation_rationale: icpEdit.validationRationale,
          commercial_evidence: JSON.parse(icpEdit.commercialEvidence || '[]'),
          priority: icpEdit.priority,
        },
      });
      setEditingIcpId(null);
      await load();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'ICP edit failed.');
    }
  }

  async function saveAudienceEdit() {
    if (!editingAudienceId) return;
    const updates = {
      name: audienceEdit.name,
      problem_use_case_fit: audienceEdit.problem,
      purchase_triggers: audienceEdit.triggers
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      relevant_terminology: audienceEdit.terminology
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      priority: audienceEdit.priority,
      outreach_motion: audienceEdit.outreachMotion,
    };
    setPendingAudienceSave({ audienceId: editingAudienceId, updates });
  }

  async function persistAudienceEdit(rediscover: boolean) {
    if (!pendingAudienceSave) return;
    setError(null);
    setReviewBusyKey(`audience-edit:${pendingAudienceSave.audienceId}`);
    try {
      await reviewAudienceOrRoute({
        entityType: 'audience',
        entityId: pendingAudienceSave.audienceId,
        action: 'edit',
        updates: pendingAudienceSave.updates,
        rediscover,
      });
      if (rediscover) await runSalesOsWorker();
      setEditingAudienceId(null);
      setPendingAudienceSave(null);
      await load();
      setReviewSuccess(
        rediscover
          ? 'Audience changes saved. Targeted audience rediscovery is running.'
          : 'Audience changes saved for review.',
      );
    } catch (editError) {
      setError(
        editError instanceof Error ? editError.message : 'Audience edit failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function reviewIcp(icpId: string, action: 'approve' | 'reject') {
    setError(null);
    setReviewBusyKey(`icp:${icpId}:${action}`);
    try {
      await reviewAudienceOrRoute({ entityType: 'icp', entityId: icpId, action });
      setSelectedIcpIds((current) => current.filter((id) => id !== icpId));
      await load();
      setReviewSuccess(action === 'approve' ? 'ICP approved.' : 'ICP rejected.');
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'ICP review failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function reviewAudience(audienceId: string, action: 'approve' | 'reject') {
    setError(null);
    setReviewBusyKey(`audience:${audienceId}:${action}`);
    try {
      await reviewAudienceOrRoute({
        entityType: 'audience',
        entityId: audienceId,
        action,
      });
      setSelectedAudienceIds((current) => current.filter((id) => id !== audienceId));
      await load();
      setReviewSuccess(
        action === 'approve'
          ? 'Audience approved and downstream work queued.'
          : 'Audience rejected.',
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Audience review failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function submitAudienceSuggestion() {
    if (!productId || !audienceSuggestion.trim()) return;
    setError(null);
    setReviewSuccess(null);
    setSuggestionBusy(true);
    try {
      await suggestAudience({ productId, suggestion: audienceSuggestion.trim() });
      setAudienceSuggestion('');
      await load();
      setReviewSuccess(
        'Audience suggestion added for review. The new ICP and audience appear below.',
      );
    } catch (suggestionError) {
      setError(
        suggestionError instanceof Error
          ? suggestionError.message
          : 'Audience suggestion failed.',
      );
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function runDirectDiscovery(routeId: string) {
    if (!productId) return;
    setError(null);
    setReviewBusyKey(`direct-discovery:${routeId}`);
    try {
      const audience = audiences.find((item) =>
        audienceRoutes.some(
          (route) => route.id === routeId && route.audience_id === item.id,
        ),
      );
      if (!audience) throw new Error('The selected audience could not be loaded.');
      const parentIcp = icps.find((icp) => icp.id === audience.icp_id);
      if (!parentIcp || !['approved', 'active'].includes(parentIcp.status)) {
        throw new Error('Approve the parent ICP before discovering contacts.');
      }
      const failedJob = workflowJobs.find(
        (job) =>
          job.job_type === 'find' &&
          job.input?.audienceId === audience.id &&
          job.status === 'failed',
      );
      if (failedJob) {
        await controlJob({ action: 'retry', jobId: failedJob.id });
      } else {
        await requestFind({
          productId,
          audienceId: audience.id,
          routeId,
        });
      }
      await load();
      setReviewSuccess(
        failedJob ? 'Direct discovery retry started.' : 'Direct discovery started.',
      );
    } catch (discoveryError) {
      setError(
        discoveryError instanceof Error
          ? discoveryError.message
          : 'Direct discovery could not be queued.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function approveSelectedStrategy() {
    const icpIds = selectedIcpIds.filter(
      (id) => icps.find((icp) => icp.id === id)?.status === 'proposed',
    );
    const audienceIds = selectedAudienceIds.filter(
      (id) => audiences.find((audience) => audience.id === id)?.status === 'proposed',
    );
    if (icpIds.length === 0 && audienceIds.length === 0) return;
    setError(null);
    setReviewBusyKey('bulk-strategy-approval');
    try {
      // Approve parents first so every selected audience has an approved ICP.
      for (const icpId of icpIds) {
        await reviewAudienceOrRoute({
          entityType: 'icp',
          entityId: icpId,
          action: 'approve',
        });
      }
      for (const audienceId of audienceIds) {
        await reviewAudienceOrRoute({
          entityType: 'audience',
          entityId: audienceId,
          action: 'approve',
          runWorker: false,
        });
      }
      if (audienceIds.length > 0) await runSalesOsWorker();
      setSelectedIcpIds([]);
      setSelectedAudienceIds([]);
      await load();
      setReviewSuccess(
        `Approved ${icpIds.length} ICP${icpIds.length === 1 ? '' : 's'} and ${audienceIds.length} audience${audienceIds.length === 1 ? '' : 's'}.`,
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Bulk strategy approval failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  function toggleSelection(
    id: string,
    selected: string[],
    setSelected: (next: string[]) => void,
  ) {
    setSelected(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  }

  async function saveProfileEdit() {
    if (!productId) return;
    try {
      await editProductProfile({
        productId,
        updates: {
          category: profileDraft.category,
          description: profileDraft.description,
          problems_solved: profileDraft.problemsSolved
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          core_capabilities: profileDraft.coreCapabilities
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          primary_use_cases: profileDraft.primaryUseCases
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          pricing_business_model: JSON.parse(profileDraft.pricingBusinessModel || '{}'),
          conversion_event: JSON.parse(profileDraft.conversionEvent || '{}'),
          purchase_friction: profileDraft.purchaseFriction,
          competitive_alternatives: profileDraft.competitiveAlternatives
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          outreach_motion: profileDraft.outreachMotion || null,
          outreach_motion_reason: profileDraft.outreachMotionReason,
          collateral_strategy: JSON.parse(profileDraft.collateralStrategy || '{}'),
          purchase_triggers: profileDraft.triggers
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          positioning_value_props: profileDraft.props
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setProfileEditing(false);
      await load();
    } catch (profileError) {
      setError(
        profileError instanceof Error ? profileError.message : 'Profile edit failed.',
      );
    }
  }

  async function reviewProfile(action: 'approve' | 'reject') {
    if (!productId) return;
    setError(null);
    setReviewBusyKey(`profile:${action}`);
    try {
      await reviewProductProfile({ productId, action });
      await load();
      setReviewSuccess(
        action === 'approve'
          ? 'Product Sales Profile approved.'
          : 'Product Sales Profile rejected.',
      );
    } catch (profileError) {
      setError(
        profileError instanceof Error ? profileError.message : 'Profile review failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function reviewDecision(
    decisionId: string,
    action: OutreachDecisionReviewAction,
  ) {
    setError(null);
    setReviewBusyKey(`decision:${decisionId}:${action}`);
    try {
      await reviewOutreachDecision({ decisionId, action });
      await load();
      setReviewSuccess(
        action === 'approve'
          ? 'Outreach decision approved; copy drafting queued.'
          : 'Outreach decision updated.',
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Outreach decision review failed.',
      );
    } finally {
      setReviewBusyKey(null);
    }
  }

  async function reviewCopy(
    copyId: string,
    action: 'approve' | 'edit_approve' | 'reject',
  ) {
    setError(null);
    setReviewBusyKey(`copy:${copyId}:${action}`);
    try {
      await reviewEngagement({
        engagementId: copyId,
        action,
        finalContent: action === 'edit_approve' ? copyEdits[copyId] : undefined,
        reviewNotes: action === 'reject' ? copyReviewNotes[copyId] : undefined,
      });
      await load();
      setReviewSuccess(
        action === 'reject' ? 'Copy rejected.' : 'Copy approved for review.',
      );
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copy review failed.');
    } finally {
      setReviewBusyKey(null);
    }
  }

  function copyReviewAction(copyId: string): 'approve' | 'edit_approve' {
    return copyEdits[copyId] === undefined ? 'approve' : 'edit_approve';
  }

  async function saveProductInput() {
    if (!productId) return;
    setError(null);
    try {
      const { data: userData, error: userError } =
        await supabaseBrowserClient.auth.getUser();
      if (userError || !userData.user)
        throw userError ?? new Error('Authentication required.');
      const { error: updateError } = await supabaseBrowserClient
        .from('sales_os_products')
        .update({ description_input: inputDraft, updated_by: userData.user.id })
        .eq('tenant_id', 'sales_os')
        .eq('id', productId);
      if (updateError) throw updateError;
      const { error: sourceError } = await supabaseBrowserClient
        .from('sales_os_product_sources')
        .insert({
          tenant_id: 'sales_os',
          product_id: productId,
          source_type: 'free_text',
          content: inputDraft,
          parse_status: 'parsed',
          parsed_fields: { descriptionInput: inputDraft },
          created_by: userData.user.id,
          updated_by: userData.user.id,
        });
      if (sourceError) throw sourceError;
      setEditingInput(false);
      setReviewSuccess(
        'Product input saved. Review the next generated revision when ready.',
      );
      await load();
    } catch (inputError) {
      setError(
        inputError instanceof Error ? inputError.message : 'Product input save failed.',
      );
    }
  }

  const profileApproved = profile?.review_status === 'approved';
  const decisionVersions = splitDecisionsByVersion(decisions, audiences);
  const currentDecisions = decisionVersions.current;
  const earlierDecisions = decisionVersions.earlier;
  const activeStep = (
    requestedStep &&
    ['source', 'profile', 'audiences', 'outreach', 'copy'].includes(requestedStep)
      ? requestedStep
      : 'source'
  ) as WorkflowStepId;
  const workflowStepViews = deriveWorkflowSteps({
    hasInput: Boolean(
      product?.website_url || product?.description_input || sources.length,
    ),
    hasProfile: Boolean(profile),
    profileStatus: profile?.review_status ?? null,
    hasProposedAudience:
      audiences.some((audience) => audience.status === 'proposed') ||
      icps.some((icp) => icp.status === 'proposed'),
    hasApprovedAudience: audiences.some((audience) =>
      ['approved', 'active'].includes(audience.status),
    ),
    hasProposedDecision: currentDecisions.some(
      (decision) => decision.status === 'proposed',
    ),
    hasApprovedDecision: currentDecisions.some(
      (decision) => decision.status === 'approved',
    ),
    copyCount: generatedCopy.length,
    awaitingCopyCount: generatedCopy.filter(
      (copy) => copy.status === 'awaiting_approval',
    ).length,
    approvedCopyCount: generatedCopy.filter((copy) => copy.status === 'approved')
      .length,
    sourceCount: sources.length,
    profileVersion: profile?.version ?? null,
    audienceReviewCount: audiences.filter((audience) => audience.status === 'proposed')
      .length,
    approvedAudienceCount: audiences.filter((audience) =>
      ['approved', 'active'].includes(audience.status),
    ).length,
    decisionReviewCount: currentDecisions.filter(
      (decision) => decision.status === 'proposed',
    ).length,
    approvedDecisionCount: currentDecisions.filter(
      (decision) => decision.status === 'approved',
    ).length,
    jobs: workflowJobs,
  });
  const workflowSteps = workflowStepViews.map((step) => ({
    ...step,
    complete: step.status === 'approved',
  }));
  const nextUp = deriveNextUp(workflowStepViews, workflowJobs);
  const profileView = profile ? presentProfile(profile) : null;
  if (productNotFound) {
    return (
      <section className="page-section product-workflow-page">
        <Link className="back-link" to="/sales-os/products">
          ← Products
        </Link>
        <div className="pw-not-found" role="alert">
          <span className="pw-panel-icon" aria-hidden="true">
            <Package size={22} />
          </span>
          <div>
            <p className="eyebrow">Product workflow</p>
            <h2>Product not found</h2>
            <p>
              This product is not available in the current Sales OS workspace. Return
              to Products and select an existing product, or create a new one.
            </p>
            <Link className="button" to="/sales-os/products">
              Back to Products
            </Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="page-section product-workflow-page">
      <Link className="back-link" to="/sales-os/products">
        ← Products
      </Link>
      <h2>{product?.name ?? 'Product'}</h2>
      <p className="product-workflow-intro">{COPY.page.intro}</p>
      {(error || reviewSuccess) && (
        <div className="pw-feedback" role={error ? 'alert' : 'status'}>
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <p className="success">{reviewSuccess}</p>
          )}
        </div>
      )}
      {pendingAudienceSave && (
        <div className="audience-rediscovery-prompt" role="dialog" aria-modal="true">
          <div>
            <p className="eyebrow">Audience changed</p>
            <h3>Do you want to rediscover this audience?</h3>
            <p className="muted">
              Your edits will be saved as a new audience version. Rediscovery will
              research the edited definition, recalculate its reachability and channel
              strategy, and return it for human approval.
            </p>
          </div>
          <div className="button-row">
            <button
              disabled={
                reviewBusyKey === `audience-edit:${pendingAudienceSave.audienceId}`
              }
              onClick={() => void persistAudienceEdit(true)}
            >
              {reviewBusyKey === `audience-edit:${pendingAudienceSave.audienceId}`
                ? 'Saving…'
                : 'Save and rediscover'}
            </button>
            <button
              className="button-secondary"
              disabled={
                reviewBusyKey === `audience-edit:${pendingAudienceSave.audienceId}`
              }
              onClick={() => void persistAudienceEdit(false)}
            >
              Save changes only
            </button>
            <button
              className="button-quiet"
              disabled={
                reviewBusyKey === `audience-edit:${pendingAudienceSave.audienceId}`
              }
              onClick={() => setPendingAudienceSave(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <Stepper
        steps={workflowSteps}
        activeStep={activeStep}
        onSelect={(stage) => goToStage(stage)}
      />
      <div className="product-workflow-layout">
        <div className="product-workflow-main">
          <div
            id="source"
            className={`panel pw-panel stack source-panel ${openStages.source ? 'workflow-active' : 'workflow-inactive'}`}
          >
            <div className="workflow-stage-header pw-panel-head">
              <span className="pw-panel-icon">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow">1. Source</p>
                <h3 className="pw-panel-title" tabIndex={-1}>
                  Product source
                </h3>
                <span className="status-pill">
                  {sources.length > 0 ? 'Parsed' : 'Needs product information'}
                </span>
              </div>
              <button
                type="button"
                className="button-secondary workflow-stage-toggle"
                aria-expanded={openStages.source}
                aria-controls="source-body"
                onClick={() => toggleStage('source')}
              >
                {openStages.source ? 'Collapse' : 'Expand'}
                <span aria-hidden="true">{openStages.source ? '⌃' : '⌄'}</span>
              </button>
            </div>
            {openStages.source && (
              <div id="source-body" className="workflow-stage-body stack">
                <div className="card-heading">
                  <div className="source-actions" aria-label="Source actions">
                    <button
                      className="button-secondary source-action"
                      title={editingInput ? 'Cancel input edit' : 'Edit product input'}
                      aria-label={
                        editingInput ? 'Cancel input edit' : 'Edit product input'
                      }
                      onClick={() => setEditingInput((value) => !value)}
                    >
                      {editingInput ? (
                        <X size={16} aria-hidden="true" />
                      ) : (
                        <Pencil size={16} aria-hidden="true" />
                      )}
                      <span>{editingInput ? 'Cancel' : 'Edit input'}</span>
                    </button>
                    <Link
                      className="button-secondary source-action"
                      to="/sales-os/products?add=1"
                      title="Add or replace source"
                    >
                      <Upload size={16} aria-hidden="true" />
                      <span>Replace source</span>
                    </Link>
                  </div>
                </div>
                {editingInput && (
                  <>
                    <label>
                      Product brief / free text
                      <textarea
                        rows={8}
                        value={inputDraft}
                        onChange={(event) => setInputDraft(event.target.value)}
                      />
                    </label>
                    <button onClick={() => void saveProductInput()}>
                      Save product input
                    </button>
                  </>
                )}
                {sources.length === 0 ? (
                  <p className="muted">No imported source record.</p>
                ) : (
                  sources.map((source) => {
                    const sourceView = presentSource(source);
                    return (
                      <Disclosure key={source.id} label={sourceView.glance.title}>
                        <p className="muted">
                          Parsed fields are editable through the product input workflow.
                        </p>
                        <MarkdownPreview content={source.content.slice(0, 4000)} />
                      </Disclosure>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div id="lineage" className="panel traceability-panel">
            <Disclosure label="Traceability · view source relationships">
              {lineage.length === 0 ? (
                <p className="muted">
                  Traceability will appear as the workflow produces each artifact.
                </p>
              ) : (
                <div className="stack">
                  {lineage.map((item) => (
                    <div className="route-row" key={item.id}>
                      <strong>{item.relation_type.replaceAll('_', ' ')}</strong>
                      <span className="muted">
                        {item.source_id ? 'source → ' : ''}
                        {item.profile_id ? 'profile → ' : ''}
                        {item.icp_id ? 'ICP → ' : ''}
                        {item.audience_id ? 'audience → ' : ''}
                        {item.outreach_decision_id ? 'outreach decision → ' : ''}
                        {item.engagement_id ? 'copy' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Disclosure>
          </div>
          {profile && (
            <div
              id="profile"
              className={`panel pw-panel stack profile-panel ${openStages.profile ? 'workflow-active' : 'workflow-inactive'}`}
            >
              <div className="workflow-stage-header pw-panel-head">
                <span className="pw-panel-icon">
                  <Package size={20} aria-hidden="true" />
                </span>
                <div>
                  <p className="eyebrow">2. Sales profile</p>
                  <h3 className="pw-panel-title" tabIndex={-1}>
                    Sales profile
                  </h3>
                  <div className="button-row">
                    <span className="status-pill">
                      {profile.review_status === 'approved'
                        ? 'Approved'
                        : 'Needs review'}
                    </span>
                    <span className="status-pill">Version {profile.version}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button-secondary workflow-stage-toggle"
                  aria-expanded={openStages.profile}
                  aria-controls="profile-body"
                  onClick={() => toggleStage('profile')}
                >
                  {openStages.profile ? 'Collapse' : 'Expand'}
                  <span aria-hidden="true">{openStages.profile ? '⌃' : '⌄'}</span>
                </button>
              </div>
              {openStages.profile && (
                <div id="profile-body" className="workflow-stage-body stack">
                  <div className="card-heading">
                    <button
                      className="button-secondary"
                      onClick={() => setProfileEditing((current) => !current)}
                    >
                      {profileEditing ? 'Cancel' : 'Edit profile'}
                    </button>
                  </div>
                  {profileEditing ? (
                    <>
                      <label>
                        Category
                        <input
                          value={profileDraft.category}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              category: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          rows={4}
                          value={profileDraft.description}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              description: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Problems solved (comma-separated)
                        <textarea
                          rows={3}
                          value={profileDraft.problemsSolved}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              problemsSolved: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Core capabilities (comma-separated)
                        <textarea
                          rows={3}
                          value={profileDraft.coreCapabilities}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              coreCapabilities: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Primary use cases (comma-separated)
                        <textarea
                          rows={3}
                          value={profileDraft.primaryUseCases}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              primaryUseCases: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Pricing / business model (JSON)
                        <textarea
                          rows={3}
                          value={profileDraft.pricingBusinessModel}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              pricingBusinessModel: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Conversion event (JSON)
                        <textarea
                          rows={3}
                          value={profileDraft.conversionEvent}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              conversionEvent: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Purchase friction
                        <textarea
                          rows={3}
                          value={profileDraft.purchaseFriction}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              purchaseFriction: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Competitive alternatives (comma-separated)
                        <textarea
                          rows={3}
                          value={profileDraft.competitiveAlternatives}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              competitiveAlternatives: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Recommended outreach motion
                        <select
                          value={profileDraft.outreachMotion}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              outreachMotion: event.target.value,
                            })
                          }
                        >
                          <option value="">Determine from ICP</option>
                          <option value="b2b">B2B</option>
                          <option value="b2c">B2C</option>
                          <option value="b2b2c">B2B2C</option>
                          <option value="community">Community</option>
                        </select>
                      </label>
                      <label>
                        Outreach motion rationale
                        <textarea
                          rows={2}
                          value={profileDraft.outreachMotionReason}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              outreachMotionReason: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Collateral strategy (JSON)
                        <textarea
                          rows={3}
                          value={profileDraft.collateralStrategy}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              collateralStrategy: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Purchase triggers
                        <input
                          value={profileDraft.triggers}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              triggers: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Positioning/value props
                        <textarea
                          rows={3}
                          value={profileDraft.props}
                          onChange={(event) =>
                            setProfileDraft({
                              ...profileDraft,
                              props: event.target.value,
                            })
                          }
                        />
                      </label>
                      <button onClick={() => void saveProfileEdit()}>
                        Save profile revision
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>{profileView?.glance.title}</strong>
                      </p>
                      <p className="muted">{profileView?.glance.subtitle}</p>
                      <p className="muted">
                        <strong>Outreach motion</strong>{' '}
                        {profile.outreach_motion ?? 'Pending ICP determination'}
                      </p>
                      <div className="detail-grid">
                        <div>
                          <strong>Problems solved</strong>
                          <p className="muted">
                            <span className="pw-label-chips">
                              {chipsFor(
                                profile.problems_solved,
                                3,
                                profile.display_labels?.problemsSolved,
                              ).items.map((item) => (
                                <span key={item}>{item}</span>
                              ))}
                            </span>
                          </p>
                        </div>
                        <div>
                          <strong>Primary use cases</strong>
                          <p className="muted">
                            <span className="pw-label-chips">
                              {chipsFor(
                                profile.primary_use_cases,
                                3,
                                profile.display_labels?.primaryUseCases,
                              ).items.map((item) => (
                                <span key={item}>{item}</span>
                              ))}
                            </span>
                          </p>
                        </div>
                        <div>
                          <strong>Purchase friction</strong>
                          {readableItems(profile.purchase_friction).length > 0 ? (
                            <ul className="profile-detail-list profile-chip-list">
                              {chipsFor(
                                readableItems(profile.purchase_friction),
                                3,
                                profile.display_labels?.purchaseFriction,
                              ).items.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">Unknown</p>
                          )}
                        </div>
                        <div>
                          <strong>Alternatives</strong>
                          <p className="muted">
                            <span className="pw-label-chips">
                              {chipsFor(
                                profile.competitive_alternatives,
                                3,
                                profile.display_labels?.competitiveAlternatives,
                              ).items.map((item) => (
                                <span key={item}>{item}</span>
                              ))}
                            </span>
                          </p>
                        </div>
                        <div>
                          <strong>Conversion goal</strong>
                          {readableObject(profile.conversion_event).length > 0 ? (
                            <dl className="profile-detail-list profile-detail-facts">
                              {readableObject(profile.conversion_event).map(
                                ([key, value]) => (
                                  <div key={key}>
                                    <dt>{readableLabel(key)}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          ) : (
                            <p className="muted">Unknown</p>
                          )}
                        </div>
                        <div>
                          <strong>Evidence</strong>
                          <p className="muted">
                            {profile.source_evidence.length} source records
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="button-row">
                    {profile.review_status === 'needs_review' && (
                      <>
                        <button
                          disabled={reviewBusyKey === 'profile:approve'}
                          onClick={() => void reviewProfile('approve')}
                        >
                          {reviewBusyKey === 'profile:approve'
                            ? 'Approving…'
                            : 'Approve Product Sales Profile'}
                        </button>
                        <button
                          className="button-secondary"
                          disabled={reviewBusyKey === 'profile:reject'}
                          onClick={() => void reviewProfile('reject')}
                        >
                          Request changes
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {profileHistory.length > 0 && (
            <div className="panel profile-history-panel">
              <Disclosure label="Product Sales Profile version history">
                <div className="stack">
                  {profileHistory.map((revision) => (
                    <div className="route-row" key={revision.version}>
                      <span>
                        <strong>Profile v{revision.version}</strong> ·{' '}
                        {revision.is_active ? 'Current' : 'Historical'}
                      </span>
                      <span className="muted">
                        {revision.review_status.replaceAll('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </Disclosure>
            </div>
          )}
          {profileApproved && (icps.length > 0 || audiences.length > 0) && (
            <div
              id="audiences"
              className={`panel pw-panel stack audiences-panel ${openStages.audiences ? 'workflow-active' : 'workflow-inactive'}`}
            >
              <div className="workflow-stage-header pw-panel-head">
                <span className="pw-panel-icon">
                  <Target size={20} aria-hidden="true" />
                </span>
                <div>
                  <p className="eyebrow">3. Audiences</p>
                  <h3 className="pw-panel-title" tabIndex={-1}>
                    Audiences
                  </h3>
                  <div className="button-row">
                    <span className="status-pill">
                      {icps.length === 0
                        ? 'ICP review required'
                        : audiences.some((audience) => {
                            const parent = icps.find((icp) => icp.id === audience.icp_id);
                            return !parent || !['approved', 'active'].includes(parent.status);
                          })
                          ? 'ICP review required'
                          : audiences.some((audience) =>
                                ['approved', 'active'].includes(audience.status),
                              )
                            ? 'Approved'
                            : 'Needs review'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button-secondary workflow-stage-toggle"
                  aria-expanded={openStages.audiences}
                  aria-controls="audiences-body"
                  onClick={() => toggleStage('audiences')}
                >
                  {openStages.audiences ? 'Collapse' : 'Expand'}
                  <span aria-hidden="true">{openStages.audiences ? '⌃' : '⌄'}</span>
                </button>
              </div>
              {openStages.audiences ? (
                <div id="audiences-body" className="workflow-stage-body stack">
                  {(selectedIcpIds.length > 0 || selectedAudienceIds.length > 0) && (
                    <div className="bulk-review-bar">
                      <span>
                        {selectedIcpIds.length + selectedAudienceIds.length} selected
                        for review
                      </span>
                      <button
                        disabled={reviewBusyKey === 'bulk-strategy-approval'}
                        onClick={() => void approveSelectedStrategy()}
                      >
                        {reviewBusyKey === 'bulk-strategy-approval'
                          ? 'Approving…'
                          : 'Approve selected ICPs and audiences'}
                      </button>
                    </div>
                  )}
                  {icps.map((icp) => (
                    <div className="panel stack" key={icp.id}>
                      <div className="card-heading">
                        <div>
                          {icp.status === 'proposed' && (
                            <label className="selection-label">
                              <input
                                type="checkbox"
                                checked={selectedIcpIds.includes(icp.id)}
                                onChange={() =>
                                  toggleSelection(icp.id, selectedIcpIds, (next) =>
                                    setSelectedIcpIds(next),
                                  )
                                }
                              />
                              Select for approval
                            </label>
                          )}
                          <h4>{textFor(icp.display_labels?.name, icp.name, 6)}</h4>
                          <span className="muted">
                            {icp.is_primary ? 'Primary ICP' : 'Additional ICP'}
                            <br />
                            {displayStatus(icp.buyer_type)}
                          </span>
                        </div>
                        <span className="status-pill">
                          {icp.evidence_score} evidence
                        </span>
                      </div>
                      <p>{textFor(icp.display_labels?.summary, icp.summary, 15)}</p>
                      <Disclosure label="Why this ICP?">
                        {!isPlaceholder(icp.core_problem) &&
                          !isNearDuplicate(icp.core_problem, icp.summary) && (
                            <p className="muted">
                              <strong>Core problem:</strong> {icp.core_problem}
                            </p>
                          )}
                        {!isPlaceholder(icp.why_product_fits) && (
                          <p className="muted">
                            <strong>Why product fits:</strong> {icp.why_product_fits}
                          </p>
                        )}
                        {!isPlaceholder(icp.purchase_trigger) && (
                          <p className="muted">
                            <strong>Purchase trigger:</strong> {icp.purchase_trigger}
                          </p>
                        )}
                      </Disclosure>
                      <p className="muted">
                        <strong>AI fit assessment:</strong> {icp.ai_fit_assessment}
                      </p>
                      <p className="muted">
                        <strong>Budget fit</strong>{' '}
                        {icp.budget_fit || 'Pending human review'}
                        <br />
                        <strong>Purchase readiness</strong>{' '}
                        {icp.purchase_readiness || 'Pending human review'}
                      </p>
                      <p className="muted">
                        <strong>Commercial validation:</strong>{' '}
                        {displayStatus(icp.validation_status)}
                        <br />
                        {icp.validation_rationale}
                        <br />
                        {icp.commercial_evidence.length > 0
                          ? `${icp.commercial_evidence.length} commercial evidence records`
                          : 'Commercial evidence pending human review'}
                      </p>
                      {(() => {
                        const progress = icpProgress.find(
                          (item) => item.icp.id === icp.id,
                        );
                        const audienceCount = progress?.audiences.length ?? 0;
                        const approvedAudiences = progress?.approvedAudiences ?? 0;
                        const approvedDecisions = progress?.approvedDecisions ?? 0;
                        const copyCount = progress?.copyCount ?? 0;
                        return (
                          <div className="icp-workflow-progress">
                            <strong>
                              {icp.is_primary ? 'Primary ICP' : 'Secondary ICP'}
                            </strong>
                            <span>
                              └── Audience · {approvedAudiences}/{audienceCount}{' '}
                              approved
                            </span>
                            <span>
                              └── Approval · ICP {readableLabel(icp.status)} · Audience{' '}
                              {audienceCount === 0
                                ? 'pending'
                                : approvedAudiences === audienceCount
                                  ? 'approved'
                                  : 'pending'}
                            </span>
                            <span>
                              └── Outreach · {approvedDecisions} approved · {copyCount}{' '}
                              copy item
                              {copyCount === 1 ? '' : 's'}
                            </span>
                          </div>
                        );
                      })()}
                      <div className="button-row">
                        <button
                          className="button-secondary"
                          onClick={() => startIcpEdit(icp)}
                        >
                          Edit ICP
                        </button>
                        {icp.status === 'proposed' && (
                          <>
                            <button
                              disabled={reviewBusyKey === `icp:${icp.id}:approve`}
                              onClick={() => void reviewIcp(icp.id, 'approve')}
                            >
                              {reviewBusyKey === `icp:${icp.id}:approve`
                                ? 'Approving…'
                                : 'Approve ICP'}
                            </button>
                            <button
                              className="button-secondary"
                              disabled={reviewBusyKey === `icp:${icp.id}:reject`}
                              onClick={() => void reviewIcp(icp.id, 'reject')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                      {editingIcpId === icp.id && (
                        <div className="panel stack">
                          <label>
                            Name
                            <input
                              value={icpEdit.name}
                              onChange={(event) =>
                                setIcpEdit({ ...icpEdit, name: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            Summary
                            <textarea
                              rows={2}
                              value={icpEdit.summary}
                              onChange={(event) =>
                                setIcpEdit({ ...icpEdit, summary: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            Core problem
                            <textarea
                              rows={2}
                              value={icpEdit.coreProblem}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  coreProblem: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Why product fits
                            <textarea
                              rows={2}
                              value={icpEdit.whyProductFits}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  whyProductFits: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Purchase trigger
                            <input
                              value={icpEdit.purchaseTrigger}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  purchaseTrigger: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Budget fit
                            <input
                              value={icpEdit.budgetFit}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  budgetFit: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Purchase readiness
                            <input
                              value={icpEdit.purchaseReadiness}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  purchaseReadiness: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Validation rationale
                            <textarea
                              rows={2}
                              value={icpEdit.validationRationale}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  validationRationale: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Commercial evidence (JSON array)
                            <textarea
                              rows={4}
                              value={icpEdit.commercialEvidence}
                              onChange={(event) =>
                                setIcpEdit({
                                  ...icpEdit,
                                  commercialEvidence: event.target.value,
                                })
                              }
                            />
                          </label>
                          <button onClick={() => void saveIcpEdit()}>
                            Save ICP revision
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {openStages.audiences &&
            (!profileApproved ? (
              <div className="empty-state workflow-gated-state">
                Approve the Product Sales Profile to generate and review ICPs,
                audiences, and outreach recommendations.
              </div>
            ) : (
              <>
                <div className="suggest-audience-card">
                  <div>
                    <p className="eyebrow">Have another audience in mind?</p>
                    <h3>Suggest an audience</h3>
                    <p className="muted">
                      Describe the people or organization you think should use this
                      product. Sales OS will evaluate the idea against the approved
                      Product Sales Profile and return it for review.
                    </p>
                  </div>
                  <textarea
                    rows={3}
                    value={audienceSuggestion}
                    onChange={(event) => setAudienceSuggestion(event.target.value)}
                    placeholder="Example: Performing arts schools that could use RunScene AI for classroom rehearsal and student practice."
                    aria-label="Audience suggestion"
                  />
                  <div className="suggest-audience-footer">
                    <span className="muted">
                      Organization ideas will include buyer, influencer, and end-user
                      roles for B2B outreach.
                    </span>
                    <button
                      type="button"
                      disabled={suggestionBusy || !audienceSuggestion.trim()}
                      onClick={() => void submitAudienceSuggestion()}
                    >
                      {suggestionBusy ? 'Evaluating…' : 'Evaluate audience idea'}
                    </button>
                  </div>
                </div>
                {audiences.length === 0 ? (
                  <div className="empty-state">
                    No audiences are available yet. Suggest an audience above or wait
                    for product analysis to complete.
                  </div>
                ) : (
                  Object.entries(audiencesByIcp).flatMap(([icpId, groupedAudiences]) => [
                <div className="card-heading" key={`audience-group-${icpId}`}>
                  <h3>
                    {(() => {
                      if (icpId === 'unassigned') return 'Audience';
                      const parentName = icps.find((icp) => icp.id === icpId)?.name;
                      const firstProblem = groupedAudiences[0]?.problem_use_case_fit;
                      return /(?:\.\.\.|…)$/.test(parentName ?? '') && firstProblem
                        ? firstProblem
                        : (parentName ?? 'Audience — parent ICP unavailable');
                    })()}
                  </h3>
                </div>,
                ...groupedAudiences.map((audience) => {
                  const audienceRollup = qualityRollups.find(
                    (rollup) => rollup.audience_id === audience.id,
                  );
                  const audienceApproved = ['approved', 'active'].includes(
                    audience.status,
                  );
                  const audienceView = presentAudience(audience, {
                    parentIcpSummary: icps.find((icp) => icp.id === audience.icp_id)
                      ?.summary,
                    profileMotion: profile?.outreach_motion,
                  });
                  const directRoute = audienceRoutes.find(
                    (route) =>
                      route.audience_id === audience.id &&
                      route.route_type === 'direct',
                  );
                  const discoveryJob = workflowJobs.find(job=>job.job_type === 'find' && job.input?.audienceId === audience.id);
                  return (
                    <article className="panel audience-card" key={audience.id}>
                      <div className="card-heading">
                        <div>
                          {audience.status === 'proposed' && (
                            <label className="selection-label">
                              <input
                                type="checkbox"
                                checked={selectedAudienceIds.includes(audience.id)}
                                onChange={() =>
                                  toggleSelection(
                                    audience.id,
                                    selectedAudienceIds,
                                    (next) => setSelectedAudienceIds(next),
                                  )
                                }
                              />
                              Select for approval
                            </label>
                          )}
                          <h3>{audienceView.glance.title}</h3>
                          <span className="muted">
                            {audience.buyer_type} audience
                            <br />
                            {audience.outreach_motion ?? 'Motion pending'}
                          </span>
                        </div>
                        <span className="status-pill">
                          {displayStatus(audience.status)}
                        </span>
                        {isFallbackAudience(audience) && (
                          <span className="status-pill warning-pill">
                            Auto-generated
                          </span>
                        )}
                      </div>
                      {audienceView.glance.subtitle && (
                        <p>{audienceView.glance.subtitle}</p>
                      )}
                      <p className="muted">
                        <strong>Ready to buy when:</strong>{' '}
                        <span className="pw-label-chips">
                          {(audienceView.glance.chips?.items ?? []).map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                          {(audienceView.glance.chips?.more ?? 0) > 0 && (
                            <span>+{audienceView.glance.chips?.more} more</span>
                          )}
                        </span>
                      </p>
                      <div className="pw-stats">
                        <div className="pw-stat">
                          <span>Evidence</span>
                          <strong>{audience.evidence_score || 'Pending'}</strong>
                        </div>
                        <div className="pw-stat">
                          <span>Buying intent</span>
                          <strong>{intentScores.find(score=>score.audience_id===audience.id) ? `${Math.round((intentScores.find(score=>score.audience_id===audience.id)?.score ?? 0)*100)}%` : 'Not evaluated'}</strong>
                        </div>
                        <div className="pw-stat">
                          <span>Enrichment</span>
                          <strong>{audienceRollup ? `${audienceRollup.ready_count} of ${audienceRollup.member_count} ready` : 'Not run yet'}</strong>
                        </div>
                      </div>
                      <Disclosure label="Why this audience?">
                        {!isFallbackText(audience.ai_fit_assessment) && (
                          <p className="muted">{audience.ai_fit_assessment}</p>
                        )}
                        <p className="muted">
                          <strong>Outreach strategy:</strong>{' '}
                          {isFallbackText(audience.outreach_motion_reason)
                            ? 'Based on the approved audience fit.'
                            : (audience.outreach_motion_reason ??
                              'Based on the approved ICP.')}{' '}
                          <strong>Collateral:</strong>{' '}
                          {collateralLabel(audience.collateral_strategy?.primaryType)}
                        </p>
                        <div className="evidence-list">
                          {audience.supporting_evidence
                            .slice(0, 5)
                            .map((evidence, evidenceIndex) => (
                              <div
                                key={`${evidence.url ?? evidence.source ?? evidence.snippet ?? evidence.relevance ?? 'evidence'}-${evidenceIndex}`}
                              >
                                <strong>
                                  {evidence.sourceType ?? evidence.type ?? 'Source'}
                                </strong>
                                :{' '}
                                {evidence.snippet ??
                                  evidence.relevance ??
                                  evidence.source}
                                {evidence.url && (
                                  <a
                                    href={evidence.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {' '}
                                    source
                                  </a>
                                )}
                              </div>
                            ))}
                        </div>
                      </Disclosure>
                      {(() => {
                        const audienceEvidence = evidenceRecords.filter(
                          (record) =>
                            record.subject_type === 'audience' &&
                            record.subject_id === audience.id,
                        );
                        const summary = summarizeEvidence(
                          audienceEvidence.map((record) => ({
                            sourceUrl: record.source_url,
                            sourceReference: record.source_reference,
                            snippet: record.source_snippet,
                            sourceType: record.source_type,
                            evidenceStatus: record.evidence_status,
                            confidence: record.confidence,
                          })),
                        );
                        return (
                          <Disclosure label="Evidence details">
                            <p className="muted">
                              <strong>{readableLabel(summary.state)}</strong> ·
                              confidence {summary.confidence}
                            </p>
                            <p className="muted">{summary.explanation}</p>
                            {audienceEvidence.length > 0 && (
                              <div className="evidence-list">
                                {audienceEvidence.slice(0, 5).map((record) => (
                                  <div key={record.id}>
                                    <strong>{readableLabel(record.source_type)}</strong>{' '}
                                    · {readableLabel(record.evidence_status)} ·{' '}
                                    {record.source_snippet ??
                                      record.source_reference ??
                                      record.explanation}
                                    {record.source_url && (
                                      <a
                                        href={record.source_url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {' '}
                                        source
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </Disclosure>
                        );
                      })()}
                      {(() => {
                        const audienceIntentScores = intentScores.filter(
                          (score) => score.audience_id === audience.id,
                        );
                        const topIntent = audienceIntentScores[0];
                        if (!topIntent) {
                          return null;
                        }
                        return (
                          <div className="score-row intent-score-row">
                            <strong>Intent score:</strong>{' '}
                            <span className="status-pill">
                              {Math.round(topIntent.score * 100)}%
                            </span>{' '}
                            <span className="muted">
                              {readableLabel(topIntent.signal_type)} ·{' '}
                              {new Date(topIntent.scored_at).toLocaleDateString()}
                            </span>
                            {topIntent.override_score !== null && (
                              <span className="muted">human override</span>
                            )}
                            <Disclosure label="Why this score?">
                              <p className="muted">{topIntent.explanation}</p>
                              <pre className="detail-json">
                                {JSON.stringify(topIntent.score_explanation, null, 2)}
                              </pre>
                              <strong>Signal timeline</strong>
                              <div className="evidence-list">
                                {audienceIntentScores.slice(0, 5).map((score) => (
                                  <div key={score.id}>
                                    {new Date(score.scored_at).toLocaleString()} ·{' '}
                                    {readableLabel(score.signal_type)} ·{' '}
                                    {Math.round(score.score * 100)}% ·{' '}
                                    {score.explanation}
                                  </div>
                                ))}
                              </div>
                            </Disclosure>
                          </div>
                        );
                      })()}
                      {(audience.buyer_type === 'organization' || ['b2b','b2b2c'].includes(audience.outreach_motion ?? '') || directRoute) && (
                        <div className="b2b-target-panel">
                          <div className="card-heading">
                            <div>
                              <h4>B2B targets</h4>
                              <span className="muted">
                                Named accounts and verified contacts discovered for this
                                audience.
                              </span>
                            </div>
                            <span className="status-pill">
                              {opportunitiesForAudience(audience.id).length} discovered
                            </span>
                            <span className="status-pill">
                              Direct email route:{' '}
                              {directRoute
                                ? displayStatus(directRoute.status)
                                : 'Not configured'}
                            </span>
                            {intentScores.some(
                              (score) => score.audience_id === audience.id,
                            ) && (
                              <span className="status-pill">
                                {Math.round(
                                  (intentScores.find(
                                    (score) => score.audience_id === audience.id,
                                  )?.score ?? 0) * 100,
                                )}
                                % intent
                              </span>
                            )}
                            {audienceApproved ? (
                              <button
                                type="button"
                                className="button secondary small"
                                disabled={
                                  enrichmentBusyAudienceId === audience.id ||
                                  reviewBusyKey === `direct-discovery:${directRoute?.id}` ||
                                  (discoveryJob?.status !== 'failed' && !audienceRollup?.member_count)
                                }
                                onClick={() => {
                                  if (discoveryJob?.status === 'failed' && directRoute)
                                    void runDirectDiscovery(directRoute.id);
                                  else void retryEnrichment(audience.id);
                                }}
                              >
                                {enrichmentBusyAudienceId === audience.id ||
                                reviewBusyKey === `direct-discovery:${directRoute?.id}`
                                  ? 'Queueing…'
                                  : discoveryJob?.status === 'failed' && directRoute
                                    ? 'Retry discovery'
                                    : 'Retry enrichment'}
                              </button>
                            ) : (
                              <span className="muted">
                                Approve the audience to start discovery and enrichment.
                              </span>
                            )}
                          </div>
                          {identityCandidates.length > 0 && (
                            <div className="review-callout">
                              <strong>Possible duplicate identities</strong>
                              <span className="muted">
                                Review before using a contact for outreach.
                                Deterministic matches are linked automatically;
                                uncertain matches stay pending.
                              </span>
                              {identityCandidates.slice(0, 3).map((candidate) => {
                                const possibleContact = candidate.candidate_contact_id
                                  ? contactsById.get(candidate.candidate_contact_id)
                                  : undefined;
                                return (
                                  <div
                                    className="review-callout-row"
                                    key={candidate.id}
                                  >
                                    <span>
                                      {possibleContact?.full_name ??
                                        'Potential duplicate'}{' '}
                                      · {Math.round(candidate.confidence * 100)}% match
                                    </span>
                                    <span>
                                      <button
                                        type="button"
                                        className="button secondary small"
                                        disabled={identityBusyId === candidate.id}
                                        onClick={() =>
                                          void reviewIdentityCandidate(
                                            candidate.id,
                                            'reject',
                                          )
                                        }
                                      >
                                        Reject
                                      </button>{' '}
                                      <button
                                        type="button"
                                        className="button small"
                                        disabled={identityBusyId === candidate.id}
                                        onClick={() =>
                                          void reviewIdentityCandidate(
                                            candidate.id,
                                            'approve',
                                          )
                                        }
                                      >
                                        Merge
                                      </button>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <AudienceContacts productId={productId!} audienceId={audience.id} refreshKey={`${discoveryJob?.id}:${discoveryJob?.status}:${audienceRollup?.calculated_at}`} />
                          {opportunitiesForAudience(audience.id).length === 0 ? (
                            <div className="button-row">
                              <p className="muted">
                                {audience.status === 'proposed'
                                  ? 'Approve this audience to activate direct discovery and enrichment.'
                                  : discoveryJob?.status === 'failed'
                                    ? `Contact discovery failed. ${typeof discoveryJob.error?.message === 'string' ? discoveryJob.error.message : 'Retry discovery or check provider settings.'}`
                                    : discoveryJob?.status === 'running' || discoveryJob?.status === 'queued'
                                      ? 'Contact discovery is in progress.'
                                      : discoveryJob?.status === 'completed'
                                        ? 'Discovery completed without an eligible contact. Review the audience and provider results.'
                                        : 'Find contacts for this approved audience.'}
                              </p>
                              {audienceApproved && directRoute && (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  disabled={
                                    reviewBusyKey ===
                                    `direct-discovery:${directRoute.id}`
                                  }
                                  onClick={() =>
                                    void runDirectDiscovery(directRoute.id)
                                  }
                                >
                                  {reviewBusyKey ===
                                  `direct-discovery:${directRoute.id}`
                                    ? 'Queueing…'
                                    : 'Run direct discovery'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="b2b-target-list">
                              {opportunitiesForAudience(audience.id).map(
                                (opportunity) => {
                                  const account = opportunity.account_id
                                    ? accountsById.get(opportunity.account_id)
                                    : undefined;
                                  const contact = opportunity.contact_id
                                    ? contactsById.get(opportunity.contact_id)
                                    : undefined;
                                  return (
                                    <div className="b2b-target" key={opportunity.id}>
                                      <div>
                                        <strong>
                                          {contact?.full_name ?? opportunity.title}
                                        </strong>
                                        <span className="muted">
                                          {contact?.title ?? 'Relevant contact'}
                                          {account ? ` · ${account.name}` : ''}
                                        </span>
                                      </div>
                                      <div className="b2b-target-meta">
                                        {contact?.professional_email && (
                                          <a
                                            href={`mailto:${contact.professional_email}`}
                                          >
                                            {contact.professional_email}
                                          </a>
                                        )}
                                        {contact?.email_verification_status && (
                                          <span className="status-pill">
                                            Email{' '}
                                            {readableLabel(
                                              contact.email_verification_status,
                                            )}
                                          </span>
                                        )}
                                        {contact && (
                                          <span className="status-pill">
                                            Enrichment{' '}
                                            {readableLabel(contact.enrichment_status)}
                                          </span>
                                        )}
                                        {account &&
                                          account.enrichment_status !== 'succeeded' && (
                                            <span className="muted">
                                              Account enrichment{' '}
                                              {readableLabel(account.enrichment_status)}
                                            </span>
                                          )}
                                        <span className="muted">
                                          {displayStatus(opportunity.status)} ·{' '}
                                          {opportunity.evidence_score} evidence
                                        </span>
                                      </div>
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="button-row">
                        <button
                          className="button-secondary"
                          onClick={() => startAudienceEdit(audience)}
                        >
                          Edit audience context
                        </button>
                        {audience.status === 'proposed' && (
                          <>
                            <button
                              disabled={
                                reviewBusyKey === `audience:${audience.id}:approve`
                              }
                              onClick={() =>
                                void reviewAudience(audience.id, 'approve')
                              }
                            >
                              {reviewBusyKey === `audience:${audience.id}:approve`
                                ? 'Approving…'
                                : 'Approve audience'}
                            </button>
                            <button
                              className="button-secondary"
                              disabled={
                                reviewBusyKey === `audience:${audience.id}:reject`
                              }
                              onClick={() => void reviewAudience(audience.id, 'reject')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                      {editingAudienceId === audience.id && (
                        <div className="panel stack">
                          <label>
                            Name
                            <input
                              value={audienceEdit.name}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  name: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Problem / use-case fit
                            <textarea
                              rows={3}
                              value={audienceEdit.problem}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  problem: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Purchase triggers
                            <input
                              value={audienceEdit.triggers}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  triggers: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Relevant terminology
                            <input
                              value={audienceEdit.terminology}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  terminology: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Outreach motion
                            <select
                              value={audienceEdit.outreachMotion}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  outreachMotion: event.target.value,
                                })
                              }
                            >
                              <option value="b2b">B2B</option>
                              <option value="b2c">B2C</option>
                              <option value="b2b2c">B2B2C</option>
                              <option value="community">
                                Community / public conversation
                              </option>
                            </select>
                          </label>
                          <label>
                            Priority
                            <select
                              value={audienceEdit.priority}
                              onChange={(event) =>
                                setAudienceEdit({
                                  ...audienceEdit,
                                  priority: event.target.value,
                                })
                              }
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </label>
                          <div className="button-row">
                            <button onClick={() => void saveAudienceEdit()}>
                              Save audience
                            </button>
                            <button
                              className="button-secondary"
                              onClick={() => setEditingAudienceId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                }),
                  ])
                )}
              </>
            ))}
          <div
            id="outreach"
            className={`panel pw-panel stack decisions-panel ${openStages.outreach ? 'workflow-active' : 'workflow-inactive'}`}
          >
            <div className="workflow-stage-header pw-panel-head">
              <span className="pw-panel-icon">
                <Megaphone size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow">4. Outreach</p>
                <h3 className="pw-panel-title" tabIndex={-1}>
                  Outreach channels
                </h3>
              </div>
              <button
                type="button"
                className="button-secondary workflow-stage-toggle"
                aria-expanded={openStages.outreach}
                aria-controls="outreach-body"
                onClick={() => toggleStage('outreach')}
              >
                {openStages.outreach ? 'Collapse' : 'Expand'}
                <span aria-hidden="true">{openStages.outreach ? '⌃' : '⌄'}</span>
              </button>
            </div>
            {openStages.outreach && (
              <div id="outreach-body" className="workflow-stage-body stack">
                {currentDecisions.length > 0 ? (
                  currentDecisions.map((decision) => (
                    <div className="pw-channel" key={decision.id}>
                      {(() => {
                        const ChannelIcon =
                          decision.channel === 'email'
                            ? Mail
                            : decision.channel === 'reddit'
                              ? MessageSquare
                              : decision.channel === 'community'
                                ? Users
                                : Briefcase;
                        const audience = audiences.find(
                          (item) => item.id === decision.audience_id,
                        );
                        const decisionEvidence = evidenceRecords.filter(
                          (record) =>
                            record.subject_type === 'outreach_decision' &&
                            record.subject_id === decision.id,
                        );
                        const summary = summarizeEvidence(
                          decisionEvidence.map((record) => ({
                            sourceUrl: record.source_url,
                            sourceReference: record.source_reference,
                            snippet: record.source_snippet,
                            sourceType: record.source_type,
                            evidenceStatus: record.evidence_status,
                            confidence: record.confidence,
                          })),
                        );
                        return (
                          <>
                            <div className="pw-channel-top">
                              <span className="pw-channel-icon">
                                <ChannelIcon size={21} aria-hidden="true" />
                              </span>
                              <div className="pw-channel-heading">
                                <strong>{channelLabel(decision.channel)}</strong>
                                <span>{collateralLabel(decision.collateral_type)}</span>
                              </div>
                              <span
                                className={`pw-badge ${decision.status === 'proposed' ? 'pw-badge-review' : 'pw-badge-approved'}`}
                              >
                                {decision.status === 'proposed'
                                  ? 'Needs review'
                                  : 'Approved'}
                              </span>
                            </div>
                            <div
                              className="pw-audience-pill"
                              title={audience?.name ?? 'Audience'}
                            >
                              For: {audience?.name ?? 'Audience'}
                            </div>
                            {(!audience?.problem_use_case_fit ||
                              !isNearDuplicate(
                                decision.objective,
                                audience.problem_use_case_fit,
                              )) && (
                              <div className="pw-goal">
                                <span>Goal</span>
                                <span>
                                  {textFor(
                                    decision.display_labels?.goal,
                                    decision.objective,
                                    12,
                                  )}
                                </span>
                              </div>
                            )}
                            <Disclosure
                              label={`Why ${channelLabel(decision.channel)}?`}
                            >
                              <p className="muted">
                                {decision.display_labels?.why ??
                                  (isFallbackText(decision.rationale)
                                    ? 'This recommendation is based on the approved audience and available channel signals.'
                                    : shorten(decision.rationale, 30))}
                              </p>
                              <p className="muted">{summary.explanation}</p>
                              {decisionEvidence.length > 0 && (
                                <div className="evidence-list">
                                  {decisionEvidence.slice(0, 3).map((record) => (
                                    <div key={record.id}>
                                      {record.source_snippet ??
                                        record.source_reference ??
                                        'Linked source'}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {decisionEvidence.length === 0 && (
                                <p className="muted">
                                  No sources are linked to this recommendation yet.
                                </p>
                              )}
                            </Disclosure>
                            <Disclosure label="Technical details">
                              <dl className="pw-technical">
                                <dt>Decision version</dt>
                                <dd>{decision.version}</dd>
                                <dt>Audience version</dt>
                                <dd>{decision.audience_version}</dd>
                                <dt>ICP version</dt>
                                <dd>{decision.icp_version}</dd>
                                <dt>Motion</dt>
                                <dd>{decision.outreach_motion}</dd>
                                <dt>Collateral</dt>
                                <dd>{decision.collateral_type}</dd>
                              </dl>
                            </Disclosure>
                          </>
                        );
                      })()}
                      {decision.status === 'proposed' && (
                        <span className="pw-card-actions">
                          <button
                            disabled={
                              reviewBusyKey === `decision:${decision.id}:approve`
                            }
                            onClick={() => void reviewDecision(decision.id, 'approve')}
                          >
                            {reviewBusyKey === `decision:${decision.id}:approve`
                              ? 'Approving…'
                              : 'Approve channel'}
                          </button>
                          <button
                            className="button-secondary"
                            onClick={() => void reviewDecision(decision.id, 'reject')}
                          >
                            Reject
                          </button>
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    No outreach decisions are available yet. Approve an audience to
                    generate channel recommendations.
                  </p>
                )}
                {earlierDecisions.length > 0 && (
                  <Disclosure label={`Earlier versions (${earlierDecisions.length})`}>
                    <div className="stack">
                      {earlierDecisions.map((decision) => (
                        <div className="route-row" key={`earlier-${decision.id}`}>
                          <span>{channelLabel(decision.channel)}</span>
                          <span className="muted">
                            For an earlier version of this audience
                          </span>
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                )}
              </div>
            )}
          </div>
          <div
            id="copy"
            className={`panel pw-panel stack copy-panel ${openStages.copy ? 'workflow-active' : 'workflow-inactive'}`}
          >
            <div className="workflow-stage-header pw-panel-head">
              <span className="pw-panel-icon">
                <PenLine size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow">5. Copy</p>
                <h3 className="pw-panel-title" tabIndex={-1}>
                  {generatedCopy[0] ? humanizeKey(generatedCopy[0].copy_type) : 'Copy'}
                </h3>
              </div>
              <button
                type="button"
                className="button-secondary workflow-stage-toggle"
                aria-expanded={openStages.copy}
                aria-controls="copy-body"
                onClick={() => toggleStage('copy')}
              >
                {openStages.copy ? 'Collapse' : 'Expand'}
                <span aria-hidden="true">{openStages.copy ? '⌃' : '⌄'}</span>
              </button>
            </div>
            {openStages.copy && (
              <div id="copy-body" className="workflow-stage-body stack">
                <div className="card-heading">
                  <h3>Copy</h3>
                  <Link
                    className="button-secondary"
                    to={`/sales-os/engage?product=${productId}`}
                  >
                    Open in Engage
                  </Link>
                </div>
                {generatedCopy.length === 0 ? (
                  <p className="muted">
                    Copy appears here after an Outreach Decision is approved.
                  </p>
                ) : (
                  Object.entries(copyByAudience).flatMap(([audienceId, copies]) => [
                    Object.keys(copyByAudience).length > 1 ? (
                      <div className="card-heading" key={`copy-group-${audienceId}`}>
                        <h4>
                          {audiences.find((audience) => audience.id === audienceId)
                            ?.name ?? 'Product audience'}
                        </h4>
                        <span className="muted">Copy by approved channel</span>
                      </div>
                    ) : null,
                    ...copies.map((copy) => (
                      <div className="route-row copy-card" key={copy.id}>
                        <div className="copy-card-header">
                          <div>
                            <strong>{humanizeKey(copy.copy_type)}</strong>
                            <span className="muted">
                              {copy.message_angle ?? 'Generated outreach copy'}
                            </span>
                          </div>
                          <span className="status-pill">
                            {channelLabel(copy.channel)}
                          </span>
                          <span className="status-pill">
                            {displayStatus(copy.status)}
                          </span>
                        </div>
                        <p className="muted copy-card-source">
                          Based on outreach decision v
                          {decisions.find(
                            (decision) => decision.id === copy.outreach_decision_id,
                          )?.version ?? '—'}
                        </p>
                        <div className="copy-card-body">
                          {editingCopyIds.has(copy.id) ? (
                            <textarea
                              rows={5}
                              value={copyEdits[copy.id] ?? mainDraftForCopy(copy)}
                              onChange={(event) =>
                                setCopyEdits((current) => ({
                                  ...current,
                                  [copy.id]: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            <MarkdownPreview content={mainDraftForCopy(copy)} />
                          )}
                        </div>
                        {(copy.contact_id ||
                          copy.subject ||
                          copy.cta ||
                          copy.follow_up_strategy) && (
                          <Disclosure label="Recipient and message details" quiet>
                            <div className="stack">
                              {copy.contact_id && (
                                <p className="muted">
                                  {(() => {
                                    const recipient = contactsById.get(copy.contact_id);
                                    const account = recipient?.account_id
                                      ? accountsById.get(recipient.account_id)
                                      : undefined;
                                    return `${recipient?.full_name ?? 'Discovered contact'}${recipient?.title ? ` · ${recipient.title}` : ''}${account ? ` · ${account.name}` : ''}${recipient?.professional_email ? ` · ${recipient.professional_email}` : ''}`;
                                  })()}
                                </p>
                              )}
                              {copy.subject && (
                                <p className="muted">Subject: {copy.subject}</p>
                              )}
                              {copy.cta && (
                                <p className="muted">Call to action: {copy.cta}</p>
                              )}
                              {formatFollowUp(copy.follow_up_strategy) && (
                                <p className="muted">
                                  Follow-up: {formatFollowUp(copy.follow_up_strategy)}
                                </p>
                              )}
                            </div>
                          </Disclosure>
                        )}
                        {draftVariantsForCopy(copy).others.length > 0 && (
                          <Disclosure
                            label={`Other versions in this draft (${draftVariantsForCopy(copy).others.length})`}
                          >
                            <div className="stack">
                              {draftVariantsForCopy(copy).others.map((variant) => (
                                <div key={variant.label ?? variant.body}>
                                  <strong>{variant.label ?? 'Other version'}</strong>
                                  <MarkdownPreview content={variant.body} />
                                </div>
                              ))}
                            </div>
                          </Disclosure>
                        )}
                        {copy.status === 'awaiting_approval' && (
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => {
                              setCopyEdits((current) => ({
                                ...current,
                                [copy.id]: mainDraftForCopy(copy),
                              }));
                              setEditingCopyIds((current) => {
                                const next = new Set(current);
                                if (next.has(copy.id)) next.delete(copy.id);
                                else next.add(copy.id);
                                return next;
                              });
                            }}
                          >
                            {editingCopyIds.has(copy.id) ? 'Preview copy' : 'Edit text'}
                          </button>
                        )}
                        {copy.status === 'awaiting_approval' && (
                          <>
                            <label>
                              What should change? (optional)
                              <textarea
                                rows={2}
                                value={copyReviewNotes[copy.id] ?? ''}
                                onChange={(event) =>
                                  setCopyReviewNotes((current) => ({
                                    ...current,
                                    [copy.id]: event.target.value,
                                  }))
                                }
                                placeholder="Add notes for the next revision."
                              />
                            </label>
                            <span className="button-row">
                              <button
                                onClick={() =>
                                  void reviewCopy(copy.id, copyReviewAction(copy.id))
                                }
                              >
                                {reviewBusyKey ===
                                `copy:${copy.id}:${copyReviewAction(copy.id)}`
                                  ? 'Approving…'
                                  : 'Approve copy'}
                              </button>
                              <button
                                className="button-secondary"
                                onClick={() => void reviewCopy(copy.id, 'reject')}
                              >
                                Request changes
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                    )),
                  ])
                )}
              </div>
            )}
          </div>
        </div>
        <NextUpRail
          steps={workflowSteps}
          nextUp={nextUp}
          onSelect={(stage) => goToStage(stage)}
        />
      </div>
    </section>
  );
}
