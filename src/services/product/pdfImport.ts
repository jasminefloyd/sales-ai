import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export async function extractPdfText(file: Blob): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => {
        if (!('str' in item)) return '';
        return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push(text);
  }

  const extractedText = pages.join('\n\n').trim();
  if (!extractedText) {
    throw new Error(
      'This PDF does not contain selectable text. Upload a text-based PDF or paste the product information instead.',
    );
  }
  return extractedText;
}
