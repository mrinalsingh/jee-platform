/**
 * KaTeX render helper.
 *
 * PRD §5.2 accessibility: `output: 'htmlAndMathml'` so screen readers can
 * announce math semantically.
 *
 * Statements use `$inline$` and `$$display$$` delimiters; this helper splits
 * a string into text + math segments and returns trustedly-rendered HTML.
 *
 * KaTeX's `throwOnError: false` makes a malformed problem render its source
 * in red rather than crash the runtime — defensive against bad bank entries.
 *
 * [UPDATED v2 — B4]
 * Security: every non-math fragment is DOMPurify-sanitized before insertion
 * into `dangerouslySetInnerHTML`. KaTeX's own HTML is trusted (KaTeX escapes
 * its TeX input) — we sanitize the in-between substrings only. This closes
 * the stored-XSS vector flagged by the Code Reviewer (e.g. a teacher-authored
 * statement embedding `<script>` or `<img onerror=...>`).
 */

import katex from 'katex';
import DOMPurify from 'isomorphic-dompurify';
import type { Config } from 'dompurify';

const SEGMENT_RE = /(\$\$[^$]+\$\$|\$[^$\n]+\$)/g;

// Allow lightweight inline formatting only. NO scripts/iframes/event handlers
// and NO style attribute. KaTeX uses <span class=...> which is allowed below.
const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'sub', 'sup', 'br', 'span'],
  ALLOWED_ATTR: ['class'],
  KEEP_CONTENT: true,
  // RETURN_TRUSTED_TYPE: false is the default; we cast the return below to
  // string explicitly (DOMPurify.sanitize's union type includes TrustedHTML
  // when called in a TrustedTypes-capable environment).
};

/**
 * Render a statement string that mixes plain prose and KaTeX-delimited math.
 * Non-math fragments are sanitized; math fragments are produced by KaTeX which
 * escapes its own input.
 *
 * [UPDATED v2 — B4]
 */
export function renderMathString(input: string): string {
  // Split first so we can sanitize ONLY the non-math segments. A single
  // .replace() callback (the v1 approach) returned KaTeX HTML that we cannot
  // re-sanitize without breaking KaTeX's required structure.
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(SEGMENT_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(sanitizeFragment(input.slice(lastIndex, start)));
    }
    parts.push(renderMathChunk(match[0]));
    lastIndex = start + match[0].length;
  }
  if (lastIndex < input.length) {
    parts.push(sanitizeFragment(input.slice(lastIndex)));
  }
  return parts.join('');
}

function renderMathChunk(chunk: string): string {
  const isDisplay = chunk.startsWith('$$') && chunk.endsWith('$$');
  const tex = isDisplay ? chunk.slice(2, -2) : chunk.slice(1, -1);
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: isDisplay,
      output: 'htmlAndMathml',
      strict: 'ignore',
    });
  } catch {
    return `<span class="text-red-600 font-mono">${escapeHtml(chunk)}</span>`;
  }
}

/**
 * Sanitize a between-math fragment (plain prose authored by reviewers/teachers).
 * Strips scripts, event handlers, javascript: URLs, etc.
 * [UPDATED v2 — B4]
 */
function sanitizeFragment(fragment: string): string {
  // The dompurify type signature returns `string | TrustedHTML` depending on
  // the runtime; in a non-TrustedTypes-capable environment it's always
  // `string`. Cast via `unknown` to placate the strict checker without
  // pulling in the TrustedTypes lib.
  return DOMPurify.sanitize(fragment, PURIFY_CONFIG) as unknown as string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
