#!/usr/bin/env node
/** Convert vgrib2 dist file to LF so patch applies (npm package may ship CRLF). */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "..", "node_modules", "vgrib2", "dist", "vgrib2.cjs.development.js");
if (existsSync(distPath)) {
  const content = readFileSync(distPath, "utf8").replace(/\r\n/g, "\n");
  writeFileSync(distPath, content);
}
