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
);
