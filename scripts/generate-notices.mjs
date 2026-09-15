import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown'], { encoding: 'utf8' }));
const resolved = new Set(metadata.resolve.nodes.map(node => node.id));
const packages = metadata.packages.filter(pkg => pkg.source && resolved.has(pkg.id)).sort((a, b) => a.name.localeCompare(b.name));
let text = `# Third-party notices\n\nThe TypeScript cache, rendering, and Rust selector derive from\n[sidhq/sid-python](https://github.com/sidhq/sid-python) revision\n\`c25f9299a90d17735473ca401ae45fa4b41e25d8\`, under the MIT license\nin LICENSE. PyO3 is replaced by wasm-bindgen and is not bundled.\n\nThe WebAssembly engine uses Alyze 0.1.5. The locked Rust dependency graph,\nincluding build dependencies, is listed below with license notices from each\ncrate distribution. Regenerate with \`node scripts/generate-notices.mjs\`\nafter dependency updates. Rust's standard library is MIT OR Apache-2.0;\nsee https://github.com/rust-lang/rust/tree/1.88.0.\n\n`;
for (const pkg of packages) {
  const directory = dirname(pkg.manifest_path);
  const candidates = readdirSync(directory).filter(name => /^(licen[sc]e|copying|copyright)/i.test(name));
  if (pkg.license_file && !candidates.includes(pkg.license_file)) candidates.push(pkg.license_file);
  const files = candidates.filter(name => statSync(join(directory, name)).isFile());
  if (!files.length) throw new Error(`No license file found for ${pkg.name}`);
  text += `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? 'See license text'}.\n\n`;
  if (pkg.repository) text += `Source: ${pkg.repository}\n\n`;
  for (const name of files.sort()) text += `### ${name}\n\n\`\`\`text\n${readFileSync(join(directory, name), 'utf8').trim()}\n\`\`\`\n\n`;
}
writeFileSync('THIRD_PARTY_NOTICES.md', text.trimEnd() + '\n');
console.log(`Collected notices for ${packages.length} locked crates`);
