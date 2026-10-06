import { spawn } from "node:child_process";

export type Opener = (url: string) => void;

/** `--no-open` beats `--open`, which beats the config `open`. Pure: easy to test. */
export const shouldOpen = (
  flags: { open?: boolean; "no-open"?: boolean },
  config: { open: boolean }
): boolean => {
  if (flags["no-open"]) {
    return false;
  }
  return flags.open ?? config.open;
};

/** Hand a file or URL to the OS. Failures (no GUI, no opener) are swallowed by the caller. */
export const openWithSystem: Opener = (target) => {
  const openers: Record<string, string> = { darwin: "open", win32: "start" };
  const cmd = openers[process.platform] ?? "xdg-open";
  const child = spawn(cmd, [target], { detached: true, stdio: "ignore" });
  child.on("error", () => {
    // no opener installed: the caller already printed the URL
  }); // ENOENT arrives as an event, not a throw
  child.unref();
};

/** Opens `url`; returns whether it worked. Never throws. */
export const tryOpen = (open: Opener, url: string): boolean => {
  try {
    open(url);
    return true;
  } catch {
    return false;
  }
};
