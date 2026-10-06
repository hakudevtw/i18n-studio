import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOM tests opt in with `// @vitest-environment jsdom`. jsdom is told not to run page
    // scripts, so nothing in a test document can execute.
    environmentOptions: {
      jsdom: { runScripts: "outside-only", pretendToBeVisual: true },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/bin.ts"],
    },
  },
});
