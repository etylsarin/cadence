import { marked } from 'marked'
import DOMPurify from 'dompurify'

/** Markdown → sanitised HTML for use with dangerouslySetInnerHTML. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }) as string)
}

/**
 * Prose classes that scale Tailwind Typography's defaults down to the app's
 * dense, small-type aesthetic — tighter headings, gray body tones, chip-style
 * inline code, slate code blocks. Pair with the container's own layout classes.
 */
export const markdownProseClass = [
  'prose prose-sm dark:prose-invert max-w-none',
  'prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-gray-100',
  'prose-h1:text-base prose-h1:mt-0 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-gray-200 dark:prose-h1:border-slate-700',
  'prose-h2:text-sm prose-h2:mt-6 prose-h2:mb-2',
  'prose-h3:text-[13px] prose-h3:mt-4 prose-h3:mb-1.5',
  'prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-p:my-2 prose-p:leading-relaxed',
  'prose-ul:my-2 prose-ol:my-2 prose-li:text-gray-600 dark:prose-li:text-gray-300 prose-li:my-0.5',
  'prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-strong:font-semibold',
  'prose-a:text-blue-600 dark:prose-a:text-blue-400',
  'prose-code:text-[12px] prose-code:font-medium prose-code:text-gray-800 dark:prose-code:text-gray-200 prose-code:bg-gray-100 dark:prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-slate-900 dark:prose-pre:bg-slate-950 prose-pre:text-xs prose-pre:rounded-lg prose-pre:border prose-pre:border-slate-800',
].join(' ')
