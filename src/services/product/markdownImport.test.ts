import { describe, expect, it } from 'vitest';

import { parseProductMarkdown } from './markdownImport';

describe('product Markdown import', () => {
  it('maps PRD/FAQ sections into the Product form without creating a product', () => {
    const draft = parseProductMarkdown(
      `# RunScene

## Product Overview
RunScene helps creators rehearse scenes with structured feedback.

## Pricing & Business Model
Subscription with a free trial.

## Primary Objective
Increase completed rehearsals.

## Target Audience
Independent filmmakers and acting coaches.

Website: https://runscene.example.com`,
      'runscene-prd.md',
    );

    expect(draft).toMatchObject({
      name: 'RunScene',
      websiteUrl: 'https://runscene.example.com',
      pricingBusinessModel: 'Subscription with a free trial.',
      primaryObjective: 'Increase completed rehearsals.',
      knownAudiences: 'Independent filmmakers and acting coaches.',
    });
    expect(draft.additionalContext).toContain('runscene-prd.md');
  });

  it('rejects empty or context-free documents', () => {
    expect(() => parseProductMarkdown('   ')).toThrow('empty');
    expect(() => parseProductMarkdown('# Product\n\n## Pricing\n$10')).toThrow(
      'description or website',
    );
  });

  it('infers a reviewable conversion goal from a sales one-pager without an objective heading', () => {
    const draft = parseProductMarkdown(
      `# Atelier.Gallery

## The Problem
Artists lose sales when buyers cannot pay by card.

## The Solution
Buyers scan an artwork QR code, pay by card, and the artist gets paid automatically.

## Who It's For
Solo visual artists.`,
      'Sales_One_Pager.md',
    );

    expect(draft.primaryObjective).toContain('pay by card');
  });
});
