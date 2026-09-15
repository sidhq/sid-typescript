# SID SDK for TypeScript

`@sid-ai/sid-sdk` turns search results into compact, model-facing document views.
It assigns stable short IDs, selects relevant snippets, tracks character ranges
already shown, masks repeated text, and renders SID's `<doc>` format.

Node.js 22+ is supported through ESM and CommonJS. The snippet engine is already
compiled and bundled in the npm package. Installation requires no compiler,
additional runtime, or separate build step. Browser and shared-memory
worker-thread caches are not supported.

## Installation and use

```sh
npm install @sid-ai/sid-sdk
```

```ts
import { DocumentCache } from '@sid-ai/sid-sdk';

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

CommonJS: `const { DocumentCache } = require('@sid-ai/sid-sdk')`.
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
the shared stored objects; avoid modifying them after recording
seen ranges. Display fields default to all document keys, so keep private fields
out of the record or pass an explicit list. The seen ledger is keyed by document
ID: use one content field per document when tracking seen text.

## Character ranges and language support

Ranges are half-open **Unicode code-point offsets**. These differ from the UTF-16
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

## Rendering

XML preserves SID's model-facing format: escape `&`, `<`, and `>`; leave quotes
unchanged; omit falsy attributes; write integers unquoted. This is the SID
observation format and is not general-purpose XML serialization. Lists join
with commas, booleans render as `True`/`False`, and `null` renders as `None` in
Markdown. JavaScript-only values and nested objects use JavaScript `String()`;
integral numbers render as integers because JavaScript does not distinguish
`1` from `1.0`. Use strings for custom metadata representations. Default field
order follows JavaScript key ordering; pass `displayFields` for explicit order.

Seeded ID streams are reproducible within this SDK. Forks share one collision-free
ID stream. Invalid input throws `TypeError` or `RangeError`; document lookup
failures throw `Error`.

## Contributing

See the [contributor guide](https://github.com/sidhq/sid-typescript/blob/main/CONTRIBUTING.md)
for source builds, testing, and release maintenance.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for copyright and third-party dependency notices.
