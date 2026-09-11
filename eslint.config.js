import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.turbo/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `any` is used intentionally across host bridges, plugin contexts, dynamic
      // fetch bodies, and injected core singletons. Keep it visible as a warning
      // rather than a build-breaking error so `backbone:check` reflects real
      // failures, not pervasive deliberate `any`. Tighten incrementally if desired.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    /**
     * ⚠ Icons go through core's wrapper, never the library directly.
     *
     * `components/Icon.tsx` is what applies the site's FontAwesome style; a file
     * importing the raw component silently opts out and keeps drawing bundled solid
     * while everything around it follows the admin's choice. That is invisible in
     * review and invisible in tests — it just looks slightly wrong on one screen.
     * See `docs/icon-kits.md`.
     */
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/src/components/Icon.tsx",
      "apps/web/src/plugins/host-globals.ts",
      // ⚠ The icon picker's GRID must not follow the site style — see the comment
      // there. Drawing the bundled set through a partial Pro+ family fills it with
      // missing-glyph boxes and makes choosing a shape impossible.
      "apps/web/src/components/IconPicker.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@fortawesome/react-fontawesome",
          importNames: ["FontAwesomeIcon"],
          message: "Import FontAwesomeIcon from components/Icon so it follows the site's icon style.",
        }],
      }],
    },
  },
);
