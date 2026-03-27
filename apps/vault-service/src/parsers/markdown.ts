import matter from 'gray-matter';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  wordCount: number;
}

// ─── parseMarkdown ────────────────────────────────────────────────────────────
/**
 * Parses a markdown string, extracting YAML frontmatter, body content, and
 * word count of the body.
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const parsed = matter(content, {
    excerpt: false,
    engines: {
      yaml: {
        parse: (str: string) => {
          // Use default YAML parsing but handle errors gracefully
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require('js-yaml').load(str) as Record<string, unknown>;
          } catch {
            return {};
          }
        },
        stringify: (obj: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require('js-yaml').dump(obj) as string;
        },
      },
    },
  });

  const body = parsed.content.trim();
  const wordCount = countWords(body);
  const frontmatter = (parsed.data as Record<string, unknown>) ?? {};

  return { frontmatter, body, wordCount };
}

// ─── countWords ───────────────────────────────────────────────────────────────
/**
 * Counts words in a string by splitting on whitespace after stripping
 * markdown syntax elements (headers, bold, italic, code blocks, links).
 */
function countWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  const stripped = text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Remove markdown links but keep link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove wikilinks but keep link title
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    // Remove markdown heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquote markers
    .replace(/^>\s*/gm, '')
    // Normalise whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length === 0) return 0;

  return stripped.split(' ').filter((word) => word.length > 0).length;
}

// ─── extractTitle ─────────────────────────────────────────────────────────────
/**
 * Extracts the title from markdown content.
 * Looks for the first H1 heading; falls back to the filename (without extension).
 */
export function extractTitle(content: string, filename?: string): string {
  // Try frontmatter title first via a light parse
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (fmMatch) {
    const titleMatch = /^title:\s*['"]?(.+?)['"]?\s*$/m.exec(fmMatch[1] ?? '');
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }
  }

  // Look for the first H1 in the body
  const h1Match = /^#\s+(.+)$/m.exec(content);
  if (h1Match?.[1]) {
    return h1Match[1].trim();
  }

  // Fall back to filename (strip extension)
  if (filename) {
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
  }

  return 'Untitled';
}

// ─── slugify ──────────────────────────────────────────────────────────────────
/**
 * Converts a title to a URL-safe slug.
 * e.g. "Hello World! (2024)" → "hello-world-2024"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD') // decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // remove accent marks
    .replace(/[^\w\s-]/g, '') // remove non-word chars except hyphens
    .replace(/[\s_]+/g, '-') // replace spaces/underscores with hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}
