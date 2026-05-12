import type { SnapshotNode } from "../../core/types";
import { escapeYamlString, maybeQuoteScalar, normalizeWhitespace } from "../../core/utils";

const INLINE_TEXT_ROLES = new Set(["text", "strong", "emphasis", "code"]);

export function renderCamofoxLikeYaml(nodes: SnapshotNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) renderNode(node, 0, lines);
  return lines.join("\n");
}

function renderNode(node: SnapshotNode, indent: number, lines: string[]): void {
  const prefix = `${"  ".repeat(indent)}- `;
  const children = node.children ?? [];
  const line = renderLine(node);

  if (children.length === 0) {
    lines.push(prefix + line);
    return;
  }

  lines.push(prefix + line + ":");
  for (const child of children) renderNode(child, indent + 1, lines);
}

function renderLine(node: SnapshotNode): string {
  if (node.role === "/url") return `/url: ${node.url ?? node.text ?? ""}`;

  const role = normalizeRole(node.role);
  const value = normalizeWhitespace(node.name ?? node.text);
  const attrs: string[] = [];
  if (node.level) attrs.push(`level=${node.level}`);
  for (const [key, raw] of Object.entries(node.attrs ?? {})) {
    if (raw === undefined || key === "level") continue;
    attrs.push(raw === true ? key : `${key}=${raw}`);
  }
  if (node.ref) attrs.push(node.ref);
  const attrText = attrs.length ? ` [${attrs.join("] [")}]` : "";

  if (!value) return `${role}${attrText}`;
  if (role === "text") return `text: ${maybeQuoteScalar(value)}`;
  if (role === "paragraph" && !(node.children && node.children.length)) return `paragraph: "${escapeYamlString(value)}"${attrText}`;
  if (INLINE_TEXT_ROLES.has(role)) return `${role}: ${maybeQuoteScalar(value)}${attrText}`;
  return `${role} "${escapeYamlString(value)}"${attrText}`;
}

function normalizeRole(role: string): string {
  if (!role || role === "generic" || role === "section") return "group";
  if (role === "textbox") return "textbox";
  return role;
}
