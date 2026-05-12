export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeLabel(value: string | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function truncateMiddle(value: string, max = 120): string {
  if (value.length <= max) return value;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function maybeQuoteScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (/[:#\n\r\t]|^[-?]|^\s|\s$|["']/.test(value)) return `"${escapeYamlString(value)}"`;
  return value;
}

export function fuzzyMatch(haystack: string, query: string): boolean {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  let pos = 0;
  for (const ch of q) {
    pos = h.indexOf(ch, pos);
    if (pos < 0) return false;
    pos += 1;
  }
  return true;
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
