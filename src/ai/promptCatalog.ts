export const SALES_OS_PROMPT_CATALOG_VERSION = 'sales_os_prompt_v1';

export const SALES_OS_PROMPT_TASKS = {
  productProfile: 'product_sales_profile',
  audienceHypotheses: 'generate_audience_hypotheses',
  audienceFit: 'audience_fit_assessment',
  searchPlan: 'search_web',
  opportunityFit: 'direct_opportunity_fit_assessment',
  recommendedAction: 'recommended_action',
  engagementDraft: 'generate_engagement_draft',
  learningAnalysis: 'learning_analysis',
  consoleOrchestration: 'sales_console_orchestration',
} as const;

export type SalesOsPromptTask =
  (typeof SALES_OS_PROMPT_TASKS)[keyof typeof SALES_OS_PROMPT_TASKS];

export function buildPromptMetadata(task: SalesOsPromptTask) {
  return {
    promptVersion: SALES_OS_PROMPT_CATALOG_VERSION,
    task,
  } as const;
}
