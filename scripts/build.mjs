import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifestPath = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.version = packageMetadata.version;
manifest.author = packageMetadata.author;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const outputDirectory = resolve(projectDirectory, "dist");
const archivePath = resolve(outputDirectory, "collector-starter-js.zip");
await mkdir(outputDirectory, { recursive: true });
await rm(archivePath, { force: true });

const result = spawnSync("zip", ["-q", "-X", "-r", archivePath, "main.js", "manifest.json", "logo.png", "_locales"], {
  cwd: projectDirectory,
  stdio: "inherit"
});

if (result.error) {
  throw new Error("Cannot create the collector archive. Install the zip command and retry.", { cause: result.error });
}

if (result.status !== 0) {
  throw new Error(`Collector packaging failed with exit status ${result.status}`);
}

console.log(`Created ${archivePath}`);
