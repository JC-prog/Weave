import pdfParse from 'pdf-parse';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PDFMetadata {
  title?: string;
  author?: string;
  pages: number;
  creationDate?: string;
  modificationDate?: string;
}

// ─── PDF Text Extraction ──────────────────────────────────────────────────────

/**
 * Extract all text content from a PDF buffer.
 *
 * Uses pdf-parse which calls pdfjs-dist under the hood.
 * The extracted text preserves rough paragraph breaks but drops formatting.
 *
 * @param buffer  Raw PDF file data
 * @returns       Extracted plain text string
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text ?? '';
}

/**
 * Extract metadata from a PDF buffer.
 *
 * @param buffer  Raw PDF file data
 * @returns       Metadata object with title, author, and page count
 */
export async function extractMetadata(buffer: Buffer): Promise<PDFMetadata> {
  const data = await pdfParse(buffer);

  const info = data.info as Record<string, unknown> | undefined;

  return {
    title: typeof info?.['Title'] === 'string' ? info['Title'] : undefined,
    author: typeof info?.['Author'] === 'string' ? info['Author'] : undefined,
    pages: data.numpages ?? 0,
    creationDate:
      typeof info?.['CreationDate'] === 'string' ? info['CreationDate'] : undefined,
    modificationDate:
      typeof info?.['ModDate'] === 'string' ? info['ModDate'] : undefined,
  };
}
