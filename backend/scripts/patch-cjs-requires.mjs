#!/usr/bin/env node
/** Rewrite require("./foo.js") → require("./foo.cjs") in dist/*.cjs so Node loads CJS, not ESM. */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
for (const name of readdirSync(distDir)) {
  if (!name.endsWith(".cjs")) continue;
  const path = join(distDir, name);
  let content = readFileSync(path, "utf8");
  content = content.replace(/require\("\.\/([^"]+)\.js"\)/g, 'require("./$1.cjs")');
  writeFileSync(path, content);
}
