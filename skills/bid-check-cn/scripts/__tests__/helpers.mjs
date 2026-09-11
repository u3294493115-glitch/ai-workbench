// T1-T10 共享 helper：执行 page_recon 或 read_qualification_library，断言输出
// 不引外部依赖；Node 24 内置即可

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..');
const FIXTURES_DIR = path.join(HERE, 'fixtures');

export function reconFor(fixtureName) {
  const outDir = path.join(FIXTURES_DIR, 'recon_out');
  fs.mkdirSync(outDir, { recursive: true });
  const script = path.join(SKILL_ROOT, 'scripts', 'pdf_page_recon.mjs');
  const r = spawnSync(process.execPath, [script, path.join(FIXTURES_DIR, fixtureName), outDir], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error('recon failed: ' + r.stderr);
  const recon = JSON.parse(fs.readFileSync(path.join(outDir, fixtureName.replace(/\.pdf$/, '.recon.json')), 'utf-8'));
  return recon;
}

export function libraryRead(libraryPath) {
  const script = path.join(SKILL_ROOT, 'scripts', 'read_qualification_library.mjs');
  const r = spawnSync(process.execPath, [script, libraryPath], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error('library read failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}

export function reportPass(id, message, detail) {
  return { id, state: 'PASS', message, detail };
}
export function reportFail(id, message, detail) {
  return { id, state: 'FAIL', message, detail };
}
export function reportNotProven(id, message, detail) {
  return { id, state: 'NOT_PROVEN', message, detail };
}

export { HERE, FIXTURES_DIR, SKILL_ROOT };
