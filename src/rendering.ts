import { CodePointText, type CharacterRange } from "./ranges";

export type Document = Record<string, unknown>;
export function field(document: Document, key: string): unknown {
  if (!Object.hasOwn(document, key)) throw new Error(`document field ${JSON.stringify(key)} not found`);
  return document[key];
}
function scalar(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null) return "None";
  return String(value);
}
function stringify(value: unknown): string { return Array.isArray(value) ? value.map(scalar).join(", ") : scalar(value); }
function escape(value: unknown): string { return stringify(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function truthy(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.keys(value).length > 0;
  return true;
}
function decimal(value: string): number {
  // Python accepts Unicode decimal digits; normalize each Nd block to ASCII.
  let digits = "";
  for (const char of value) {
    if (char === "-") { digits += char; continue; }
    let first = char.codePointAt(0)!;
    while (first > 0 && /\p{Nd}/u.test(String.fromCodePoint(first - 1))) first--;
    digits += String((char.codePointAt(0)! - first) % 10);
  }
  const result = Number(digits);
  if (!Number.isSafeInteger(result)) throw new RangeError("character offsets must be safe integers");
  return result;
}

export function parseRenderedModelFacingId(reference: string): [string, CharacterRange | null] {
  if (typeof reference !== "string" || !reference) throw new TypeError("invalid document reference: expected a non-empty string");
  const hash = reference.indexOf("#");
  if (hash < 0) return [reference, null];
  if (hash === 0) throw new RangeError("invalid document reference: missing document id before '#'");
  const parts = reference.slice(hash + 1).split(":").map(part => part.trim());
  if (parts.length !== 2 || !parts.every(part => /^-?\p{Nd}+$/u.test(part))) throw new RangeError("invalid document reference: expected '<doc_id>#<start>:<end>' with decimal integer character offsets");
  const start = decimal(parts[0]!), end = decimal(parts[1]!);
  if (start >= end) throw new RangeError("invalid document reference: start must be < end");
  return [reference.slice(0, hash), [start, end]];
}

export interface RenderParts { id: string; attributes: Map<string, unknown>; body: string | null }

export class DocumentView<T extends Document = Document> {
  readonly snippetDisplaySpans: CharacterRange[] = [];
  constructor(readonly dataId: string, readonly modelFacingId: string, readonly document: T, readonly displayFields: readonly string[]) {}
  renderParts(displayFields: readonly string[] = this.displayFields): RenderParts {
    return { id: this.modelFacingId, attributes: new Map(displayFields.map(key => [key, field(this.document, key)])), body: null };
  }
  renderXml(): string {
    const { id, attributes, body } = this.renderParts();
    const parts = [`id="${escape(id)}"`];
    for (const [key, value] of attributes) {
      if (truthy(value)) parts.push(typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value))
        ? `${key}=${scalar(value)}` : `${key}="${escape(value)}"`);
    }
    const inner = body === null ? "" : `\n${escape(body)}\n`;
    return `<doc ${parts.join(" ")}>${inner}</doc>`;
  }
}

export class DocumentViewWithSnippet<T extends Document = Document> extends DocumentView<T> {
  constructor(dataId: string, modelFacingId: string, document: T,
    readonly snippetField: string, readonly snippetSeenSpans: CharacterRange[],
    snippetDisplaySpans: CharacterRange[], displayFields: readonly string[]) {
    super(dataId, modelFacingId, document, displayFields);
    this.snippetDisplaySpans.push(...snippetDisplaySpans);
  }
  override renderParts(displayFields: readonly string[] = this.displayFields): RenderParts {
    const content = field(this.document, this.snippetField);
    if (typeof content !== "string" || !content) throw new TypeError("snippet field must be a non-empty string");
    const text = new CodePointText(content);
    const segments = [
      ...this.snippetDisplaySpans.map(([a, b]) => ({ a, b, seen: false })),
      ...this.snippetSeenSpans.map(([a, b]) => ({ a, b, seen: true })),
    ].sort((left, right) => left.a - right.a);
    if (!segments.length) throw new RangeError("snippet view requires at least one span");
    const a = segments[0]!.a, b = segments.at(-1)!.b;
    const fullySeen = this.snippetDisplaySpans.length === 0;
    const body = (a > 0 && !fullySeen ? "... " : "")
      + segments.map(segment => segment.seen ? `[seen: "#${segment.a}:${segment.b}"]` : text.slice(segment.a, segment.b)).join("")
      + (b < text.length && !fullySeen ? " ..." : "");
    const id = this.modelFacingId + (!fullySeen && (a !== 0 || b !== text.length) ? `#${a}:${b}` : "");
    const attributes = new Map<string, unknown>([["doc_length", text.length]]);
    for (const key of displayFields) if (key !== this.snippetField) attributes.set(key, field(this.document, key));
    return { id, attributes, body };
  }
}

export function renderMarkdownTable(views: readonly DocumentView[], displayFields?: readonly string[]): string {
  if (views.length === 0) return "";
  const fields = displayFields ?? views[0]!.displayFields;
  const rows = views.map(view => {
    const { id, attributes, body } = view.renderParts(fields);
    const cells = new Map<string, unknown>([["id", id], ...attributes]);
    if (body !== null && view instanceof DocumentViewWithSnippet) cells.set(view.snippetField, body);
    return cells;
  });
  const columns = ["id", ...Array.from(rows[0]!.keys()).filter(key => key !== "id" && !fields.includes(key)), ...fields];
  const cell = (value: unknown): string => stringify(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${columns.join(" | ")} |`,
    `|${columns.map(key => "-".repeat(Array.from(key).length + 2)).join("|")}|`,
    ...rows.map(row => `| ${columns.map(key => cell(row.has(key) ? row.get(key) : "")).join(" | ")} |`),
  ].join("\n");
}
