export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  public next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.state = this.state >>> 0;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  public integer(minimum: number, maximumInclusive: number): number {
    return Math.floor(this.range(minimum, maximumInclusive + 1));
  }

  public pick<T>(items: readonly T[]): T {
    const item = items[this.integer(0, items.length - 1)];
    if (item === undefined) {
      throw new Error('Cannot pick from an empty array.');
    }
    return item;
  }
}
