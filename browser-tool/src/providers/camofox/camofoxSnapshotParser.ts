import type { SnapshotNode } from "../../core/types";

export function parseCamofoxLikeYaml(snapshot: string): SnapshotNode[] {
  const root: Array<{ indent: number; node: SnapshotNode }> = [];
  const result: SnapshotNode[] = [];

  for (const rawLine of snapshot.split(/\r?\n/)) {
    const match = rawLine.match(/^(\s*)-\s+([\s\S]*?)\s*$/);
    if (!match) continue;
    const indent = Math.floor(match[1].length / 2);
    const node = parseLine(stripContainerColon(match[2]));
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

function stripContainerColon(line: string): string {
  const trimmed = line.trim();
  if (trimmed.endsWith(":")) return trimmed.slice(0, -1).trimEnd();
  return trimmed;
}

function parseLine(rawLine: string): SnapshotNode {
  const line = stripOuterSingleQuotes(rawLine.trim());
  const ref = line.match(/\[([a-z]\d+)\]/)?.[1];
  const level = line.match(/\[level=(\d+)\]/)?.[1];
  const base = stripTrailingAttrs(line);
  const common = { ref, providerRef: ref?.startsWith("e") ? ref : undefined, level: level ? Number(level) : undefined };

  const quoted = base.match(/^([a-zA-Z0-9_/-]+)\s+"([\s\S]*)"$/);
  if (quoted) return compactNode({ role: quoted[1], name: unescapeYamlDoubleQuoted(quoted[2]), ...common });

  const scalar = base.match(/^([a-zA-Z0-9_/-]+):\s*([\s\S]*)$/);
  if (scalar) {
    const value = parseScalarValue(scalar[2]);
    if (scalar[1] === "/url") return compactNode({ role: scalar[1], url: value, ...common });
    return compactNode({ role: scalar[1], text: value, ...common });
  }

  return compactNode({ role: base.split(/\s+/)[0] || "group", ...common });
}

function stripOuterSingleQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function stripTrailingAttrs(value: string): string {
  return value.replace(/(?:\s+\[[^\]]+\])+\s*$/g, "").trimEnd();
}

function parseScalarValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return unescapeYamlDoubleQuoted(trimmed.slice(1, -1));
  return trimmed;
}

function unescapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function compactNode(node: SnapshotNode): SnapshotNode {
  if (!node.ref) delete node.ref;
  if (!node.providerRef) delete node.providerRef;
  if (!node.level) delete node.level;
  if (!node.name) delete node.name;
  if (!node.text) delete node.text;
  if (!node.url) delete node.url;
  return node;
}
