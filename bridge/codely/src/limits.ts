/** A UTF-8 prefix that never ends in a partial code point. */
export function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder("utf-8").decode(bytes.subarray(0, Math.max(0, maxBytes)), { stream: true });
}
