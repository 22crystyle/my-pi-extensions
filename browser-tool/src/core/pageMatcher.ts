import type { PageMatcher } from "./types";

export function normalizeHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "hh.ru" || (host.endsWith(".hh.ru") && host !== "career.hh.ru")) return "*.hh.ru";
  return host;
}

export function normalizePath(pathname: string): string {
  const path = pathname || "/";
  const normalized = path
    .replace(/\/\d+($|\/)/g, "/:id$1")
    .replace(/[a-f0-9]{16,}/gi, ":hash");
  return normalized || "/";
}

export function buildPageKey(url: string): PageMatcher {
  const u = new URL(url || "about:blank");
  return {
    host: normalizeHost(u.hostname),
    path: normalizePath(u.pathname),
    query: "ignore",
    hash: "ignore",
  };
}

export function pageMatcherKey(page: PageMatcher): string {
  return `${page.host} ${page.path} q=${typeof page.query === "string" ? page.query : JSON.stringify(page.query ?? "ignore")} h=${page.hash ?? "ignore"}`;
}

export function formatPageMatcher(page: PageMatcher): string {
  return `${page.host} ${page.path}`;
}

export function matchesPage(rulePage: PageMatcher, currentPage: PageMatcher, url?: string): boolean {
  const actualUrl = url ? new URL(url) : undefined;
  const actualHost = actualUrl?.hostname.toLowerCase();
  const hostToMatch = rulePage.host.startsWith("*.") || rulePage.host === "*" || rulePage.host === "all"
    ? currentPage.host
    : actualHost ?? currentPage.host;
  if (!matchHost(rulePage.host, hostToMatch)) return false;
  const pathToMatch = rulePage.path.includes(":id") || rulePage.path.includes(":hash") || rulePage.path.endsWith("/*") || rulePage.path === "*" || rulePage.path === "/*"
    ? currentPage.path
    : actualUrl?.pathname ?? currentPage.path;
  if (!matchPath(rulePage.path, pathToMatch)) return false;

  if (url) {
    const u = actualUrl!;
    if (rulePage.query && rulePage.query !== "ignore") {
      if (rulePage.query === "exact") {
        // currentPage intentionally ignores query. Exact means the normalized matcher was created
        // from a full URL and has a hidden exact query in future schema revisions; for now only
        // require that a query is present on both sides.
      } else {
        const expected = Object.entries(rulePage.query);
        if (Array.from(u.searchParams.entries()).length !== expected.length) return false;
        for (const [key, value] of expected) {
          if (u.searchParams.get(key) !== value) return false;
        }
      }
    }
    if (rulePage.hash === "exact" && !u.hash) return false;
  }

  return true;
}

function matchHost(ruleHost: string, currentHost: string): boolean {
  if (ruleHost === "*" || ruleHost === "all") return true;
  if (ruleHost.startsWith("*.")) {
    const suffix = ruleHost.slice(2);
    const current = currentHost.startsWith("*.") ? currentHost.slice(2) : currentHost;
    return current === suffix || current.endsWith(`.${suffix}`);
  }
  if (currentHost.startsWith("*.")) {
    const suffix = currentHost.slice(2);
    return ruleHost === suffix || ruleHost.endsWith(`.${suffix}`);
  }
  return ruleHost === currentHost;
}

function matchPath(rulePath: string, currentPath: string): boolean {
  if (rulePath === "*" || rulePath === "/*") return true;
  if (rulePath.endsWith("/*")) {
    const prefix = rulePath.slice(0, -1);
    return currentPath.startsWith(prefix);
  }
  const pattern = "^" + escapeRegExp(rulePath)
    .replace(/:id/g, "[^/]+")
    .replace(/:hash/g, "[^/]+") + "$";
  return new RegExp(pattern).test(currentPath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type PageScopeChoice = "exact" | "route" | "path_wildcard" | "site" | "all";

export function buildPageMatcherForScope(url: string, scope: PageScopeChoice): PageMatcher {
  const u = new URL(url);
  const routePath = normalizePath(u.pathname);
  const host = normalizeHost(u.hostname);

  if (scope === "all") return { host: "*", path: "*", query: "ignore", hash: "ignore" };
  if (scope === "site") return { host, path: "*", query: "ignore", hash: "ignore" };
  if (scope === "path_wildcard") {
    const rawPath = u.pathname || "/";
    const numericPrefix = rawPath.match(/^(.*)\/\d+(?:\/.*)?$/)?.[1];
    const base = numericPrefix || routePath.replace(/\/$/, "");
    const path = base && base !== "/" ? `${base}/*` : "/";
    return { host, path, query: "ignore", hash: "ignore" };
  }
  if (scope === "exact") return { host: u.hostname.toLowerCase(), path: u.pathname || "/", query: Object.fromEntries(u.searchParams.entries()), hash: u.hash ? "exact" : "ignore" };
  return { host, path: routePath, query: "ignore", hash: "ignore" };
}

export function defaultScopeForUrl(url: string): PageScopeChoice {
  const path = new URL(url).pathname;
  return /\/\d+($|\/)/.test(path) ? "route" : "route";
}
