import {
  parseProductDocument,
  parseProductMarkdown,
  type ProductImportDraft,
} from './markdownImport';

export type ProductSourceFormat = 'markdown' | 'text' | 'structured' | 'document';

export function detectProductSourceFormat(
  fileName: string,
  mimeType = '',
): ProductSourceFormat {
  const name = fileName.toLowerCase();
  if (/\.(md|markdown)$/.test(name) || mimeType.includes('markdown')) return 'markdown';
  if (
    /\.(json|csv)$/.test(name) ||
    mimeType.includes('json') ||
    mimeType.includes('csv')
  )
    return 'structured';
  if (/\.(pdf|doc|docx)$/.test(name)) return 'document';
  return 'text';
}

export function parseProductSource(
  fileName: string,
  content: string,
  mimeType = '',
): ProductImportDraft {
  const format = detectProductSourceFormat(fileName, mimeType);
  if (format === 'markdown') return parseProductMarkdown(content, fileName);
  if (format === 'document') return parseProductDocument(content, fileName);
  return {
    name: fileName.replace(/\.[^.]+$/, '').trim() || 'Imported product',
    websiteUrl: '',
    descriptionInput: content,
    pricingBusinessModel: '',
    primaryObjective: '',
    geographicConstraints: '',
    knownAudiences: '',
    additionalContext: '',
  };
}
