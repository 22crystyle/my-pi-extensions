export type BrowserToolErrorCode =
  | "invalid_target"
  | "ref_not_visible"
  | "stale_ref"
  | "action_not_allowed"
  | "selector_not_visible"
  | "text_not_visible"
  | "tab_not_found"
  | "navigation_failed"
  | "provider_error";

const DEFAULT_MESSAGES: Record<BrowserToolErrorCode, string> = {
  invalid_target: "The browser action target is invalid.",
  ref_not_visible: "The target is not present in the current browser snapshot.",
  stale_ref: "The element reference is no longer valid for the current page. Call browser_snapshot again.",
  action_not_allowed: "The target cannot be used for this browser action.",
  selector_not_visible: "The selector is not present in the current browser snapshot.",
  text_not_visible: "The text target is not present in the current browser snapshot.",
  tab_not_found: "The requested browser tab was not found.",
  navigation_failed: "Browser navigation failed.",
  provider_error: "The browser provider returned an error.",
};

export class BrowserToolError extends Error {
  readonly code: BrowserToolErrorCode;
  readonly details?: unknown;

  constructor(code: BrowserToolErrorCode, message = DEFAULT_MESSAGES[code], details?: unknown) {
    super(message);
    this.name = "BrowserToolError";
    this.code = code;
    this.details = details;
  }
}

export function toActionError(error: unknown): { error: string; message: string } {
  if (error instanceof BrowserToolError) {
    return { error: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { error: "provider_error", message };
}
