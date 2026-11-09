import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const alias = {"@": fileURLToPath(new URL("./src", import.meta.url))};

export default defineConfig({
    test: {
        projects: [
            {
                resolve: {alias},
                test: {
                    name: "unit",
                    include: ["tests/unit/**/*.test.{ts,tsx}"],
                    environment: "node",
                    setupFiles: ["tests/setup/unit.ts"],
                },
            },
            {
                resolve: {alias},
                test: {
                    name: "integration",
                    include: ["tests/integration/**/*.test.ts"],
                    environment: "node",
                    env: {NODE_ENV: "test"},
                    fileParallelism: false,
                    pool: "forks",
                    testTimeout: 30_000,
                    hookTimeout: 30_000,
                },
            },
        ],
    },
});
