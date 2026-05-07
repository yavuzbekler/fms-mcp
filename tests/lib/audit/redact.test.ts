import { describe, it, expect } from "vitest";
import { redactArgs } from "../../../src/lib/audit/redact.js";

describe("redactArgs", () => {
  it("should redact default 'content' field", () => {
    const result = redactArgs({ path: "/workspace/test.txt", content: "hello world" });
    expect(result.path).toBe("/workspace/test.txt");
    expect(result.content).toBe("[REDACTED:11 bytes]");
  });

  it("should redact default 'new_str' field", () => {
    const result = redactArgs({ path: "/workspace/f.ts", old_str: "foo", new_str: "bar baz" });
    expect(result.old_str).toBe("foo");
    expect(result.new_str).toBe("[REDACTED:7 bytes]");
  });

  it("should redact custom fields from auditRedactFields", () => {
    const result = redactArgs(
      { path: "/workspace/f.ts", old_str: "foo", secret: "my-secret" },
      ["secret"],
    );
    expect(result.path).toBe("/workspace/f.ts");
    expect(result.old_str).toBe("foo");
    expect(result.secret).toBe("[REDACTED:9 bytes]");
  });

  it("should redact 'env' field as key count", () => {
    const result = redactArgs({
      command: "ls",
      env: { NODE_ENV: "production", SECRET_KEY: "abc123" },
    });
    expect(result.command).toBe("ls");
    expect(result.env).toBe("[REDACTED:2 keys]");
  });

  it("should not redact 'command' field", () => {
    const result = redactArgs({ command: "rm -rf /tmp/test", cwd: "/workspace" });
    expect(result.command).toBe("rm -rf /tmp/test");
    expect(result.cwd).toBe("/workspace");
  });

  it("should handle null/undefined values in redact fields", () => {
    const result = redactArgs({ path: "/workspace/f.txt", content: null as unknown as string });
    expect(result.content).toBeNull();
  });

  it("should handle non-string values in redact fields", () => {
    const result = redactArgs({ content: 42 as unknown as string });
    expect(result.content).toBe("[REDACTED]");
  });

  it("should pass through all non-redacted fields unchanged", () => {
    const args = {
      path: "/workspace/project/file.ts",
      encoding: "utf-8",
      mode: "rewrite",
      create_dirs: true,
    };
    const result = redactArgs(args);
    expect(result).toEqual(args);
  });

  it("should handle empty args", () => {
    const result = redactArgs({});
    expect(result).toEqual({});
  });

  it("should handle multi-byte content correctly", () => {
    const content = "merhaba dünya 🌍";
    const result = redactArgs({ content });
    const byteLen = Buffer.byteLength(content);
    expect(result.content).toBe(`[REDACTED:${byteLen} bytes]`);
  });
});
