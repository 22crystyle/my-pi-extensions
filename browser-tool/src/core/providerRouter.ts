import { UiStateStore } from "../storage/uiStateStore";
import { CamofoxClient } from "../providers/camofox/camofoxClient";
import { CamofoxProvider } from "../providers/camofox/camofoxProvider";
import type { BrowserProvider, UiState } from "./types";

export class ProviderRouter {
  private provider?: BrowserProvider;
  private stateKey?: string;

  constructor(private readonly uiStateStore: UiStateStore) {}

  async getProvider(): Promise<BrowserProvider> {
    const state = await this.uiStateStore.load();
    const key = providerStateKey(state);
    if (!this.provider || this.stateKey !== key) {
      const client = new CamofoxClient({ baseUrl: state.camofoxBaseUrl });
      this.provider = new CamofoxProvider(client, {
        userId: state.userId,
        sessionKey: state.sessionKey,
      });
      this.stateKey = key;
    }
    return this.provider;
  }
}

function providerStateKey(state: UiState): string {
  return `${state.camofoxBaseUrl}|${state.userId}|${state.sessionKey}`;
}
