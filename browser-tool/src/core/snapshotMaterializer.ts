import type { SnapshotNode } from "./types";
import { normalizeWhitespace } from "./utils";

export function dedupeSnapshotNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  const seen = new Set<string>();
  const result: SnapshotNode[] = [];
  for (const node of nodes) {
    const key = snapshotNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(node);
  }
  return result;
}

export function snapshotNodeKey(node: SnapshotNode): string {
  return [
    node.sourceKey,
    node.selector,
    node.providerRef,
    node.role,
    normalizeWhitespace(node.name ?? node.text),
    node.url,
    (node.children ?? []).map(snapshotNodeKey).join(";"),
  ].filter(Boolean).join("|");
}

export function flattenSnapshotNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  const visit = (node: SnapshotNode) => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}
