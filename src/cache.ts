import { IdStream } from "./id-stream";
import { insertInterval, overlaps, planSegments } from "./intervals";
import { CodePointText, positiveInteger, resolveRange, validateRangeMode, type CharacterRange, type RangeMode } from "./ranges";
import { DocumentView, DocumentViewWithSnippet, field, type Document } from "./rendering";
import { bm25SnippetWithStride, validateLanguage, type Language } from "./snippet";

export const SNIPPET_SIZE_DEFAULT = 50;
export const MIN_SEEN_OVERLAP_DEFAULT = 100;
export interface DocumentCacheOptions { language?: Language; rangeMode?: RangeMode }
export interface ApplySnippetOptions {
  snippetField: string; query: string; snippetSize?: number; minSeenOverlap?: number;
  displayFields?: readonly string[]; language?: Language;
}
export interface SingleSpanOptions {
  snippetField?: string; snippetDisplaySpan?: CharacterRange; displayFields?: readonly string[];
}
interface Family<T extends Document> {
  documents: Map<string, T>; toData: Map<string, string>; toModel: Map<string, string>; ids: IdStream;
}

export class DocumentCache<T extends Document = Document> {
  readonly language: Language;
  readonly rangeMode: RangeMode;
  readonly seenLedger = new Map<string, CharacterRange[]>();
  private family: Family<T>;
  constructor({ language = "english", rangeMode = "lenient" }: DocumentCacheOptions = {}) {
    this.language = validateLanguage(language);
    this.rangeMode = validateRangeMode(rangeMode);
    this.family = { documents: new Map(), toData: new Map(), toModel: new Map(), ids: new IdStream() };
  }
  addDocument(dataId: string, document: T): string {
    if (typeof dataId !== "string") throw new TypeError("dataId must be a string");
    const existing = this.family.toModel.get(dataId);
    if (existing !== undefined) {
      if (!this.seenLedger.has(dataId)) this.seenLedger.set(dataId, []);
      return existing;
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) throw new TypeError("document must be a record");
    const stored = structuredClone(document);
    const modelId = this.family.ids.mint();
    this.family.documents.set(dataId, stored);
    this.family.toModel.set(dataId, modelId);
    this.family.toData.set(modelId, dataId);
    this.seenLedger.set(dataId, []);
    return modelId;
  }
  contains(dataId: string): boolean { return this.family.documents.has(dataId); }
  containsModelFacingId(modelId: string): boolean { return this.family.toData.has(modelId); }
  toDataId(modelId: string): string {
    const id = this.family.toData.get(modelId);
    if (id === undefined) throw new Error(`modelFacingId ${JSON.stringify(modelId)} not found in cache`);
    return id;
  }
  toModelFacingId(dataId: string): string {
    const id = this.family.toModel.get(dataId);
    if (id === undefined) throw new Error(`dataId ${JSON.stringify(dataId)} not found in cache`);
    return id;
  }
  getDocument(dataId: string): T {
    const doc = this.family.documents.get(dataId);
    if (doc === undefined) throw new Error(`dataId ${JSON.stringify(dataId)} not found in the document cache`);
    return doc;
  }
  getDocumentFromModelFacingId(modelId: string): T { return this.getDocument(this.toDataId(modelId)); }
  private content(dataId: string, snippetField: string): string {
    const value = field(this.getDocument(dataId), snippetField);
    if (typeof value !== "string" || !value) throw new TypeError(`snippet field ${JSON.stringify(snippetField)} must be a non-empty string`);
    return value;
  }
  resolveCharRange(dataId: string, snippetField: string, range: CharacterRange): CharacterRange {
    return resolveRange(range, new CodePointText(this.content(dataId, snippetField)).length, this.rangeMode, dataId);
  }
  /** Override in a subclass to select a different span. Returned spans are strictly validated. */
  snippetFn(query: string, content: string, snippetSize: number, language: Language): CharacterRange {
    return bm25SnippetWithStride(query, content, { windowSize: snippetSize, stride: Math.max(1, Math.floor(snippetSize / 5)), language });
  }
  applySnippet(dataId: string, { snippetField, query, snippetSize = SNIPPET_SIZE_DEFAULT,
    minSeenOverlap = MIN_SEEN_OVERLAP_DEFAULT, displayFields, language = this.language }: ApplySnippetOptions): DocumentViewWithSnippet<T> {
    const document = this.getDocument(dataId), content = this.content(dataId, snippetField);
    const fields = displayFields ?? Object.keys(document);
    if (!fields.includes(snippetField)) throw new RangeError(`snippet field ${JSON.stringify(snippetField)} must be in displayFields`);
    positiveInteger(snippetSize, "snippetSize");
    if (!Number.isSafeInteger(minSeenOverlap) || minSeenOverlap < 0) throw new RangeError("minSeenOverlap must be a nonnegative safe integer");
    const span = resolveRange(this.snippetFn(query, content, snippetSize, validateLanguage(language)), new CodePointText(content).length, "strict", dataId);
    const seen = this.seenLedger.get(dataId) ?? [];
    const overlap = overlaps(span, seen);
    const fullySeen = overlap.length === 1 && overlap[0]![0] === span[0] && overlap[0]![1] === span[1];
    const [shown, masked] = fullySeen ? [[], [span]] : planSegments(span, seen, minSeenOverlap);
    return new DocumentViewWithSnippet(dataId, this.toModelFacingId(dataId), document, snippetField, masked, shown, fields);
  }
  getSingleSpanDocumentView(dataId: string, options: SingleSpanOptions & { snippetField: string }): DocumentViewWithSnippet<T>;
  getSingleSpanDocumentView(dataId: string, options?: SingleSpanOptions): DocumentView<T>;
  getSingleSpanDocumentView(dataId: string, { snippetField, snippetDisplaySpan, displayFields }: SingleSpanOptions = {}): DocumentView<T> {
    const document = this.getDocument(dataId), modelId = this.toModelFacingId(dataId);
    if (snippetField === undefined) {
      if (displayFields === undefined) throw new TypeError("displayFields is required when snippetField is omitted");
      return new DocumentView(dataId, modelId, document, displayFields);
    }
    const content = this.content(dataId, snippetField);
    const span: CharacterRange = snippetDisplaySpan === undefined ? [0, new CodePointText(content).length]
      : this.resolveCharRange(dataId, snippetField, snippetDisplaySpan);
    return new DocumentViewWithSnippet(dataId, modelId, document, snippetField, [], [span], displayFields ?? Object.keys(document));
  }
  updateSeen(view: DocumentView): void {
    this.getDocument(view.dataId);
    let seen = this.seenLedger.get(view.dataId) ?? [];
    for (const span of view.snippetDisplaySpans) seen = insertInterval(seen, span);
    this.seenLedger.set(view.dataId, seen);
  }
  fork(n: number): DocumentCache<T>[] {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("fork count must be a nonnegative safe integer");
    return Array.from({ length: n }, () => {
      const child = new DocumentCache<T>({ language: this.language, rangeMode: this.rangeMode });
      child.family = this.family;
      for (const [id, spans] of this.seenLedger) child.seenLedger.set(id, spans.map(([a, b]) => [a, b]));
      return child;
    });
  }
}
