import { build } from "esbuild";

await build({
  entryPoints: ["web/src/main.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outdir: "web/dist",
  entryNames: "app",
  sourcemap: false,
  jsx: "automatic",
  loader: {
    ".css": "css",
  },
});
