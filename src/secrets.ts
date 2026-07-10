import { Platform } from "obsidian";

/**
 * Desktop-only secret storage, kept OUTSIDE any vault (in the OS user home
 * directory) so it's never swept up by a vault backup/sync. This is plain
 * text on disk, not OS-keychain-grade encryption — it only solves "don't
 * back this up with my notes", not "protect it from someone with disk access".
 *
 * Mobile has no filesystem access outside the vault, so callers fall back to
 * storing the key in plugin settings (`data.json`, inside the vault) there.
 */

interface SecretsFile {
  openaiApiKey?: string;
}

function secretsPath(): string {
  const os = require("os");
  const path = require("path");
  return path.join(os.homedir(), ".maguilanote", "secrets.json");
}

function readSecretsFile(): SecretsFile {
  const fs = require("fs");
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeSecretsFile(data: SecretsFile) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.dirname(secretsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretsPath(), JSON.stringify(data, null, 2), "utf8");
  try {
    fs.chmodSync(secretsPath(), 0o600); // best-effort; no-op on Windows
  } catch {
    // ignore — not all filesystems support POSIX permissions
  }
}

export function loadOpenAiApiKey(): string {
  if (!Platform.isDesktopApp) return "";
  return readSecretsFile().openaiApiKey ?? "";
}

export function saveOpenAiApiKey(key: string) {
  if (!Platform.isDesktopApp) return;
  writeSecretsFile({ ...readSecretsFile(), openaiApiKey: key });
}
