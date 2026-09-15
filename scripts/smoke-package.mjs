import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args, cwd) {
  return execFileSync(npm, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}
const root = process.cwd();
mkdirSync(".artifacts", { recursive: true });
const packed = process.argv[2] ? null : JSON.parse(run(["pack", "--json", "--pack-destination", ".artifacts"], root))[0];
if (packed) {
  const paths = packed.files.map(file => file.path);
  assert(paths.some(path => path.endsWith(".wasm")));
  assert(paths.some(path => path.endsWith(".d.ts")));
  for (const required of ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) assert(paths.includes(required), `Missing ${required}`);
  assert(paths.every(path => path.startsWith("dist/") || ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"].includes(path)), paths.join("\n"));
}
const tarball = resolve(process.argv[2] ?? `.artifacts/${packed.filename}`);
const directory = mkdtempSync(join(tmpdir(), "sid-package-"));
try {
  writeFileSync(join(directory, "package.json"), '{"private":true}\n');
  run(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], directory);
  const example = `
const assert = require('node:assert/strict');
const cache = new sdk.DocumentCache();
cache.addDocument('database-id', {title: 'Example', content: '😀 The complete document text'});
const view = cache.applySnippet('database-id', {snippetField: 'content', query: 'complete document'});
assert.match(view.renderXml(), /doc_length=28/);
cache.updateSeen(view);
assert.match(cache.applySnippet('database-id', {snippetField: 'content', query: 'complete'}).renderXml(), /seen:/);
const [fork] = cache.fork(1);
assert.equal(fork.getDocument('database-id'), cache.getDocument('database-id'));
`;
  writeFileSync(join(directory, "smoke.cjs"), `const sdk = require('@sid-ai/sid-sdk');\n${example}\n`);
  writeFileSync(join(directory, "smoke.mjs"), `import * as sdk from '@sid-ai/sid-sdk';\nimport {createRequire} from 'node:module';\nconst require = createRequire(import.meta.url);\n${example}\nassert.equal(sdk.DocumentCache, require('@sid-ai/sid-sdk').DocumentCache);\n`);
  for (const file of ["smoke.cjs", "smoke.mjs"]) execFileSync(process.execPath, [file], { cwd: directory, stdio: "inherit" });
  const typescript = join(root, "node_modules/typescript/bin/tsc");
  const consumer = `import { DocumentCache, type CharacterRange } from '@sid-ai/sid-sdk';
const cache = new DocumentCache<{content: string}>();
cache.addDocument('d', {content: 'text'});
const span: CharacterRange = cache.resolveCharRange('d', 'content', [0, 2]);
cache.getSingleSpanDocumentView('d', {snippetField: 'content', snippetDisplaySpan: span}).renderXml();
// @ts-expect-error unknown language
new DocumentCache({language: 'klingon'});
// @ts-expect-error query required
cache.applySnippet('d', {snippetField: 'content'});
`;
  for (const ext of ["mts", "cts"]) {
    writeFileSync(join(directory, `consumer.${ext}`), consumer);
    execFileSync(process.execPath, [typescript, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", `consumer.${ext}`], { cwd: directory, stdio: "inherit" });
  }
  console.log(`Package smoke tests passed: ${tarball}`);
} finally { rmSync(directory, { recursive: true, force: true }); }
