/** Half-open Unicode code-point offsets, matching Python string indices. */
export type CharacterRange = readonly [number, number];
export type RangeMode = "lenient" | "strict";

export class InvalidCharacterRange extends RangeError {
  override name = "InvalidCharacterRange";
}

export function validateRangeMode(mode: RangeMode): RangeMode {
  if (mode !== "lenient" && mode !== "strict") {
    throw new RangeError(`unsupported range mode ${String(mode)}; supported values: lenient, strict`);
  }
  return mode;
}

export function resolveRange(range: CharacterRange, length: number, mode: RangeMode, id: string): CharacterRange {
  const prefix = `invalid character range for document ${JSON.stringify(id)} (${length} characters): `;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger)) {
    throw new InvalidCharacterRange(prefix + "expected a (start, end) pair of safe integers");
  }
  const [start, end] = range;
  if (start >= end) throw new InvalidCharacterRange(prefix + `start ${start} must be less than end ${end}`);
  if (end <= 0 || start >= length) throw new InvalidCharacterRange(prefix + "the requested range does not overlap the document");
  if (mode === "strict" && (start < 0 || end > length)) {
    throw new InvalidCharacterRange(prefix + "range exceeds the document boundaries");
  }
  return [Math.max(0, start), Math.min(end, length)];
}

/** Build once per render; boundaries also preserve astral Unicode characters. */
export class CodePointText {
  private readonly boundaries: number[] = [0];
  constructor(readonly text: string) {
    let offset = 0;
    for (const char of text) {
      offset += char.length;
      this.boundaries.push(offset);
    }
  }
  get length(): number { return this.boundaries.length - 1; }
  slice(start: number, end: number): string { return this.text.slice(this.boundaries[start], this.boundaries[end]); }
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}
