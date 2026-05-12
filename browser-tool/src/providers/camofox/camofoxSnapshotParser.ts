import type { SnapshotNode } from "../../core/types";

export function parseCamofoxLikeYaml(snapshot: string): SnapshotNode[] {
  const root: Array<{ indent: number; node: SnapshotNode }> = [];
  const result: SnapshotNode[] = [];

  for (const rawLine of snapshot.split(/\r?\n/)) {
    const match = rawLine.match(/^(\s*)-\s+(.*?)(:)?$/);
    if (!match) continue;
    const indent = Math.floor(match[1].length / 2);
    const node = parseLine(match[2]);
    while (root.length && root[root.length - 1].indent >= indent) root.pop();
    const parent = root[root.length - 1]?.node;
    if (parent) {
      parent.children ??= [];
      parent.children.push(node);
    } else {
      result.push(node);
    }
    root.push({ indent, node });
  }

  return result;
}

function parseLine(line: string): SnapshotNode {
  const ref = line.match(/\[([a-z]\d+)\]/)?.[1];
  const level = line.match(/\[level=(\d+)\]/)?.[1];
  const quoted = line.match(/^([a-zA-Z0-9_/-]+)\s+"([\s\S]*)"/);
  if (quoted) return { role: quoted[1], name: quoted[2].replace(/"\s+\[[^\]]+\].*$/, ""), ref, providerRef: ref?.startsWith("e") ? ref : undefined, level: level ? Number(level) : undefined };
  const scalar = line.match(/^([a-zA-Z0-9_/-]+):\s*(.*)$/);
  if (scalar) return { role: scalar[1], text: scalar[2].replace(/^"|"$/g, ""), ref, providerRef: ref?.startsWith("e") ? ref : undefined };
  return { role: line.split(/\s+/)[0] || "group", ref, providerRef: ref?.startsWith("e") ? ref : undefined, level: level ? Number(level) : undefined };
}
