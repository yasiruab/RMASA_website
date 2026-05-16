#!/usr/bin/env node
// Fails the build if `_AMPLIFY_*` env-var references appear outside the
// allowlisted server-only files. Without this guard, a stray reference in a
// client component would inline the production secret into the browser bundle.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const scanRoots = ["src", "next.config.ts"];
const allowed = new Set([
  "next.config.ts",
  "src/instrumentation.ts",
  "src/lib/prisma.ts",
  "scripts/check-amplify-secret-leak.mjs",
]);
const skipDirs = new Set(["node_modules", ".next", "dist", "out", ".git"]);
const pattern = /_AMPLIFY_[A-Z_]+/;

function walk(target, found) {
  const abs = join(repoRoot, target);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return;
  }
  if (stat.isFile()) {
    inspect(target, found);
    return;
  }
  for (const entry of readdirSync(abs)) {
    if (skipDirs.has(entry)) continue;
    walk(join(target, entry).split(sep).join("/"), found);
  }
}

function inspect(relPath, found) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) return;
  const contents = readFileSync(join(repoRoot, relPath), "utf8");
  if (pattern.test(contents) && !allowed.has(relPath)) {
    found.push(relPath);
  }
}

const offenders = [];
for (const root of scanRoots) walk(root, offenders);

if (offenders.length > 0) {
  console.error("Build aborted: `_AMPLIFY_*` env-var references found outside the server-only allowlist.");
  console.error("These keys are inlined at build time and will leak into client bundles if referenced from client code.");
  console.error("Offending files:");
  for (const file of offenders) console.error(`  - ${file}`);
  console.error("\nAllowed locations:");
  for (const file of allowed) console.error(`  - ${file}`);
  process.exit(1);
}

console.log("[check-amplify-secret-leak] OK — no leakage detected.");
