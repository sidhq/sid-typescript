import { randomBytes } from "node:crypto";
import { positiveInteger } from "./ranges";

export interface IdStreamOptions { alphabet?: string; length?: number; seed?: number | bigint }
export class IdSpaceExhausted extends Error { override name = "IdSpaceExhausted"; }
const MASK = (1n << 64n) - 1n;
function mix(value: bigint, key: bigint, round: bigint): bigint {
  let x = (value + key + round * 0x9e3779b97f4a7c15n) & MASK;
  x ^= x >> 30n;
  x = (x * 0xbf58476d1ce4e5b9n) & MASK;
  x ^= x >> 27n;
  x = (x * 0x94d049bb133111ebn) & MASK;
  return x ^ (x >> 31n);
}

export class IdStream implements IterableIterator<string> {
  readonly alphabet: string;
  readonly length: number;
  readonly space: bigint;
  private readonly chars: string[];
  private readonly key: bigint;
  private readonly halfBits: bigint;
  private counter = 0n;

  constructor({ alphabet = "abcdefghijklmnopqrstuvwxyz", length = 5, seed }: IdStreamOptions = {}) {
    this.length = positiveInteger(length, "length");
    if (typeof alphabet !== "string") throw new TypeError("alphabet must be a string");
    this.alphabet = alphabet;
    this.chars = Array.from(alphabet);
    if (this.chars.length === 0 || new Set(this.chars).size !== this.chars.length || /[#:]/.test(alphabet)) {
      throw new RangeError("alphabet must be nonempty, unique, and exclude # and :");
    }
    if (seed !== undefined && typeof seed !== "bigint" && !Number.isSafeInteger(seed)) {
      throw new RangeError("seed must be a safe integer or bigint");
    }
    this.space = BigInt(this.chars.length) ** BigInt(length);
    this.key = seed === undefined ? randomBytes(8).readBigUInt64LE() : mix(BigInt(seed), 0n, 0n);
    this.halfBits = BigInt(Math.max(1, Math.ceil((this.space - 1n).toString(2).length / 2)));
  }

  get minted(): bigint { return this.counter; }
  get remaining(): bigint { return this.space - this.counter; }
  [Symbol.iterator](): IterableIterator<string> { return this; }
  next(): IteratorResult<string, never> { return { value: this.mint(), done: false }; }
  mint(): string {
    if (this.counter >= this.space) throw new IdSpaceExhausted(`all ${this.space} ids of this stream are in use`);
    return this.at(this.counter++);
  }
  at(index: number | bigint): string {
    if (typeof index !== "bigint" && !Number.isSafeInteger(index)) throw new RangeError("index must be a safe integer or bigint");
    let x = BigInt(index);
    if (x < 0n || x >= this.space) throw new RangeError("index outside id space");
    do { x = this.permute(x); } while (x >= this.space);
    const base = BigInt(this.chars.length), result: string[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(this.chars[Number(x % base)]!);
      x /= base;
    }
    return result.reverse().join("");
  }
  private permute(x: bigint): bigint {
    const mask = (1n << this.halfBits) - 1n;
    let lo = x >> this.halfBits, hi = x & mask;
    for (let round = 0n; round < 4n; round++) [lo, hi] = [hi, lo ^ (mix(hi, this.key, round) & mask)];
    return (lo << this.halfBits) | hi;
  }
}
