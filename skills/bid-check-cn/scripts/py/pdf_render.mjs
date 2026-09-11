#!/usr/bin/env node
/**
 * bid-check-cn thin PDF render adapter (v3.3.0-pymupdf).
 *
 * Wraps scripts/py/pdf_inspect.py render. All PDF rendering delegated to PyMuPDF.
 *
 * Usage:
 *   node scripts/py/pdf_render.mjs <pdf_path> <pages_csv> <out_dir> [dpi]
 *
 * pages_csv example: "1,5,9" or "1-5" (range support) or mixed "1,3-7,12".
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const PYTHON_BIN = process.env.PYTHON_BIN
  || '<PYTHON_EXE>';
const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'pdf_inspect.py');

function usage() {
  console.log(JSON.stringify({ ok: false, error: 'usage: node scripts/py/pdf_render.mjs <pdf_path> <pages_csv> <out_dir> [dpi]' }, null, 2));
  process.exit(0);
}

function expandPages(csv) {
  const out = new Set();
  for (const tok of csv.split(",")) {
    const t = tok.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-").map(x => parseInt(x, 10));
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        for (let n = a; n <= b; n++) out.add(n);
      }
    } else {
      const n = parseInt(t, 10);
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return [...out].sort((x, y) => x - y);
}

const [pdfPath, pagesCsv, outDir, dpiArg] = process.argv.slice(2);
if (!pdfPath || !pagesCsv || !outDir) usage();

if (!fs.existsSync(pdfPath)) {
  console.log(JSON.stringify({ ok: false, error: `pdf not found: ${pdfPath}` }, null, 2));
  process.exit(0);
}
if (!fs.existsSync(SCRIPT)) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py missing: ${SCRIPT}` }, null, 2));
  process.exit(0);
}

const pageNums = expandPages(pagesCsv);
if (pageNums.length === 0) {
  console.log(JSON.stringify({ ok: false, error: `no valid page numbers in: ${pagesCsv}` }, null, 2));
  process.exit(0);
}

const dpi = dpiArg ? parseInt(dpiArg, 10) : 150;
if (!Number.isFinite(dpi) || dpi < 50 || dpi > 600) {
  console.log(JSON.stringify({ ok: false, error: `invalid dpi: ${dpiArg}` }, null, 2));
  process.exit(0);
}

const r = spawnSync(PYTHON_BIN, [SCRIPT, 'render', pdfPath, pageNums.join(','), outDir, String(dpi)], { encoding: 'utf-8', timeout: 300000 });
let inspect;
try { inspect = JSON.parse(r.stdout); } catch (e) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py returned non-JSON: ${r.stdout.slice(0,200)} stderr=${r.stderr.slice(0,200)}` }, null, 2));
  process.exit(0);
}

if (!inspect || inspect.ok !== true) {
  console.log(JSON.stringify({ ok: false, error: inspect?.error || 'pdf_inspect.py returned ok=false', rendered: [], failures: [], total_bytes: 0 }, null, 2));
  process.exit(0);
}

const totalBytes = (inspect.rendered || []).reduce((s, x) => s + (x.bytes || 0), 0);
const out = {
  ok: true,
  pdf_path: path.resolve(pdfPath),
  out_dir: path.resolve(outDir),
  dpi,
  requested_pages: pageNums,
  rendered: inspect.rendered || [],
  failures: inspect.failures || [],
  total_bytes: totalBytes,
  total_mb: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
};
console.log(JSON.stringify(out, null, 2));