export const ADMIN_ANALYTICS_EVENTS = [
  'identity_linked',
  'product_visit',
  'user_signed_up',
  'trial_started',
  'scene_created',
  'rehearsal_started',
  'rehearsal_completed',
  'pass_purchased',
  'subscription_started',
  'subscription_cancelled',
  'pricing_viewed',
  'checkout_started',
  'checkout_completed',
  'trial_converted',
  'subscription_renewed',
  'payment_failed',
] as const;

export type AdminAnalyticsEventName =
  (typeof ADMIN_ANALYTICS_EVENTS)[number] | (string & {});

export type AdminAnalyticsSource = 'web' | 'server' | 'stripe' | 'system';
