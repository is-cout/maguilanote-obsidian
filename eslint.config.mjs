// Mirrors the TS checks behind the Obsidian plugin scorecard (community.obsidian.md).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["main.js", "node_modules/", "build-local.mjs", "esbuild.config.mjs", "scripts/", "test/"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      // getSettingDefinitions() is an Obsidian 1.13 API, far above minAppVersion and absent from the pinned types.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      // Product names, UI paths and terms the plugin intentionally capitalizes.
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Obsidian", "Markdown", "Maguilanote", "JSON Canvas", "Google Font", "Google Fonts", "Inter", "OpenAI", "Record"],
          ignoreWords: ["Ctrl", "Settings", "Recording"],
          ignoreRegex: ["^sk-", "^or a Google Font name$"],
        },
      ],
    },
  },
]);
