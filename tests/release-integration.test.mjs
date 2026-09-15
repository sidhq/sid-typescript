import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('release CLI reserves tags, recovers failed publication, and finalizes partial success', { skip: process.platform === 'win32' }, () => {
  const temp = mkdtempSync(join(tmpdir(), 'sid-release-test-'));
  try {
    const repo = join(temp, 'repo'), remote = join(temp, 'remote.git'), bin = join(temp, 'bin');
    mkdirSync(repo); mkdirSync(bin);
    const registry = join(temp, 'registry.json'), log = join(temp, 'commands.jsonl'), releases = join(temp, 'releases.json');
    writeFileSync(registry, '{}'); writeFileSync(releases, '[]');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', PATH: `${bin}:${process.env.PATH}`, MOCK_REGISTRY: registry, MOCK_LOG: log, MOCK_RELEASES: releases, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push' };
    delete env.GITHUB_SHA;
    const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote); git('init', '-b', 'main');
    git('config', 'user.name', 'Release Test'); git('config', 'user.email', 'release@example.invalid');
    git('config', 'commit.gpgsign', 'false'); git('config', 'tag.gpgsign', 'false');
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@sidhq/sid-sdk', version: '0.1.0' }));
    git('add', '.'); git('commit', '-m', 'Initial source');
    git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
    const sha = git('rev-parse', 'HEAD'); env.GITHUB_SHA = sha;
    const mock = `#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {basename} from 'node:path';
const tool = basename(process.argv[1]); const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_LOG, JSON.stringify({tool,args})+'\\n');
if(tool==='npm' && args[0]==='publish') {
  if(process.env.MOCK_FAIL_PUBLISH==='1') process.exit(1);
  const pkg=JSON.parse(readFileSync('package.json'));
  const meta=JSON.parse(readFileSync(process.env.MOCK_REGISTRY));
  meta.versions ??= {}; meta['dist-tags'] ??= {};
  if(meta.versions[pkg.version]) process.exit(2);
  meta.versions[pkg.version]=pkg;
  meta['dist-tags'][args[args.indexOf('--tag')+1]]=pkg.version;
  writeFileSync(process.env.MOCK_REGISTRY,JSON.stringify(meta));
}
if(tool==='gh') {
  if(process.env.MOCK_FAIL_GH==='1') process.exit(1);
  const releases=JSON.parse(readFileSync(process.env.MOCK_RELEASES));
  if(args[1]==='view') process.exit(releases.includes(args[2])?0:1);
  if(args[1]==='create') { releases.push(args[2]); writeFileSync(process.env.MOCK_RELEASES,JSON.stringify(releases)); }
}
`;
    writeFileSync(join(bin, 'package.json'), '{"type":"module"}');
    for (const name of ['npm', 'gh']) { writeFileSync(join(bin, name), mock); chmodSync(join(bin, name), 0o755); }
    const preload = join(temp, 'registry.mjs');
    writeFileSync(preload, `import {readFileSync} from 'node:fs'; globalThis.fetch=async()=>new Response(readFileSync(process.env.MOCK_REGISTRY,'utf8'),{status:200});`);
    const script = resolve('scripts/release.mjs');
    const release = (mode, extras = {}) => spawnSync(process.execPath, ['--import', preload, script, mode], { cwd: repo, env: { ...env, ...extras }, encoding: 'utf8' });
    const success = result => assert.equal(result.status, 0, result.stderr + result.stdout);
    success(release('prepare'));
    assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'))).version, '0.1.0');
    assert.notEqual(release('publish', { MOCK_FAIL_PUBLISH: '1' }).status, 0);
    assert.equal(git('rev-list', '-n', '1', 'v0.1.0'), sha);
    assert.equal(git('ls-remote', '--tags', 'origin', 'refs/tags/v0.1.0^{}').split(/\s/)[0], sha);
    success(release('prepare'));
    assert.notEqual(release('publish', { MOCK_FAIL_GH: '1' }).status, 0);
    assert.equal(JSON.parse(readFileSync(registry)).versions['0.1.0'].sidSourceCommit, sha);
    success(release('prepare')); success(release('publish'));
    const calls = () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls().filter(call => call.tool === 'npm' && call.args[0] === 'publish').length, 2);
    assert.deepEqual(JSON.parse(readFileSync(releases)), ['v0.1.0']);
    git('checkout', '--', 'package.json');
    git('commit', '--allow-empty', '-m', 'Next source'); git('push', 'origin', 'main');
    env.GITHUB_SHA = git('rev-parse', 'HEAD');
    success(release('prepare')); success(release('publish'));
    assert.equal(JSON.parse(readFileSync(registry))['dist-tags'].latest, '0.1.1');
    // Recovering an older already-published revision never changes latest.
    git('checkout', '--', 'package.json'); git('checkout', sha); env.GITHUB_SHA = sha;
    success(release('prepare')); success(release('publish'));
    assert.equal(JSON.parse(readFileSync(registry))['dist-tags'].latest, '0.1.1');
    // A registry collision is an error, even on a retry with a matching Git tag.
    const conflict = JSON.parse(readFileSync(registry)); conflict.versions['0.1.0'].sidSourceCommit = 'foreign';
    writeFileSync(registry, JSON.stringify(conflict));
    assert.notEqual(release('prepare').status, 0);
    assert.notEqual(release('prepare', { GITHUB_REF: 'refs/heads/feature' }).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
