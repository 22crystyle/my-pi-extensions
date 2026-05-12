export const Keys = {
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
  enter1: "\r",
  enter2: "\n",
  escape: "\u001b",
  backspace1: "\u007f",
  backspace2: "\b",
  tab: "\t",
};

export function isEnter(data: string): boolean {
  return data === Keys.enter1 || data === Keys.enter2;
}

export function isBackspace(data: string): boolean {
  return data === Keys.backspace1 || data === Keys.backspace2;
}

export function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\u007f";
}

export function stripAnsiWidth(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

export function truncateLine(value: string, width: number): string {
  if (width <= 0) return "";
  if (stripAnsiWidth(value) <= width) return value;
  return value.slice(0, Math.max(0, width - 1)) + "…";
}
