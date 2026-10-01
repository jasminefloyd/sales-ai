type ContactCandidate = {
  fullName?: unknown;
  title?: unknown;
  professionalEmail?: unknown;
  evidence?: unknown;
  [key: string]: unknown;
};

const DECISION_MAKER_TERMS = [
  'chief', 'ceo', 'cfo', 'coo', 'cto', 'cmo', 'cro', 'founder',
  'co-founder', 'owner', 'president', 'partner', 'principal',
  'managing director', 'general manager', 'vice president', 'vp',
  'head of', 'director',
];
const INFLUENCE_TERMS = [
  'manager', 'lead', 'growth', 'marketing', 'revenue', 'sales',
  'operations', 'strategy', 'procurement',
];
const LOW_PRIORITY_TERMS = [
  'assistant', 'intern', 'coordinator', 'student', 'recruiter', 'technical staff',
];
const EXECUTIVE_TERMS = [
  'chief', 'ceo', 'cfo', 'coo', 'cto', 'cmo', 'cro', 'founder',
  'co-founder', 'owner', 'president', 'partner', 'principal',
];

function normalized(value: unknown) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function containsTerm(value: string, term: string) {
  return ` ${value} `.includes(` ${normalized(term)} `);
}

function titleScore(title: unknown, targetRole?: string) {
  const value = normalized(title);
  if (!value) return 0;
  let score = 0;
  for (const term of DECISION_MAKER_TERMS) if (containsTerm(value, term)) score += 20;
  for (const term of EXECUTIVE_TERMS) if (containsTerm(value, term)) score += 20;
  for (const term of INFLUENCE_TERMS) if (containsTerm(value, term)) score += 6;
  for (const term of LOW_PRIORITY_TERMS) if (containsTerm(value, term)) score -= 12;
  const targetTerms = normalized(targetRole).split(' ').filter((term) => term.length > 2);
  score += targetTerms.filter((term) => containsTerm(value, term)).length * 10;
  return score;
}

function evidenceScore(candidate: ContactCandidate) {
  return Array.isArray(candidate.evidence) ? Math.min(candidate.evidence.length, 5) : 0;
}

export function rankContactCandidates(
  candidates: ContactCandidate[],
  targetRole?: string,
  limit = 3,
) {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => typeof candidate.fullName === 'string' && candidate.fullName.trim())
    .map((candidate, index) => ({
      candidate,
      index,
      score:
        titleScore(candidate.title, targetRole) * 10 +
        evidenceScore(candidate) * 2 +
        (typeof candidate.professionalEmail === 'string' ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ candidate }) => {
      const key = `${normalized(candidate.fullName)}|${normalized(candidate.professionalEmail)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, limit))
    .map(({ candidate }) => candidate);
}
