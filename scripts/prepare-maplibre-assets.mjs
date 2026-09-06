import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(projectRoot, "public", "vendor", "maplibre", version);
await mkdir(destination, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(join(dirname(packagePath), "dist", file), join(destination, file));
}
await copyFile(join(dirname(packagePath), "LICENSE.txt"), join(destination, "LICENSE.txt"));
