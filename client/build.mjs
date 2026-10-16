// Standalone client build for DeCluttr (no Hatch SDK).
//
// 1. Compiles theme.css with the Tailwind v4 CLI -> dist/theme.css
// 2. Bundles src/main.tsx with Bun.build -> dist/bundle.js
// 3. Copies index.html -> dist/index.html
//
// Run from the repo root via `bun run build:client`, or from client/ directly.

import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const dist = fileURLToPath(new URL("./dist/", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// 1. Tailwind CSS
const tailwind = spawnSync(
  "bun",
  ["x", "@tailwindcss/cli", "-i", "./src/theme.css", "-o", "./dist/theme.css", "--minify"],
  { cwd: root, stdio: "inherit" },
);
if (tailwind.status !== 0) {
  console.error("tailwindcss build failed");
  process.exit(tailwind.status ?? 1);
}

// 2. JS/TS bundle
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./src/main.tsx", import.meta.url))],
  outdir: dist,
  naming: "bundle.js",
  target: "browser",
  format: "esm",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 3. HTML shell
await cp(fileURLToPath(new URL("./index.html", import.meta.url)), fileURLToPath(new URL("./dist/index.html", import.meta.url)));

// 4. Static public assets (icons, favicons)
await cp(fileURLToPath(new URL("./public/", import.meta.url)), fileURLToPath(new URL("./dist/", import.meta.url)), { recursive: true });

console.log("client built -> client/dist");
