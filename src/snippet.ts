import { positiveInteger, type CharacterRange } from "./ranges";

export const SUPPORTED_LANGUAGES = ["danish", "dutch", "english", "finnish", "french", "german", "generic", "hungarian", "italian", "norwegian", "portuguese", "russian", "spanish", "swedish"] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];
export interface SnippetOptions { windowSize?: number; stride?: number; language?: Language }
export function validateLanguage(language: Language): Language {
  if (!SUPPORTED_LANGUAGES.includes(language)) throw new RangeError(`unsupported language ${String(language)}; supported values: ${SUPPORTED_LANGUAGES.join(", ")}`);
  return language;
}
let engine: { bm25SnippetWithStride(query: string, content: string, size: number, stride: number, language: string): Uint32Array } | undefined;

export function bm25SnippetWithStride(query: string, content: string, { windowSize = 50, stride = 10, language = "english" }: SnippetOptions = {}): CharacterRange {
  if (typeof query !== "string" || typeof content !== "string") throw new TypeError("query and content must be strings");
  // wasm-bindgen encodes lone surrogates as U+FFFD; reject instead of silently changing source text.
  if (!isWellFormed(query) || !isWellFormed(content)) throw new TypeError("query and content must contain well-formed Unicode");
  positiveInteger(windowSize, "windowSize");
  positiveInteger(stride, "stride");
  if (windowSize > 0xffffffff || stride > 0xffffffff) throw new RangeError("windowSize and stride must fit unsigned 32-bit integers");
  validateLanguage(language);
  engine ??= require("../wasm/sid_snippet.cjs") as NonNullable<typeof engine>;
  const result = engine.bm25SnippetWithStride(query, content, windowSize, stride, language);
  return [result[0]!, result[1]!];
}

function isWellFormed(value: string): boolean {
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return false;
  }
  return true;
}
