import { BrowserToolError } from "../../core/errors";

export type CamofoxClientOptions = {
  baseUrl: string;
  accessKey?: string;
  apiKey?: string;
};

export class CamofoxClient {
  readonly baseUrl: string;
  private readonly accessKey?: string;
  private readonly apiKey?: string;

  constructor(options: CamofoxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.accessKey = options.accessKey ?? process.env.CAMOFOX_ACCESS_KEY;
    this.apiKey = options.apiKey ?? process.env.CAMOFOX_API_KEY;
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("POST", path, body, query);
  }

  async delete<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("DELETE", path, undefined, query);
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = this.accessKey ?? this.apiKey;
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new BrowserToolError("provider_error", `Unable to reach camofox-browser at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    const data = text ? safeJson(text) : {};
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `${method} ${path} failed with HTTP ${response.status}`;
      throw new BrowserToolError("provider_error", message, data);
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
