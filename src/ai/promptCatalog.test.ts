import { describe, expect, it } from 'vitest';

import { buildPromptMetadata, SALES_OS_PROMPT_CATALOG_VERSION } from './promptCatalog';

describe('Sales OS prompt catalog', () => {
  it('provides source-controlled metadata for operational AI tasks', () => {
    expect(buildPromptMetadata('learning_analysis')).toEqual({
      promptVersion: SALES_OS_PROMPT_CATALOG_VERSION,
      task: 'learning_analysis',
    });
  });
});
