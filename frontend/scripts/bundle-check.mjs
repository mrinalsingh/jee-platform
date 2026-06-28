#!/usr/bin/env node
/**
 * Bundle-size CI gate for the test runtime route.
 * [UPDATED v2 — M10]
 *
 * PRD-16 §5.1 caps the `/test/[sessionId]` route at 200 KB gzipped.
 *
 * Strategy (works with Next 16 + Turbopack):
 *   1. Read the per-route manifest at
 *      `.next/server/app/test/[sessionId]/page/build-manifest.json`.
 *   2. Collect every chunk path in `rootMainFiles` + `polyfillFiles` +
 *      `lowPriorityFiles` (these are the JS the browser pulls for this
 *      route). Resolve them under `.next/`.
 *   3. Sum gzip(file) sizes via Node's built-in zlib. Fail the CI step
 *      if the total exceeds the cap.
 *
 * We deliberately use Node's stdlib instead of a third-party tool so the
 * gate has zero runtime dependencies — keeps the CI image small and the
 * check deterministic. The KB cap is configurable via BUNDLE_MAX_KB.
 *
 * Usage:
 *   npm run build              # produce .next
 *   npm run bundle-check       # gate
 *
 * Exit code 0 on pass, 1 on fail (over budget), 2 on missing artifacts.
 * Prints a per-chunk breakdown.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const MAX_KB = Number(process.env.BUNDLE_MAX_KB ?? '200');
const ROUTE_PATH = 'test/[sessionId]'; // Next maps this to the runtime route
const MANIFEST_PATH = join(
  ROOT,
  '.next',
  'server',
  'app',
  ROUTE_PATH,
  'page',
  'build-manifest.json',
);

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await fileExists(MANIFEST_PATH))) {
    console.error(
      `[bundle-check] no manifest at ${MANIFEST_PATH}. Did you run \`next build\` first?`,
    );
    process.exit(2);
  }
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const chunks = [
    ...(manifest.rootMainFiles ?? []),
    ...(manifest.polyfillFiles ?? []),
    ...(manifest.lowPriorityFiles ?? []),
  ];
  if (chunks.length === 0) {
    console.error(
      `[bundle-check] no chunks listed in manifest for route ${ROUTE_PATH}.`,
    );
    process.exit(2);
  }
  let totalGz = 0;
  const rows = [];
  for (const rel of chunks) {
    const absPath = join(ROOT, '.next', rel);
    if (!(await fileExists(absPath))) {
      // Some manifest entries reference virtual chunks; skip them.
      continue;
    }
    const buf = await readFile(absPath);
    const gz = gzipSync(buf).length;
    totalGz += gz;
    rows.push({ rel, raw: buf.length, gz });
  }
  rows.sort((a, b) => b.gz - a.gz);
  console.log(
    `\n[bundle-check] route /${ROUTE_PATH} — ${rows.length} chunks, cap ${MAX_KB} KB gz`,
  );
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(
      `  ${(r.gz / 1024).toFixed(1).padStart(7)} KB gz  ` +
        `  ${(r.raw / 1024).toFixed(1).padStart(7)} KB raw   ${r.rel}`,
    );
  }
  console.log('-'.repeat(80));
  console.log(`  total gz: ${(totalGz / 1024).toFixed(1)} KB`);
  console.log(`  budget:   ${MAX_KB.toFixed(1)} KB`);
  const overBy = totalGz / 1024 - MAX_KB;
  if (overBy > 0) {
    console.error(
      `[bundle-check] FAIL — over budget by ${overBy.toFixed(1)} KB`,
    );
    process.exit(1);
  }
  console.log(
    `[bundle-check] OK — ${(MAX_KB - totalGz / 1024).toFixed(1)} KB headroom`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
