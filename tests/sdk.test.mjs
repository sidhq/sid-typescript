import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sdk from '../dist/esm/index.js';
import intervals from '../dist/cjs/intervals.js';

const make = (content = 'aaaa bbbb cccc dddd', options) => {
  const cache = new sdk.DocumentCache(options);
  cache.addDocument('d', { title: 'T', content });
  return cache;
};
const view = (cache, span) => cache.getSingleSpanDocumentView('d', { snippetField: 'content', snippetDisplaySpan: span });

test('insertion copies once, is idempotent, and maintains inverse mappings', () => {
  const c = new sdk.DocumentCache();
  const input = { content: 'text', nested: { value: 1 } };
  const id = c.addDocument('d', input);
  input.nested.value = 2;
  assert.equal(c.getDocument('d').nested.value, 1);
  assert.equal(c.addDocument('d', { get content() { throw Error('must not inspect'); } }), id);
  assert.equal(c.toDataId(id), 'd');
  assert.equal(c.toModelFacingId('d'), id);
  assert.equal(c.getDocumentFromModelFacingId(id), c.getDocument('d'));
  assert(c.contains('d') && c.containsModelFacingId(id));
  assert(!c.contains('ghost') && !c.containsModelFacingId('ghost'));
  assert.throws(() => c.getDocument('ghost'));
  assert.throws(() => c.toDataId('ghost'));
});

test('fork family shares additions and isolates copied seen ledgers', () => {
  const c = make(); c.updateSeen(view(c, [0, 4]));
  const [a, b] = c.fork(2);
  const newId = a.addDocument('new', { content: 'new document' });
  assert.equal(b.toDataId(newId), 'new');
  assert.equal(b.getDocument('new'), c.getDocument('new'));
  a.updateSeen(view(a, [5, 9]));
  assert.deepEqual(c.seenLedger.get('d'), [[0, 4]]);
  assert.deepEqual(b.seenLedger.get('d'), [[0, 4]]);
  assert.deepEqual(a.seenLedger.get('d'), [[0, 4], [5, 9]]);
  assert.equal(new sdk.DocumentCache({ language: 'swedish', rangeMode: 'strict' }).fork(1)[0].language, 'swedish');
  assert.throws(() => c.fork(-1));
});

test('range policies preserve exact code-point slices', () => {
  const c = make('😀alpha e\u0301 tail');
  assert.deepEqual(c.resolveCharRange('d', 'content', [-3, 100]), [0, 14]);
  assert.match(view(c, [1, 4]).renderXml(), /#1:4" doc_length=14 title="T">\n\.\.\. alp \.\.\./);
  for (const span of [[2, 2], [5, 2], [99, 100], [-5, -1], [0.1, 2], [true, 2], [0, Infinity], [0], null]) {
    assert.throws(() => c.resolveCharRange('d', 'content', span), sdk.InvalidCharacterRange);
  }
  const strict = make('short', { rangeMode: 'strict' });
  assert.throws(() => strict.resolveCharRange('d', 'content', [-1, 3]), sdk.InvalidCharacterRange);
  assert.throws(() => strict.resolveCharRange('d', 'content', [1, 9]), sdk.InvalidCharacterRange);
  assert.deepEqual(strict.resolveCharRange('d', 'content', [1, 4]), [1, 4]);
});

test('rendering, pure repeats, XML conventions, Markdown and explicit fields', () => {
  const c = make(); const id = c.toModelFacingId('d');
  assert.equal(view(c).renderXml(), `<doc id="${id}" doc_length=19 title="T">\naaaa bbbb cccc dddd\n</doc>`);
  assert.equal(view(c, [5, 9]).renderXml(), `<doc id="${id}#5:9" doc_length=19 title="T">\n... bbbb ...\n</doc>`);
  c.updateSeen(view(c));
  const repeat = c.applySnippet('d', { snippetField: 'content', query: 'aaaa' });
  assert.deepEqual(repeat.snippetDisplaySpans, []);
  assert.equal(repeat.renderParts().body, '[seen: "#0:19"]');
  assert.throws(() => c.getSingleSpanDocumentView('d'), /displayFields/);
  const attrs = c.getSingleSpanDocumentView('d', { displayFields: ['title'] });
  c.updateSeen(attrs);
  assert.deepEqual(c.seenLedger.get('d'), [[0, 19]]);
  assert.equal(sdk.renderMarkdownTable([]), '');
  const d = new sdk.DocumentCache();
  d.addDocument('d', { title: 'A "quote" <b> &', tags: ['x', 'y'], zero: 0, no: false, yes: true, empty: [], content: 'x|y\nz' });
  const xml = view(d).renderXml();
  assert.match(xml, /title="A "quote" &lt;b&gt; &amp;" tags="x, y" yes=True/);
  assert(!xml.includes('zero=') && !xml.includes('empty='));
  assert.match(sdk.renderMarkdownTable([view(d)]), /0 \| False \| True/);
  assert.match(sdk.renderMarkdownTable([view(d)]), /x\\\|y z/);
});

test('reference grammar includes Unicode decimal digits and rejects malformed refs', () => {
  assert.deepEqual(sdk.parseRenderedModelFacingId('abcde'), ['abcde', null]);
  assert.deepEqual(sdk.parseRenderedModelFacingId('a# -5: ١٠'), ['a', [-5, 10]]);
  for (const ref of ['', null, '#1:2', 'a#', 'a#x:y', 'a#1:2:3', 'a#1:2#3:4', 'a#2:2', 'a#+1:2', 'a#1_0:20', 'a#1.0:2', 'a#1:9007199254740992']) {
    assert.throws(() => sdk.parseRenderedModelFacingId(ref));
  }
});

test('ID stream is a reproducible full permutation with loud exhaustion', () => {
  const stream = new sdk.IdStream({ alphabet: 'ab', length: 3, seed: 7 });
  const indexed = Array.from({ length: 8 }, (_, i) => stream.at(i));
  assert.equal(stream.minted, 0n);
  assert.equal(new Set(indexed).size, 8);
  assert.deepEqual(Array.from({ length: 8 }, () => stream.next().value), indexed);
  assert.equal(stream.remaining, 0n);
  assert.throws(() => stream.next(), sdk.IdSpaceExhausted);
  assert.throws(() => stream.at(-1));
  const a = new sdk.IdStream({ seed: 42 }), b = new sdk.IdStream({ seed: 42 });
  for (let i = 0; i < 100; i++) assert.equal(a.mint(), b.mint());
  for (const alphabet of ['', 'abca', 'a#', 'a:']) assert.throws(() => new sdk.IdStream({ alphabet }));
  const singleton = new sdk.IdStream({ alphabet: 'a', length: 1 });
  assert.equal(singleton.mint(), 'a');
  assert.throws(() => singleton.mint(), sdk.IdSpaceExhausted);
});

test('randomized interval union and segment partitions match a character-set oracle', () => {
  let seed = 13;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let round = 0; round < 300; round++) {
    let ledger = []; const expected = new Set();
    for (let i = 0; i < 10; i++) {
      const a = random(100), b = a + 1 + random(20);
      ledger = intervals.insertInterval(ledger, [a, b]);
      for (let j = a; j < b; j++) expected.add(j);
    }
    const actual = new Set(ledger.flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i)));
    assert.deepEqual(actual, expected);
    const a = random(100), b = a + 1 + random(40);
    const [display, seen] = intervals.planSegments([a, b], ledger, 5);
    let cursor = a;
    for (const [x, y] of [...display, ...seen].sort((left, right) => left[0] - right[0])) { assert.equal(x, cursor); cursor = y; }
    assert.equal(cursor, b);
    for (const [x, y] of seen) { assert(y - x >= 5); for (let i = x; i < y; i++) assert(expected.has(i)); }
  }
});

test('Python-generated snippet and rendering fixtures match WASM and TypeScript', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/python-parity.json', import.meta.url)));
  for (const item of fixtures.snippets) {
    assert.deepEqual(sdk.bm25SnippetWithStride(item.query, item.content, item.options), item.span, item.name);
  }
  for (const item of fixtures.views) {
    const c = new sdk.DocumentCache(item.cacheOptions);
    const id = c.addDocument('d', item.document);
    for (const span of item.seen) c.updateSeen(view(c, span));
    const v = item.apply ? c.applySnippet('d', item.options) : c.getSingleSpanDocumentView('d', item.options);
    assert.equal(v.renderXml().replaceAll(id, 'DOCID'), item.xml, item.name);
    assert.equal(sdk.renderMarkdownTable([v]).replaceAll(id, 'DOCID'), item.markdown, item.name);
    assert.deepEqual(v.snippetDisplaySpans, item.displaySpans, item.name);
  }
});

test('snippet validation and override boundaries fail clearly', () => {
  assert.throws(() => new sdk.DocumentCache({ language: 'klingon' }), /supported values/);
  assert.throws(() => new sdk.DocumentCache({ rangeMode: 'other' }));
  for (const options of [{ windowSize: 0 }, { stride: -1 }, { windowSize: 2 ** 32 }, { stride: NaN }]) assert.throws(() => sdk.bm25SnippetWithStride('q', 'text', options));
  assert.throws(() => sdk.bm25SnippetWithStride('q', '\ud800'));
  assert.throws(() => make('').applySnippet('d', { snippetField: 'content', query: 'q' }), /non-empty/);
  assert.throws(() => make().applySnippet('d', { snippetField: 'content', query: 'q', displayFields: ['title'] }), /displayFields/);
  class Broken extends sdk.DocumentCache { snippetFn() { return [0, 999]; } }
  const c = new Broken(); c.addDocument('d', { content: 'text' });
  assert.throws(() => c.applySnippet('d', { snippetField: 'content', query: 'q' }), sdk.InvalidCharacterRange);
});
