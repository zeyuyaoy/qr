import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          // Bun with Node-compatible APIs by default; component tests opt in with a `// @vitest-environment happy-dom` docblock.
          environment: "node",
          setupFiles: ["tests/setup/unit.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env: { NODE_ENV: "test" },
          // One file at a time against the shared local Redis; every file uses its own key prefix.
          fileParallelism: false,
          pool: "forks",
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
