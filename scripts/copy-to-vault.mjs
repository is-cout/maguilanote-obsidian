import fs from "fs";
import path from "path";
import process from "process";

const envPath = path.resolve(".env.local");
if (!fs.existsSync(envPath)) {
  console.log("copy-to-vault: no .env.local found, skip");
  process.exit(0);
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const dest = env.OBSIDIAN_PLUGIN_DIR;
if (!dest) {
  console.log("copy-to-vault: OBSIDIAN_PLUGIN_DIR not set, skip");
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  if (!fs.existsSync(file)) {
    console.warn(`copy-to-vault: ${file} missing, skip`);
    continue;
  }
  fs.copyFileSync(file, path.join(dest, file));
  console.log(`copy-to-vault: ${file} -> ${dest}`);
}
