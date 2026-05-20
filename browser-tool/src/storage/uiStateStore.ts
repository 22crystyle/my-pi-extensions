import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UiState } from "../core/types";

export const DEFAULT_CAMOFOX_BASE_URL = "http://localhost:9377";

export class UiStateStore {
  private readonly file: string;

  constructor(private readonly cwd: string) {
    this.file = join(cwd, ".pi", "browser", "ui-state.json");
  }

  async load(): Promise<UiState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<UiState>;
      return normalizeUiState(parsed);
    } catch {
      return normalizeUiState({});
    }
  }

  async save(state: UiState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(normalizeUiState(state), null, 2) + "\n", "utf8");
  }

  async patch(patch: Partial<UiState>): Promise<UiState> {
    const next = normalizeUiState({ ...(await this.load()), ...patch });
    await this.save(next);
    return next;
  }
}

function normalizeUiState(input: Partial<UiState>): UiState {
  return {
    version: 1,
    camofoxBaseUrl: normalizeBaseUrl(input.camofoxBaseUrl || process.env.CAMOFOX_BROWSER_URL || process.env.CAMOFOX_BASE_URL || DEFAULT_CAMOFOX_BASE_URL),
    userId: input.userId || process.env.CAMOFOX_USER_ID || "pi-browser-tool",
    sessionKey: input.sessionKey || process.env.CAMOFOX_SESSION_KEY || "pi-browser-tool",
    debugRawSnapshot: Boolean(input.debugRawSnapshot),
    tabs: input.tabs || [],
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
