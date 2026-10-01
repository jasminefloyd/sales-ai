export type ConsoleCommand =
  | {
      tool: 'get_learnings' | 'search_opportunities' | 'get_opportunity';
      input: Record<string, string>;
    }
  | { tool: 'request_find_run'; input: Record<string, string> }
  | {
      tool:
        | 'request_engagement_draft'
        | 'request_audience_change'
        | 'request_opportunity_rejection'
        | 'request_learning_application';
      input: Record<string, string>;
    };

export function parseConsoleCommand(
  command: string,
  productId: string,
): ConsoleCommand {
  const normalized = command.trim();
  if (/^what have we learned/i.test(normalized) || /^show learnings/i.test(normalized))
    return { tool: 'get_learnings', input: { productId } };
  const rejection = normalized.match(/reject opportunity ([0-9a-f-]{36})/i);
  if (rejection)
    return {
      tool: 'request_opportunity_rejection',
      input: { productId, entityId: rejection[1] },
    };
  const explanation = normalized.match(/(?:why|explain).*opportunity ([0-9a-f-]{36})/i);
  if (explanation)
    return { tool: 'get_opportunity', input: { productId, entityId: explanation[1] } };
  const draft = normalized.match(/draft engagement.*opportunity ([0-9a-f-]{36})/i);
  if (draft)
    return {
      tool: 'request_engagement_draft',
      input: { productId, entityId: draft[1] },
    };
  const learning = normalized.match(/apply learning ([0-9a-f-]{36})/i);
  if (learning)
    return {
      tool: 'request_learning_application',
      input: { productId, entityId: learning[1] },
    };
  const audienceChange = normalized.match(
    /^(?:stop targeting|change audience|update audience|remove audience focus on)\s+(.+)$/i,
  );
  if (audienceChange)
    return {
      tool: 'request_audience_change',
      input: { productId, instruction: audienceChange[1].trim() },
    };
  if (/^run find/i.test(normalized))
    return { tool: 'request_find_run', input: { productId, command: normalized } };
  return { tool: 'search_opportunities', input: { productId, query: normalized } };
}
