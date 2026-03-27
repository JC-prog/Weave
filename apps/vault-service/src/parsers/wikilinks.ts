// ─── Regex ────────────────────────────────────────────────────────────────────
// Matches [[Title]] or [[Title|Alias]] patterns
const WIKILINK_REGEX = /\[\[([^\]|#\n]+?)(?:\|[^\]\n]*)?\]\]/g;

// ─── extractWikilinks ─────────────────────────────────────────────────────────
/**
 * Extracts all wikilink titles from a markdown string.
 * Handles [[Title]], [[Title|Alias]], and strips whitespace.
 * Returns a de-duplicated array of link titles.
 */
export function extractWikilinks(content: string): string[] {
  const titles = new Set<string>();
  let match: RegExpExecArray | null;

  // Reset regex state
  WIKILINK_REGEX.lastIndex = 0;

  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const title = match[1]?.trim();
    if (title && title.length > 0) {
      titles.add(title);
    }
  }

  // Reset for next call
  WIKILINK_REGEX.lastIndex = 0;

  return Array.from(titles);
}

// ─── resolveWikilink ─────────────────────────────────────────────────────────
/**
 * Resolves a wikilink title to a matching note.
 * Matching priority:
 *   1. Exact title match (case-insensitive)
 *   2. Exact slug match
 *   3. Partial title match
 */
export function resolveWikilink(
  title: string,
  notes: Array<{ id: string; title: string; slug: string }>,
): { id: string; title: string; slug: string } | null {
  if (!title || notes.length === 0) return null;

  const normalised = title.trim().toLowerCase();

  // 1. Exact title match (case-insensitive)
  const exactTitle = notes.find(
    (n) => n.title.toLowerCase() === normalised,
  );
  if (exactTitle) return exactTitle;

  // 2. Exact slug match
  const slugMatch = notes.find((n) => n.slug === normalised.replace(/\s+/g, '-'));
  if (slugMatch) return slugMatch;

  // 3. Partial title match (title starts with the search term)
  const partial = notes.find((n) =>
    n.title.toLowerCase().startsWith(normalised),
  );
  if (partial) return partial;

  return null;
}

// ─── replaceWikilinks ─────────────────────────────────────────────────────────
/**
 * Replaces all [[wikilinks]] in content using a resolver function.
 * If the resolver returns a non-null string, it replaces the entire [[...]] token.
 * If the resolver returns null the original token is left intact.
 */
export function replaceWikilinks(
  content: string,
  resolver: (title: string) => string | null,
): string {
  return content.replace(
    /\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]/g,
    (original, rawTitle: string, alias?: string) => {
      const title = rawTitle.trim();
      const displayText = alias?.trim() ?? title;
      const resolved = resolver(title);

      if (resolved === null) {
        // Leave unresolved wikilinks as-is
        return original;
      }

      return `[${displayText}](${resolved})`;
    },
  );
}
