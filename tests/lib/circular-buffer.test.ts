import { describe, it, expect } from "vitest";
import { CircularBuffer } from "../../src/lib/circular-buffer.js";

describe("CircularBuffer", () => {
  it("boş buffer okuma boş string döner", () => {
    const buf = new CircularBuffer(100);
    expect(buf.read()).toBe("");
    expect(buf.size).toBe(0);
    expect(buf.totalBytesSeen).toBe(0);
  });

  it("string yazıp okur", () => {
    const buf = new CircularBuffer(100);
    buf.write("hello");
    expect(buf.read()).toBe("hello");
    expect(buf.size).toBe(5);
    expect(buf.totalBytesSeen).toBe(5);
  });

  it("Buffer yazıp okur", () => {
    const buf = new CircularBuffer(100);
    buf.write(Buffer.from("world"));
    expect(buf.read()).toBe("world");
  });

  it("birden fazla yazma birleştirir", () => {
    const buf = new CircularBuffer(100);
    buf.write("hello ");
    buf.write("world");
    expect(buf.read()).toBe("hello world");
    expect(buf.size).toBe(11);
    expect(buf.totalBytesSeen).toBe(11);
  });

  it("kapasiteyi aşınca eski veri atılır", () => {
    const buf = new CircularBuffer(10);
    buf.write("12345");
    buf.write("67890");
    expect(buf.read()).toBe("1234567890");
    expect(buf.size).toBe(10);

    buf.write("abc");
    expect(buf.read()).toBe("4567890abc");
    expect(buf.size).toBe(10);
    expect(buf.totalBytesSeen).toBe(13);
  });

  it("kapasiteden büyük tek yazma son kapasiteyi alır", () => {
    const buf = new CircularBuffer(5);
    buf.write("1234567890");
    expect(buf.read()).toBe("67890");
    expect(buf.size).toBe(5);
    expect(buf.totalBytesSeen).toBe(10);
  });

  it("tam kapasite sınırında yazma", () => {
    const buf = new CircularBuffer(5);
    buf.write("12345");
    expect(buf.read()).toBe("12345");
    expect(buf.size).toBe(5);
  });

  it("wrap-around sonrası doğru okuma", () => {
    const buf = new CircularBuffer(8);
    buf.write("ABCDEFGH");
    expect(buf.read()).toBe("ABCDEFGH");
    buf.write("IJ");
    expect(buf.read()).toBe("CDEFGHIJ");
  });

  it("totalBytesSeen tüm yazılanları sayar", () => {
    const buf = new CircularBuffer(5);
    buf.write("abc");
    buf.write("defgh");
    buf.write("ijk");
    expect(buf.totalBytesSeen).toBe(11);
  });

  it("reset tüm state temizler", () => {
    const buf = new CircularBuffer(10);
    buf.write("hello");
    buf.reset();
    expect(buf.read()).toBe("");
    expect(buf.size).toBe(0);
    expect(buf.totalBytesSeen).toBe(0);
  });

  it("çok sayıda küçük yazma", () => {
    const buf = new CircularBuffer(10);
    for (let i = 0; i < 20; i++) {
      buf.write(String(i % 10));
    }
    expect(buf.size).toBe(10);
    expect(buf.totalBytesSeen).toBe(20);
    expect(buf.read()).toBe("0123456789");
  });

  it("boş string yazma state değiştirmez", () => {
    const buf = new CircularBuffer(10);
    buf.write("hello");
    buf.write("");
    expect(buf.read()).toBe("hello");
    expect(buf.size).toBe(5);
  });

  it("kapasiteyi tam 2x aşan yazma", () => {
    const buf = new CircularBuffer(5);
    buf.write("1234567890ABCDE");
    expect(buf.read()).toBe("ABCDE");
    expect(buf.size).toBe(5);
  });
});
