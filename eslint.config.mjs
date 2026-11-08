import vitals from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  ...vitals,
  ...ts,
  { ignores: [".next*/**", "node_modules/**", "playwright-report/**", "test-results/**", "public/sw.js", "next-env.d.ts"] },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // React-Compiler-oriented rules: fetch-on-mount and ref-mirroring are deliberate patterns here.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // Hard navigations are intentional (sign-in redirect, offline fallback); logos are data: URLs.
      "@next/next/no-location-assign-relative-destination": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
    },
  },
];
export default config;
