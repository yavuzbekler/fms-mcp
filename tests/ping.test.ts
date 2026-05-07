import { describe, it, expect } from "vitest";
import { ping } from "../src/tools/ping.js";

describe("ping tool", () => {
  it("returns ok status with server info", async () => {
    const result = await ping.handler({});
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("ok");
    expect(parsed.server).toBe("fms-mcp");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.node_version).toBe(process.version);
  });

  it("has correct tool metadata", () => {
    expect(ping.name).toBe("ping");
    expect(ping.description).toBeTruthy();
  });
});
