# SID SDK for TypeScript

`@sidhq/sid-sdk` turns search results into compact, model-facing document views.
It assigns stable short IDs, selects relevant snippets, tracks character ranges
already shown, masks repeated text, and renders SID's `<doc>` format.

Node.js 22+ is supported through ESM and CommonJS. The package includes the Rust
snippet engine compiled to WebAssembly; installation needs no compiler and runs
no install scripts. Browser and shared-memory worker-thread caches are not supported.

## Installation and use

```sh
npm install @sidhq/sid-sdk
```

```ts
import { DocumentCache } from '@sidhq/sid-sdk';

const cache = new DocumentCache({ language: 'english' });
cache.addDocument('database-id', {
  title: 'Example',
  content: 'The complete document text ...',
});
const view = cache.applySnippet('database-id', {
  snippetField: 'content',
  query: 'complete document',
});
console.log(view.renderXml());
cache.updateSeen(view);
```

CommonJS: `const { DocumentCache } = require('@sidhq/sid-sdk')`.
All SDK methods are synchronous, including automatic WASM initialization on first
snippet selection. Both entry points share the same classes.

## API

- `new DocumentCache<T>({ language?, rangeMode? })`: defaults to English and lenient ranges.
- `addDocument(dataId, document)`: stores a `structuredClone` on first insertion and returns a stable five-letter ID. Re-adding an ID does not inspect or replace its document.
- `applySnippet(dataId, { snippetField, query, snippetSize?, minSeenOverlap?, displayFields?, language? })`: chooses a snippet and masks seen text. Defaults are 50 source tokens and 100 characters of minimum overlap.
- `getSingleSpanDocumentView(dataId, { snippetField?, snippetDisplaySpan?, displayFields? })`: displays an exact range, or the whole content when the range is omitted; ignores the seen ledger. Views without a snippet field require explicit display fields.
- `resolveCharRange(dataId, snippetField, [start, end])`: validates or clamps a model-provided range.
- `updateSeen(view)`: records only displayed spans. Render and update are separate operations.
- `fork(n)`: creates caches with shared documents, mappings, and ID stream, and independent copies of the parent's current seen ledger.
- `contains(dataId)`, `containsModelFacingId(modelId)`, `toDataId(modelId)`, `toModelFacingId(dataId)`, `getDocument(dataId)`, `getDocumentFromModelFacingId(modelId)`: lookups across a fork family; unknown IDs throw.
- `parseRenderedModelFacingId(reference)`: returns `[modelId, [start, end] | null]`.
- `renderMarkdownTable(views, displayFields?)`: tabular rendering of document views.
- `bm25SnippetWithStride(query, content, { windowSize?, stride?, language? })`: direct snippet helper, defaults to 50 tokens and stride 10.
- `IdStream({ alphabet?, length?, seed? })`: `mint()` returns an ID, `at(index)` does not consume it, and `next()` follows the iterator protocol. Exhaustion throws `IdSpaceExhausted`. Counters `space`, `minted`, and `remaining` are BigInts.

Document records can contain structured-cloneable values. Returned documents are
the shared stored objects, matching Python; avoid modifying them after recording
seen ranges. Display fields default to all document keys, so keep private fields
out of the record or pass an explicit list. The seen ledger is keyed by document
ID, matching Python: use one content field per document when tracking seen text.

## Character ranges and language support

Ranges are half-open **Unicode code-point offsets**, matching Python, not UTF-16
indices used by JavaScript `String.slice`. For example, `😀a` has two SDK
characters. Combining marks count separately. Rendered references and
`doc_length` use the same coordinate system.

Lenient mode intersects partially overlapping ranges with the document. Strict
mode requires `0 <= start < end <= document length`. Empty, inverted, malformed,
unsafe-integer, and wholly disjoint ranges throw `InvalidCharacterRange`. Ranges
are never expanded to word boundaries. The snippet engine rejects strings with
unpaired UTF-16 surrogates rather than silently replacing them.

Named languages are Danish, Dutch, English, Finnish, French, German, Hungarian,
Italian, Norwegian, Portuguese, Russian, Spanish, and Swedish. `generic` uses
lowercase Unicode UAX #29 tokenization without removing stopwords. Named
languages use Alyze's stopword lists; there is no stemming. A per-call `language`
overrides the cache default. Stopword-only queries select the earliest window.

## Python compatibility

The reference is [`sidhq/sid-python` at `c25f929`](https://github.com/sidhq/sid-python/tree/c25f9299a90d17735473ca401ae45fa4b41e25d8).
The Rust algorithm and Alyze 0.1.5 are retained. Tests include Python-generated
snippet offsets and exact XML/Markdown fixtures, including every language.

XML preserves SID's model-facing format: escape `&`, `<`, and `>`; leave quotes
unchanged; omit falsy attributes; write integers unquoted. This is the SID
observation format and is not general-purpose XML serialization. Lists join
with commas, booleans render as `True`/`False`, and `null` renders as `None` in
Markdown. JavaScript-only values and nested objects use JavaScript `String()`;
integral numbers render as integers because JavaScript does not distinguish
`1` from `1.0`. Use strings for custom metadata representations. Default field
order follows JavaScript key ordering; pass `displayFields` for explicit order.

Seeded ID streams are reproducible within this SDK but do not reproduce Python's
random seed expansion. Fork sharing and collision-free permutation semantics are
preserved. Invalid input throws `TypeError` or `RangeError`; document lookup
failures throw `Error`.

## Development

Install Node.js 22+ and Rust through rustup. The checked-in toolchain selects
Rust 1.88.0 and the WASM target.

```sh
cargo install wasm-bindgen-cli --version 0.2.100 --locked
npm ci
npm run check
```

The ignored `sid-python/` checkout is only a development reference. To regenerate
fixtures, check out the pinned revision, build its extension with the Python
project's development instructions, then run:

```sh
sid-python/.venv/bin/python scripts/generate-python-fixtures.py
```

Normal builds and CI require no Python checkout. `npm run test:package` installs
the tarball into a temporary directory with lifecycle scripts disabled, checks
both module formats, and compiles TypeScript consumers.

## Releases

Every successful push to `main` publishes its head revision, including documentation
changes. CI tests Node 22 and 24 on Linux, macOS, and Windows before publishing.
Versions begin at `0.1.0` and automatically increment the highest published or
reserved patch version. Versions change only in the release workspace; Git tags
identify source revisions, whose package manifest retains the development version.

The release queue serializes runs (up to GitHub's 100 pending-run limit). A `v*`
tag reserves a version for a SHA before publication. Rerun a failed workflow to
reuse that version and recover missing GitHub release metadata. Do not delete or
move reservation tags. Network, authorization, and version conflicts fail loudly.
An older delayed revision gets a `revision-<sha>` npm tag, so it cannot move
`latest` backward. npm publishing selects the tag directly and needs no separate
token-authorized `npm dist-tag` operation.

### One-time npm setup

1. Ensure the publishing account can create public packages in the `sidhq` npm organization.
2. Add a narrowly scoped, short-lived granular npm token as the repository/environment
   secret `NPM_TOKEN`, with creation/publish rights and any required 2FA bypass.
   Rerun the initial Release workflow to publish the fully tested `0.1.0` package.
3. In the npm package settings, configure a GitHub trusted publisher: organization
   `sidhq`, repository `sid-typescript`, workflow `release.yml`, environment `npm`.
   Allow direct `npm publish`. Avoid required environment approvals if releases
   should remain automatic.
4. Remove the bootstrap secret and revoke the token. Subsequent runs authenticate
   with GitHub OIDC and publish with provenance.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for the vendored Python/Rust reference and bundled Rust dependency notices.
