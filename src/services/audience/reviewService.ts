import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from '../jobs/workerService';

export type AudienceReviewAction = 'approve' | 'reject' | 'activate' | 'pause' | 'edit';
export type IcpReviewAction = 'approve' | 'reject' | 'activate' | 'pause' | 'edit';

export async function reviewAudienceOrRoute(input: {
  entityType: 'icp' | 'audience' | 'route';
  entityId: string;
  action: AudienceReviewAction | IcpReviewAction;
  updates?: Record<string, unknown>;
  runWorker?: boolean;
  rediscover?: boolean;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-audience',
    { body: input },
  );
  if (error) {
    // Supabase's FunctionsError only exposes a generic message by default, while
    // the edge function returns the actionable validation/relationship failure in
    // its JSON response body. Preserve that message for the review UI.
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      let payload: { error?: unknown; operation?: unknown; code?: unknown } | null = null;
      try {
        payload = (await response.clone().json()) as { error?: unknown };
      } catch {
        payload = null;
      }
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        const operation =
          typeof payload.operation === 'string' ? ` (${payload.operation})` : '';
        const code = typeof payload.code === 'string' ? ` [${payload.code}]` : '';
        throw new Error(`${payload.error}${operation}${code}`);
      }
    }
    throw error;
  }
  if (
    input.runWorker !== false &&
    ((input.entityType === 'audience' && input.action === 'approve') ||
      (input.entityType === 'route' &&
        (input.action === 'approve' || input.action === 'activate')))
  )
    await runSalesOsWorker();
  return data;
}
