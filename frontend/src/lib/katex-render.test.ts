/**
 * Tests for renderMathString.
 *
 * [UPDATED v2 — B4] — covers the XSS sanitization guarantee: hostile prose
 * fragments authored by a (possibly compromised) reviewer must not survive
 * into the rendered HTML.
 */

import { describe, expect, it } from 'vitest';

import { renderMathString } from './katex-render';

describe('renderMathString — math segments', () => {
  it('renders inline $...$ via KaTeX', () => {
    const out = renderMathString('Find $2x + 1$ when ...');
    // KaTeX wraps in a span.katex
    expect(out).toContain('class="katex"');
  });

  it('renders display $$...$$ via KaTeX', () => {
    const out = renderMathString('Compute $$\\int x\\,dx$$');
    expect(out).toContain('katex-display');
  });

  it('passes through plain text unchanged when there is no math', () => {
    const out = renderMathString('Hello world');
    expect(out).toBe('Hello world');
  });
});

describe('renderMathString — XSS sanitization [v2 B4]', () => {
  it('strips <script> tags from non-math fragments', () => {
    const out = renderMathString('<script>alert(1)</script>2x + $\\frac{1}{2}$');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    // math still renders
    expect(out).toContain('class="katex"');
  });

  it('strips event-handler attributes (onerror, onclick)', () => {
    const out = renderMathString(
      '<img src=x onerror="fetch(\'/api/auth\')">2x + $1$',
    );
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('strips iframes', () => {
    const out = renderMathString(
      '<iframe src="https://evil.example/"></iframe> see $x$',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.example');
  });

  it('strips javascript: URLs', () => {
    const out = renderMathString(
      '<a href="javascript:alert(1)">click</a> then $y$',
    );
    expect(out).not.toContain('javascript:');
  });

  it('preserves allowed inline formatting (em, sup, sub)', () => {
    const out = renderMathString(
      'water is H<sub>2</sub>O and <em>important</em> $x$',
    );
    expect(out).toContain('<sub>2</sub>');
    expect(out).toContain('<em>important</em>');
  });

  it('handles multiple non-math segments interleaved with math', () => {
    const out = renderMathString(
      'a<script>x</script>b $1$ c<img src=x onerror=y>d $2$ e',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    // both maths rendered
    const occurrences = (out.match(/class="katex"/g) ?? []).length;
    expect(occurrences).toBe(2);
  });
});
