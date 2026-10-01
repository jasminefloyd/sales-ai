export type ProductImportDraft = {
  name: string;
  websiteUrl: string;
  descriptionInput: string;
  pricingBusinessModel: string;
  primaryObjective: string;
  geographicConstraints: string;
  knownAudiences: string;
  additionalContext: string;
};

const emptyDraft: ProductImportDraft = {
  name: '',
  websiteUrl: '',
  descriptionInput: '',
  pricingBusinessModel: '',
  primaryObjective: '',
  geographicConstraints: '',
  knownAudiences: '',
  additionalContext: '',
};

const aliases: Record<
  keyof Omit<ProductImportDraft, 'name' | 'websiteUrl' | 'additionalContext'>,
  string[]
> = {
  descriptionInput: [
    'description',
    'overview',
    'product overview',
    'what is it',
    'product',
    'the problem',
    'problem',
    'the solution',
    'solution',
  ],
  pricingBusinessModel: [
    'pricing',
    'business model',
    'pricing and business model',
    'pricing & business model',
    'pricing / business model',
  ],
  primaryObjective: [
    'objective',
    'primary objective',
    'primary conversion goal',
    'conversion goal',
    'goals',
    'goal',
    'mission',
  ],
  geographicConstraints: [
    'geography',
    'geographic constraints',
    'location',
    'regions',
    'availability',
  ],
  knownAudiences: [
    'audience',
    'audiences',
    'target audience',
    'target users',
    'customers',
    'who is it for',
  ],
};

function cleanHeading(value: string): string {
  return value.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cleanContent(value: string): string {
  return value
    .replace(/^\s*<!--([\s\S]*?)-->\s*$/gm, '')
    .replace(/^\s*```[\w-]*\s*$/gm, '')
    .replace(/^\s*```\s*$/gm, '')
    .trim();
}

function sections(markdown: string): Map<string, string> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const found: Array<{ level: number; title: string; content: string[] }> = [];
  let current: (typeof found)[number] | null = null;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = {
        level: heading[1].length,
        title: cleanHeading(heading[2]),
        content: [],
      };
      found.push(current);
    } else if (current) {
      current.content.push(line);
    }
  }
  return new Map(
    found.map((section) => [section.title, cleanContent(section.content.join('\n'))]),
  );
}

function findSection(sectionMap: Map<string, string>, names: string[]): string {
  const match = names.find((name) => sectionMap.has(name));
  return match
    ? (sectionMap.get(match) ?? '')
        .replace(/^\s*(?:website|url)\s*:\s*\S+\s*$/gim, '')
        .trim()
    : '';
}

function findUrl(markdown: string): string {
  const match = markdown.match(/https?:\/\/[^\s)]+/i)?.[0];
  return match?.replace(/[.,;]+$/, '') ?? '';
}

function findLabeledValue(text: string, labels: string[]): string {
  const labelPattern = labels.join('|');
  const match = text.match(
    new RegExp(`(?:^|\\n|[.!?]\\s+)(?:${labelPattern})\\s*[:\\-]\\s*(.+)`, 'i'),
  );
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function inferObjective(text: string): string {
  const labeled = findLabeledValue(text, [
    'primary conversion goal',
    'conversion goal',
    'business objective',
    'objective',
    'goal',
    'success metric',
  ]);
  if (labeled) return labeled;
  const prioritizedPatterns = [
    /[^.!?]*(?:pay|pays|paid|purchase|purchases|buy|buys|checkout|sign ?up|subscribe|subscription)[^.!?]*[.!?]/i,
    /[^.!?]*(?:acquire|convert|conversion|revenue|sell|sale|sales)[^.!?]*[.!?]/i,
  ];
  for (const pattern of prioritizedPatterns) {
    const sentence = text.match(pattern)?.[0];
    if (sentence) return sentence.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function firstNonHeadingParagraph(markdown: string): string {
  return cleanContent(
    markdown.split(/\n\s*\n/).find((block) => block.trim() && !/^\s*#/.test(block)) ??
      '',
  );
}

export function parseProductMarkdown(
  markdown: string,
  fileName = 'imported document',
): ProductImportDraft {
  const normalized = markdown.trim();
  if (!normalized) throw new Error('The Markdown document is empty.');
  const sectionMap = sections(normalized);
  const firstHeading = /^#\s+(.+?)\s*$/m.exec(normalized)?.[1]?.trim() ?? '';
  const name =
    firstHeading ||
    findSection(sectionMap, ['product name', 'name']) ||
    fileName.replace(/\.markdown?$/i, '').replace(/[-_]+/g, ' ');
  const draft: ProductImportDraft = {
    ...emptyDraft,
    name,
    websiteUrl: findUrl(normalized),
    descriptionInput:
      findSection(sectionMap, aliases.descriptionInput) ||
      firstNonHeadingParagraph(normalized),
    pricingBusinessModel: findSection(sectionMap, aliases.pricingBusinessModel),
    primaryObjective:
      findSection(sectionMap, aliases.primaryObjective) ||
      inferObjective(
        findSection(sectionMap, [
          'the solution',
          'solution',
          'how it works',
          'how it works for you',
          'why now',
        ]) || normalized,
      ) ||
      'Determine the primary conversion goal from the imported product information.',
    geographicConstraints: findSection(sectionMap, aliases.geographicConstraints),
    knownAudiences: findSection(sectionMap, aliases.knownAudiences),
    additionalContext: `Imported from ${fileName}\n\n${normalized}`,
  };
  if (!draft.descriptionInput && !draft.websiteUrl) {
    throw new Error(
      'The Markdown document must include a product description or website URL.',
    );
  }
  return draft;
}

export function parseProductDocument(
  text: string,
  fileName = 'imported document',
): ProductImportDraft {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) throw new Error('The document is empty after text extraction.');
  const firstLine =
    normalized
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? '';
  const name =
    findLabeledValue(normalized, ['product name', 'product', 'name']) ||
    (firstLine.length <= 120 ? firstLine : '') ||
    fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const primaryObjective = inferObjective(normalized);
  return {
    ...emptyDraft,
    name,
    websiteUrl: findUrl(normalized),
    descriptionInput: normalized,
    pricingBusinessModel: findLabeledValue(normalized, [
      'pricing',
      'business model',
      'commercial model',
    ]),
    primaryObjective:
      primaryObjective ||
      'Determine the primary conversion goal from the imported product information.',
    geographicConstraints: findLabeledValue(normalized, [
      'geography',
      'geographic constraints',
      'location',
      'regions',
    ]),
    knownAudiences: findLabeledValue(normalized, [
      'target audience',
      'target users',
      'customers',
      'who is it for',
      'audience',
    ]),
    additionalContext: `Imported from ${fileName}\n\n${normalized}`,
  };
}
