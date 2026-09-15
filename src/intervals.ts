import type { CharacterRange } from "./ranges";

export function insertInterval(intervals: readonly CharacterRange[], range: CharacterRange): CharacterRange[] {
  let [a, b] = range;
  if (a >= b) throw new RangeError("cannot record an empty interval");
  const out: CharacterRange[] = [];
  for (const [x, y] of intervals) {
    if (y < a || x > b) out.push([x, y]);
    else { a = Math.min(a, x); b = Math.max(b, y); }
  }
  out.push([a, b]);
  return out.sort((left, right) => left[0] - right[0]);
}

export function overlaps(span: CharacterRange, intervals: readonly CharacterRange[]): CharacterRange[] {
  return intervals.flatMap(([x, y]) => {
    const a = Math.max(span[0], x), b = Math.min(span[1], y);
    return a < b ? [[a, b] as CharacterRange] : [];
  });
}

export function planSegments(span: CharacterRange, seen: readonly CharacterRange[], minimum: number): [CharacterRange[], CharacterRange[]] {
  const display: CharacterRange[] = [], masked: CharacterRange[] = [];
  function append(a: number, b: number): void {
    const last = display.at(-1);
    if (last?.[1] === a) display[display.length - 1] = [last[0], b];
    else display.push([a, b]);
  }
  let cursor = span[0];
  for (const [x, y] of overlaps(span, seen)) {
    if (x > cursor) append(cursor, x);
    if (y - x >= minimum) masked.push([x, y]);
    else append(x, y);
    cursor = y;
  }
  if (cursor < span[1]) append(cursor, span[1]);
  return [display, masked];
}
