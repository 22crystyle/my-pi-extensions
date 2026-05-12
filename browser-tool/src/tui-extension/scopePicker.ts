import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PageMatcher } from "../core/types";
import { buildPageMatcherForScope, defaultScopeForUrl, formatPageMatcher, type PageScopeChoice } from "../core/pageMatcher";

const LABELS: Record<PageScopeChoice, string> = {
  exact: "current exact URL",
  route: "current route/path",
  path_wildcard: "current path/*",
  site: "whole site",
  all: "all sites",
};

export async function pickPageScope(ctx: ExtensionContext, url: string | undefined, fallback: PageMatcher): Promise<PageMatcher> {
  if (!url || url.startsWith("about:")) return fallback;
  const defaultScope = defaultScopeForUrl(url);
  const choices: PageScopeChoice[] = ["exact", "route", "path_wildcard", "site", "all"];
  const labels = choices.map((choice) => {
    const matcher = buildPageMatcherForScope(url, choice);
    const defaultMark = choice === defaultScope ? " (default)" : "";
    return `${LABELS[choice]}: ${formatPageMatcher(matcher)}${defaultMark}`;
  });
  const selected = await ctx.ui.select("Page scope for this browser rule", labels);
  if (!selected) return buildPageMatcherForScope(url, defaultScope);
  const index = labels.indexOf(selected);
  return buildPageMatcherForScope(url, choices[Math.max(0, index)]);
}
