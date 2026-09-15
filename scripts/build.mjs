import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
if (execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim() !== "wasm-bindgen 0.2.100") {
  throw new Error("Build requires wasm-bindgen-cli 0.2.100 (matching Cargo.toml)");
}
rmSync("dist", { recursive: true, force: true });
run("cargo", ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown"]);
run("wasm-bindgen", ["target/wasm32-unknown-unknown/release/sid_snippet_wasm.wasm", "--target", "nodejs", "--out-dir", "dist/wasm", "--out-name", "sid_snippet"]);
renameSync("dist/wasm/sid_snippet.js", "dist/wasm/sid_snippet.cjs");
rmSync("dist/wasm/sid_snippet.d.ts");
rmSync("dist/wasm/sid_snippet_bg.wasm.d.ts");
run(process.execPath, ["node_modules/typescript/bin/tsc"]);
writeFileSync("dist/cjs/package.json", '{"type":"commonjs"}\n');
mkdirSync("dist/esm", { recursive: true });
const require = createRequire(import.meta.url);
const names = Object.keys(require("../dist/cjs/index.js"));
writeFileSync("dist/esm/index.js", `export { ${names.join(", ")} } from "../cjs/index.js";\n`);
// The publish allowlist must not accidentally ship generated source maps or build files.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
console.log(`Built ${pkg.name}@${pkg.version} (CommonJS, ESM, types, WASM)`);
