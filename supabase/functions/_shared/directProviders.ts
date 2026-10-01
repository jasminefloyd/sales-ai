// Shared by the Edge worker and the legacy adapter facade. No secrets or runtime globals.
// Contracts: https://hunter.io/api-documentation/v2 and https://exa.ai/docs/reference/search
type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function readableValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join('; ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, val]) => `${key}: ${readableValue(val)}`).join('; ');
  return '';
}
export function directSearchQuery(input: Row): string {
  if (text(input.query)) return text(input.query);
  const audience = record(input.audience), icp = record(input.icp), account = record(input.account);
  const parts = [audience.name, icp.company_characteristics, audience.problem_use_case_fit, icp.decision_maker, record(input.product).geographic_constraints, account.name, account.domain, account.industry].map(readableValue).filter(Boolean);
  if (!parts.length) throw new Error('Company discovery needs an approved audience definition or organization account.');
  if (account.domain) return `Find official organization details for ${parts.join('. ').slice(0, 1800)}`;
  return `Find official organization websites matching this target audience: ${parts.join('. ').slice(0, 1800)}`;
}
function httpUrl(value: unknown): string | undefined {
  try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export function normalizeCompanyResults(payload: unknown) {
  const rows = record(payload).results;
  if (!Array.isArray(rows)) throw new Error('Company search returned an invalid results payload.');
  const seen = new Set<string>();
  return rows.flatMap((value) => {
    const row = record(value), url = httpUrl(row.url), name = text(row.title);
    const excerpts = Array.isArray(row.highlights) ? row.highlights.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
    if (!url || !name || !excerpts.length) return [];
    const domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    // Directory/social pages are evidence, not the target organization's domain.
    if (['linkedin.com','facebook.com','reddit.com','wikipedia.org'].some(host=>domain===host || domain.endsWith('.'+host)) || seen.has(domain)) return [];
    seen.add(domain);
    return [{name,domain,websiteUrl:url,companyContext:{discoveryStatus:'candidate',sourceTitle:name},evidence:excerpts.map(excerpt=>({url,excerpt,sourceType:'company_site',observedAt:new Date().toISOString()}))}];
  });
}
export function hunterRequest(capability: string, input: Row, apiKey: string) {
  const params = new URLSearchParams({api_key:apiKey});
  const account = record(input.account), person = record(input.person);
  let endpoint: string;
  if (capability === 'verifyContact') {
    endpoint = 'email-verifier';
    const email = text(input.email);
    if (!email) throw new Error('Email verification requires an email address.');
    params.set('email',email);
  } else if (capability === 'findPerson' || capability === 'findContact') {
    const domain = text(input.domain) || text(account.domain);
    if (!domain) throw new Error('Contact discovery requires an organization domain.');
    params.set('domain',domain);
    if (capability === 'findPerson') {
      // Hunter's Domain Search default of 10 is available across plans;
      // larger limits are restricted to Premium plans and return HTTP 400
      // for accounts without that entitlement.
      endpoint = 'domain-search'; params.set('type','personal'); params.set('required_field','full_name'); params.set('limit','10');
    } else {
      endpoint = 'email-finder';
      const fullName = text(input.full_name) || text(person.fullName);
      if (!fullName) throw new Error('Email lookup requires a named person.');
      params.set('full_name', fullName);
    }
  } else throw new Error(`Hunter does not support ${capability}.`);
  return {endpoint,params};
}
export function verificationStatus(status: unknown): 'valid' | 'invalid' | 'risky' | 'unknown' {
  if (status === 'valid' || status === 'invalid') return status;
  if (['accept_all','risky','webmail','disposable'].includes(String(status))) return 'risky';
  return 'unknown';
}
function hunterEvidence(row: Row) {
  return (Array.isArray(row.sources) ? row.sources : []).flatMap(value=>{
    const source=record(value),url=httpUrl(source.uri);
    if (!url) return [];
    return [{url,excerpt:[row.first_name,row.last_name,row.position,row.value ?? row.email].map(text).filter(Boolean).join(' · '),sourceType:'contact_provider',observedAt:text(source.last_seen_on)||null}];
  });
}
export function normalizeHunterResult(capability: string, payload: unknown, input: Row) {
  const root = record(payload);
  if (!('data' in root)) throw new Error('Hunter returned an invalid response payload.');
  if (root.data === null) return [];
  const data = record(root.data);
  if (capability === 'findPerson') {
    if (!Array.isArray(data.emails)) throw new Error('Hunter returned an invalid people list.');
    return data.emails.flatMap(value=>{
      const row=record(value),fullName=[row.first_name,row.last_name].map(text).filter(Boolean).join(' ');
      if (!fullName) return [];
      return [{fullName,title:text(row.position),professionalProfileUrl:httpUrl(row.linkedin),professionalEmail:text(row.value)||undefined,evidence:hunterEvidence(row)}];
    });
  }
  const email=text(data.email)||text(input.email);
  if (!email) return [];
  const verification=record(data.verification);
  return [{professionalEmail:email,verificationStatus:verificationStatus(data.status ?? verification.status),verificationProvider:'hunter',verifiedAt:text(verification.date)||(capability==='verifyContact'?new Date().toISOString():null),evidence:hunterEvidence(data)}];
}
export class ContactProviderError extends Error {
  constructor(public readonly status:number, capability:string) {
    super(`Hunter ${capability} ${status===202?'verification is pending':'request failed'} (HTTP ${status}).`);
  }
  get code(){return `http_${this.status}`;}
  get retryable(){return [202,222,429].includes(this.status)||this.status>=500;}
}
export function isFreshVerifiedEmail(status:unknown, verifiedAt:unknown, now=Date.now()) {
  const timestamp=typeof verifiedAt==='string'?Date.parse(verifiedAt):NaN;
  return status==='valid' && Number.isFinite(timestamp) && timestamp<=now && now-timestamp<=30*86400000;
}
export async function executeHunter(capability: string, input: Row, apiKey: string, fetcher: typeof fetch = fetch, baseUrl='https://api.hunter.io/v2') {
  const {endpoint,params}=hunterRequest(capability,input,apiKey);
  const response=await fetcher(`${baseUrl}/${endpoint}?${params}`,{signal:AbortSignal.timeout(25000)});
  const payload=await response.json();
  if (!response.ok || response.status===202 || response.status===222) {
    // Never include request URLs/API keys in thrown errors.
    throw new ContactProviderError(response.status,capability);
  }
  return normalizeHunterResult(capability,payload,input);
}

export function workerError(error: unknown) {
  const row = record(error);
  const directMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? text((error as { message?: unknown }).message)
        : '';
  const directCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? text((error as { code?: unknown }).code)
      : '';
  return {
    code: directCode || text(row.code) || 'worker_exception',
    message: directMessage || text(row.message) || 'Worker execution failed.',
    details:
      typeof error === 'object' && error !== null && 'details' in error
        ? text((error as { details?: unknown }).details) || null
        : null,
    hint:
      typeof error === 'object' && error !== null && 'hint' in error
        ? text((error as { hint?: unknown }).hint) || null
        : null,
  };
}

export async function discoveryRecordId(parts: string[]) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts))));
  bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
