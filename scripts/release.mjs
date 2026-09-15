import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE, selectVersion, publicationState, releaseTag } from "./release-lib.mjs";

const mode = process.argv[2];
if (!["prepare", "publish"].includes(mode)) throw new Error("Usage: node scripts/release.mjs prepare|publish");
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const sha = run("git", ["rev-parse", "HEAD"]);
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha) throw new Error("Checkout must match the triggering source SHA");
if (process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_EVENT_NAME !== "push") throw new Error("Releases require a push to main");
async function registry() {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE)}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
  return response.json();
}
run("git", ["fetch", "origin", "--tags"]);
const records = run("git", ["tag", "--list", "v*"]).split("\n").filter(Boolean)
  .map(name => ({ name, sha: run("git", ["rev-list", "-n", "1", name]) }));
const metadata = await registry();
if (mode === "prepare") {
  const version = selectVersion(metadata, records, sha);
  publicationState(metadata, version, sha);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  Object.assign(pkg, { version, sidSourceCommit: sha });
  writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  console.log(`Prepared ${PACKAGE}@${version} from ${sha}`);
} else {
  const { version, sidSourceCommit } = JSON.parse(readFileSync("package.json", "utf8"));
  if (sidSourceCommit !== sha || version !== selectVersion(metadata, records, sha)) throw new Error("Release version or source changed after preparation");
  const tarball = resolve(`.artifacts/${PACKAGE.replace("@", "").replace("/", "-")}-${version}.tgz`);
  const reserved = records.find(record => record.name === `v${version}`);
  if (reserved && reserved.sha !== sha) throw new Error("Release tag belongs to another source SHA");
  if (!reserved) {
    run("git", ["tag", "-a", `v${version}`, sha, "-m", `Reserve ${PACKAGE}@${version} for ${sha}`]);
    run("git", ["push", "origin", `refs/tags/v${version}`]);
  }
  if (publicationState(metadata, version, sha) === "unpublished") {
    const latestVersion = metadata["dist-tags"]?.latest;
    const latest = latestVersion && metadata.versions?.[latestVersion];
    const latestSha = latest && (latest.sidSourceCommit ?? latest.gitHead);
    if (latest && !latestSha) throw new Error("Latest release has no source SHA; cannot safely update latest");
    const isAncestor = (a, b) => {
      const result = spawnSync("git", ["merge-base", "--is-ancestor", a, b]);
      if (result.status !== 0 && result.status !== 1) throw new Error("Cannot determine release ancestry");
      return result.status === 0;
    };
    const tag = releaseTag(latestSha, sha, isAncestor);
    // Select the dist-tag as part of npm publish: OIDC does not authorize npm dist-tag.
    execFileSync("npm", ["publish", tarball, "--access", "public", "--provenance", "--tag", tag], { stdio: "inherit" });
  } else console.log(`${PACKAGE}@${version} already published from this SHA; recovering GitHub release`);
  mkdirSync(".artifacts", { recursive: true });
  const notes = `.artifacts/release-notes.md`;
  writeFileSync(notes, `${PACKAGE}@${version}\n\nSource: https://github.com/sidhq/sid-typescript/commit/${sha}\n\nInstall: \`npm install ${PACKAGE}@${version}\`\n`);
  const existing = spawnSync("gh", ["release", "view", `v${version}`], { stdio: "ignore" });
  if (existing.status !== 0) run("gh", ["release", "create", `v${version}`, "--verify-tag", "--title", `v${version}`, "--notes-file", notes, "--latest=false"]);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published **${PACKAGE}@${version}** from \`${sha}\`.\n`);
}
