import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const source = resolve(repoRoot, "README.md");
const target = resolve(repoRoot, "packages/effect-orpc/README.md");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

console.log(`Synced ${source} -> ${target}`);
