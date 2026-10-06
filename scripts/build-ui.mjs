import { copyFileSync } from "node:fs";
import { build } from "esbuild";

// Bundles the browser UI (Preact is bundled in; the package keeps zero runtime dependencies).
await build({
  entryPoints: { app: "src/ui/main.tsx" },
  outdir: "dist/ui",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
copyFileSync("src/ui/favicon.svg", "dist/ui/favicon.svg");
process.stdout.write("built dist/ui/app.js, app.css and favicon.svg\n");
