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

// Node modules are loaded lazily behind a desktop guard: they don't exist on mobile.
async function nodeModules() {
  if (!Platform.isDesktop) return null;
  const [fs, os, path] = await Promise.all([import("fs"), import("os"), import("path")]);
  return { fs, path, file: path.join(os.homedir(), ".maguilanote", "secrets.json") };
}

async function readSecretsFile(): Promise<SecretsFile> {
  const node = await nodeModules();
  if (!node) return {};
  try {
    return JSON.parse(node.fs.readFileSync(node.file, "utf8")) as SecretsFile;
  } catch {
    return {};
  }
}

async function writeSecretsFile(data: SecretsFile) {
  const node = await nodeModules();
  if (!node) return;
  const { fs, path, file } = node;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  try {
    fs.chmodSync(file, 0o600); // best-effort; no-op on Windows
  } catch {
    // ignore — not all filesystems support POSIX permissions
  }
}

export async function loadOpenAiApiKey(): Promise<string> {
  if (!Platform.isDesktopApp) return "";
  return (await readSecretsFile()).openaiApiKey ?? "";
}

export async function saveOpenAiApiKey(key: string) {
  if (!Platform.isDesktopApp) return;
  await writeSecretsFile({ ...(await readSecretsFile()), openaiApiKey: key });
}
