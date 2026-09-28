import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "data/**",
    "dist/**",
    "out/**",
    // Distributed third-party bundles are copied verbatim, not authored here.
    "public/opencv/**",
    "public/tesseract/**",
    "public/tesseract-core/**",
    "public/vendor/**",
    "next-env.d.ts",
  ]),
]);
