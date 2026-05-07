const DEFAULT_REDACT_FIELDS = new Set(["content", "new_str"]);

export function redactArgs(
  args: Record<string, unknown>,
  redactFields?: string[],
): Record<string, unknown> {
  const fields = redactFields
    ? new Set([...DEFAULT_REDACT_FIELDS, ...redactFields])
    : DEFAULT_REDACT_FIELDS;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (fields.has(key)) {
      if (typeof value === "string") {
        result[key] = `[REDACTED:${Buffer.byteLength(value)} bytes]`;
      } else if (value != null) {
        result[key] = `[REDACTED]`;
      } else {
        result[key] = value;
      }
    } else if (key === "env" && typeof value === "object" && value !== null) {
      result[key] = `[REDACTED:${Object.keys(value).length} keys]`;
    } else {
      result[key] = value;
    }
  }

  return result;
}
