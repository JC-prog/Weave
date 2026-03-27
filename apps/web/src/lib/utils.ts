import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a date string as a relative time (e.g. "2 hours ago", "yesterday").
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

/**
 * Debounce a function by the given delay in milliseconds.
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Count words in a markdown string (strips markdown syntax first).
 */
export function countWords(content: string): number {
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')       // code blocks
    .replace(/`[^`]+`/g, '')              // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')      // images
    .replace(/\[.*?\]\(.*?\)/g, ' ')      // links
    .replace(/#{1,6}\s/g, '')             // headings
    .replace(/[*_~`>#-]/g, '')            // formatting chars
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return 0
  return stripped.split(' ').filter(Boolean).length
}

/**
 * Generate a random hex colour.
 */
export function randomColor(): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#06b6d4',
    '#3b82f6', '#a855f7',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

/**
 * Truncate a string to the given length, appending "…" if needed.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + '…'
}

/**
 * Extract the first N characters of meaningful text from markdown.
 */
export function extractExcerpt(markdown: string, maxLength = 160): string {
  const text = markdown
    .replace(/^#+\s.+$/gm, '')           // headings
    .replace(/```[\s\S]*?```/g, '')       // code blocks
    .replace(/`[^`]+`/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  return truncate(text, maxLength)
}

/**
 * Slugify a string for URL use.
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
