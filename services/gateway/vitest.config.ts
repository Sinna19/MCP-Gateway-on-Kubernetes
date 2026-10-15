import { defineConfig } from "vitest/config";

// One shared Postgres container (global-setup), so test files run one at a time.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
