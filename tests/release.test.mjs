import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVersion, publicationState, releaseTag } from '../scripts/release-lib.mjs';

test('first publication and automatic patch increments ignore unrelated tags', () => {
  assert.equal(selectVersion({}, [], 'a'), '0.1.0');
  assert.equal(selectVersion({ versions: { '0.1.9': {}, '0.1.10': {} } }, [{ name: 'v0.1.11', sha: 'b' }], 'a'), '0.1.12');
  assert.equal(selectVersion({}, [{ name: 'v-next', sha: 'b' }], 'a'), '0.1.0');
});
test('reserved versions survive failures and repeated runs', () => {
  const reservation = [{ name: 'v0.1.0', sha: 'a' }];
  assert.equal(selectVersion({}, reservation, 'a'), '0.1.0');
  assert.equal(publicationState({}, '0.1.0', 'a'), 'unpublished');
  assert.equal(selectVersion({}, reservation, 'b'), '0.1.1');
  const metadata = { versions: { '0.1.0': { sidSourceCommit: 'a' } } };
  assert.equal(publicationState(metadata, '0.1.0', 'a'), 'published');
  assert.equal(selectVersion(metadata, reservation, 'a'), '0.1.0');
  assert.equal(selectVersion(metadata, [], 'a'), '0.1.0');
  assert.throws(() => publicationState(metadata, '0.1.0', 'b'), /another source/);
  assert.throws(() => selectVersion({}, [...reservation, { name: 'v0.1.1', sha: 'a' }], 'a'), /Multiple/);
});
test('overlapping pushes reserve distinct versions and delayed runs cannot regress latest', () => {
  const lineage = ['a', 'b', 'c'];
  const ancestor = (a, b) => lineage.indexOf(a) < lineage.indexOf(b);
  assert.equal(releaseTag(undefined, 'a', ancestor), 'latest');
  assert.equal(releaseTag('a', 'b', ancestor), 'latest');
  assert.equal(releaseTag('c', 'b', ancestor), 'revision-b');
  assert.equal(releaseTag('b', 'b', ancestor), 'latest');
  assert.throws(() => releaseTag('foreign', 'a', () => false), /unrelated/);
  const reservations = [{ name: 'v0.1.0', sha: 'a' }, { name: 'v0.1.1', sha: 'c' }];
  assert.equal(selectVersion({}, reservations, 'b'), '0.1.2');
});
