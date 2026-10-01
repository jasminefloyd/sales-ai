type RecordValue = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function first(values: string[], fallback: string): string {
  return values.find(Boolean) ?? fallback;
}

function sentence(value: string): string {
  if (!value) return '';
  return value.endsWith('.') ? value : `${value}.`;
}

/**
 * Completes an AI audience candidate before it reaches persistence.
 *
 * Missing values are inferred only from the product profile and available
 * research. The returned `completion` metadata makes those inferences visible
 * to reviewers; it is not presented as source evidence.
 */
export function completeIcpCandidate(
  rawCandidate: RecordValue,
  profile: RecordValue,
  researchEvidence: unknown[] = [],
) {
  const profileProblems = list(profile.problems_solved);
  const profileUseCases = list(profile.primary_use_cases);
  const profileTriggers = list(profile.purchase_triggers);
  const profileAlternatives = list(profile.competitive_alternatives);
  const profileCapabilities = list(profile.core_capabilities);
  const profileTerminology = list(profile.relevant_language);
  const profileDescription = text(profile.description);
  const category = text(profile.category) || 'the product category';
  const candidateBehavior = record(rawCandidate.buyingBehavior);
  const motion = ['b2b', 'b2b2c'].includes(text(rawCandidate.outreachMotion).toLowerCase())
    || text(rawCandidate.buyerType).toLowerCase() === 'organization'
    ? 'b2b'
    : text(rawCandidate.outreachMotion).toLowerCase() || 'b2c';
  const buyerType = motion === 'b2b' || motion === 'b2b2c' || text(rawCandidate.buyerType) === 'organization'
    ? 'organization'
    : 'individual';

  const problem = first(
    [text(rawCandidate.problemUseCaseFit), ...profileProblems, ...profileUseCases, profileDescription],
    `the need addressed by this ${category} product`,
  );
  const name = first(
    [text(rawCandidate.name)],
    buyerType === 'organization'
      ? `${first(profileUseCases, category)} teams`
      : `People who need ${problem.toLowerCase()}`,
  );
  const fit = first(
    [text(rawCandidate.aiFitAssessment)],
    sentence(
      `AI inference: this audience is a fit because the product provides ${first(
        profileCapabilities,
        `a focused solution for ${problem.toLowerCase()}`,
      )}`,
    ),
  );
  const triggers = list(rawCandidate.purchaseTriggers).length
    ? list(rawCandidate.purchaseTriggers)
    : profileTriggers.length
      ? profileTriggers
      : [
          `A new need or deadline makes ${problem.toLowerCase()} urgent`,
          `The current workflow no longer supports the required outcome`,
        ];
  const alternatives = first(
    [text(candidateBehavior.currentAlternative), ...profileAlternatives],
    `Existing manual workflows or adjacent ${category} tools`,
  );
  const friction = first(
    [text(candidateBehavior.purchaseFriction), text(profile.purchase_friction)],
    `Evaluating a new ${category} workflow, changing existing habits, and confirming expected value`,
  );
  const roles = buyerType === 'organization'
    ? {
        buyer: first([text(candidateBehavior.buyer), text(rawCandidate.decisionMaker)], 'The budget owner or department leader'),
        influencer: first([text(candidateBehavior.influencer)], 'The team lead or operational champion'),
        endUser: first([text(candidateBehavior.endUser)], 'The people who perform the workflow'),
        organizationType: first([text(candidateBehavior.organizationType)], `Organizations that experience ${problem.toLowerCase()}`),
      }
    : {
        userType: first([text(candidateBehavior.userType)], `People who experience ${problem.toLowerCase()}`),
        decisionContext: first([text(candidateBehavior.decisionContext)], 'Self-directed evaluation based on urgency and expected outcome'),
      };
  const evidence = list(rawCandidate.supportingEvidence).length
    ? rawCandidate.supportingEvidence
    : researchEvidence.length
      ? researchEvidence
      : Array.isArray(profile.source_evidence) && profile.source_evidence.length
        ? profile.source_evidence
        : [{
            sourceType: 'product_profile_snapshot',
            snippet: first([profileDescription, `Product category: ${category}`], category),
          }];
  const commercialEvidence = Array.isArray(rawCandidate.commercialEvidence) && rawCandidate.commercialEvidence.length
    ? rawCandidate.commercialEvidence
    : [{
        type: 'ai_inference',
        statement: `Commercial fit is inferred from the audience's relationship to ${problem.toLowerCase()}; confirm budget and buying readiness during review.`,
        confidence: 'low',
      }];
  const routes = Array.isArray(rawCandidate.routes) && rawCandidate.routes.length
    ? rawCandidate.routes
    : buyerType === 'organization'
      ? [
          { routeType: 'direct', rationale: 'Role-based outreach to organizations and their buying committee.' },
          { routeType: 'social', rationale: 'Professional communities where the buying committee learns and compares solutions.' },
        ]
      : [{ routeType: 'social', rationale: 'Public conversations and communities where people discuss this need.' }];

  return {
    ...rawCandidate,
    name,
    buyerType,
    outreachMotion: motion,
    outreachMotionReason: first(
      [text(rawCandidate.outreachMotionReason)],
      `AI inference based on the ${buyerType === 'organization' ? 'organizational' : 'individual'} buyer described by the product profile.`,
    ),
    problemUseCaseFit: problem,
    coreProblem: first([text(rawCandidate.coreProblem)], problem),
    whyProductFits: fit,
    purchaseTrigger: triggers[0],
    currentAlternative: alternatives,
    buyingMotivation: first(
      [text(rawCandidate.buyingMotivation)],
      `Reduce the impact of ${problem.toLowerCase()} and reach the desired outcome with less friction`,
    ),
    purchaseFriction: friction,
    decisionMaker: buyerType === 'organization' ? roles.buyer : null,
    companyCharacteristics: buyerType === 'organization' ? roles : {},
    userCharacteristics: buyerType === 'individual' ? roles : {},
    buyingBehavior: { ...candidateBehavior, ...roles },
    purchaseTriggers: triggers,
    relevantTerminology: list(rawCandidate.relevantTerminology).length
      ? list(rawCandidate.relevantTerminology)
      : [...profileTerminology, category, ...profileUseCases].filter(Boolean).slice(0, 8),
    supportingEvidence: evidence,
    aiFitAssessment: fit,
    budgetFit: first(
      [text(rawCandidate.budgetFit), text(candidateBehavior.budgetFit)],
      'AI inference: likely evaluated against the current cost of the problem and available team or operating budget; confirm during review.',
    ),
    purchaseReadiness: first(
      [text(rawCandidate.purchaseReadiness), text(candidateBehavior.purchaseReadiness)],
      `AI inference: readiness increases when ${triggers[0].toLowerCase()}; confirm timing during review.`,
    ),
    commercialEvidence,
    validationRationale: first(
      [text(rawCandidate.validationRationale)],
      'AI completed this ICP from the product profile and available research. Commercial assumptions are explicitly marked for human confirmation.',
    ),
    priority: ['low', 'high'].includes(text(rawCandidate.priority)) ? text(rawCandidate.priority) : 'medium',
    routes,
    completion: {
      completedBy: 'ai',
      source: 'product_profile_and_research',
      inferredFields: ['name', 'buyerType', 'problemUseCaseFit', 'buyingBehavior', 'purchaseTriggers', 'budgetFit', 'purchaseReadiness', 'commercialEvidence', 'routes'],
      requiresHumanReview: true,
    },
  };
}
