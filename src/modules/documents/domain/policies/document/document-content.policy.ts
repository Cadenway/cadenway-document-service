import { DocumentError } from '../../errors/document/document.error.js';

/** Counts Unicode code points for JSON Schema and refuses text PostgreSQL cannot round trip. */
function validateText(text: string, field: 'title' | 'body', maximum: number): void {
  let count = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index) ?? 0;
    if (codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new DocumentError(
        `invalid-${field}`,
        `Document ${field} contains invalid Unicode text.`,
      );
    }
    count += 1;
    if (count > maximum) {
      throw new DocumentError(
        `invalid-${field}`,
        `Document ${field} must have at most ${String(maximum)} characters.`,
      );
    }
    index += codePoint > 0xffff ? 2 : 1;
  }
}

/** Enforces the published DocumentTitle constraints and trims surrounding whitespace. */
export function normalizeDocumentTitle(title: string): string {
  validateText(title, 'title', 200);
  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new DocumentError('invalid-title', 'Document title must contain text.');
  }
  return normalized;
}

/** Enforces the published DocumentMarkdown size while preserving the original Markdown. */
export function validateDocumentBody(body: string): string {
  validateText(body, 'body', 100_000);
  return body;
}
