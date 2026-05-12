import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserRule, PageMatcher } from "../core/types";
import { matchesPage } from "../core/pageMatcher";
import { nowIso } from "../core/utils";

export type RulesFile = {
  version: 1;
  rules: BrowserRule[];
};

export class RulesStore {
  private readonly file: string;

  constructor(private readonly cwd: string) {
    this.file = join(cwd, ".pi", "browser", "rules.json");
  }

  async load(): Promise<RulesFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RulesFile;
      return { version: 1, rules: Array.isArray(parsed.rules) ? parsed.rules : [] };
    } catch {
      return { version: 1, rules: [] };
    }
  }

  async save(file: RulesFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, rules: file.rules }, null, 2) + "\n", "utf8");
  }

  async listRules(): Promise<BrowserRule[]> {
    return (await this.load()).rules;
  }

  async getEnabledRulesMatching(page: PageMatcher, url?: string): Promise<BrowserRule[]> {
    return (await this.listRules()).filter((rule) => rule.enabled && matchesPage(rule.page, page, url));
  }

  async addRule(rule: BrowserRule): Promise<void> {
    const file = await this.load();
    file.rules.push(rule);
    await this.save(file);
  }

  async updateRule(ruleId: string, patch: Partial<BrowserRule>): Promise<BrowserRule | undefined> {
    const file = await this.load();
    const index = file.rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) return undefined;
    const next = { ...file.rules[index], ...patch, updatedAt: nowIso() } as BrowserRule;
    file.rules[index] = next;
    await this.save(file);
    return next;
  }

  async toggleRule(ruleId: string): Promise<BrowserRule | undefined> {
    const rule = (await this.listRules()).find((item) => item.id === ruleId);
    if (!rule) return undefined;
    return this.updateRule(ruleId, { enabled: !rule.enabled } as Partial<BrowserRule>);
  }

  async setAllEnabled(enabled: boolean): Promise<void> {
    const file = await this.load();
    const updatedAt = nowIso();
    file.rules = file.rules.map((rule) => ({ ...rule, enabled, updatedAt }) as BrowserRule);
    await this.save(file);
  }

  async toggleAll(): Promise<boolean> {
    const file = await this.load();
    const shouldEnable = !file.rules.some((rule) => rule.enabled);
    const updatedAt = nowIso();
    file.rules = file.rules.map((rule) => ({ ...rule, enabled: shouldEnable, updatedAt }) as BrowserRule);
    await this.save(file);
    return shouldEnable;
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const file = await this.load();
    const before = file.rules.length;
    file.rules = file.rules.filter((rule) => rule.id !== ruleId);
    await this.save(file);
    return file.rules.length !== before;
  }
}
