export class CircularBuffer {
  private buffer: Buffer;
  private head = 0;
  private used = 0;
  private _totalBytesSeen = 0;

  constructor(private readonly capacity: number = 1_048_576) {
    this.buffer = Buffer.alloc(capacity);
  }

  write(chunk: Buffer | string): void {
    const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this._totalBytesSeen += data.length;

    if (data.length >= this.capacity) {
      data.copy(this.buffer, 0, data.length - this.capacity);
      this.head = 0;
      this.used = this.capacity;
      return;
    }

    const spaceAtEnd = this.capacity - this.head;
    if (data.length <= spaceAtEnd) {
      data.copy(this.buffer, this.head);
    } else {
      data.copy(this.buffer, this.head, 0, spaceAtEnd);
      data.copy(this.buffer, 0, spaceAtEnd);
    }

    this.head = (this.head + data.length) % this.capacity;
    this.used = Math.min(this.used + data.length, this.capacity);
  }

  read(): string {
    if (this.used === 0) return "";

    const start = (this.head - this.used + this.capacity) % this.capacity;

    if (start + this.used <= this.capacity) {
      return this.buffer.toString("utf-8", start, start + this.used);
    }

    const endPart = this.buffer.toString("utf-8", start, this.capacity);
    const beginPart = this.buffer.toString("utf-8", 0, this.head);
    return endPart + beginPart;
  }

  get size(): number {
    return this.used;
  }

  get totalBytesSeen(): number {
    return this._totalBytesSeen;
  }

  reset(): void {
    this.head = 0;
    this.used = 0;
    this._totalBytesSeen = 0;
  }
}
