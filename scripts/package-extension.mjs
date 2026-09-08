import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { strToU8, zipSync } from "fflate";

const source = new URL("../extension/", import.meta.url);
const output = new URL("../artifacts/", import.meta.url);
await mkdir(output, { recursive: true });
const files = {};
for (const name of await readdir(source)) {
  const data = await readFile(new URL(name, source));
  files[name] = new Uint8Array(data);
}
const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
files["BUILD.txt"] = strToU8(
  `Mind Boss Clipper ${manifest.version}\nBuilt ${new Date().toISOString()}\n`,
);
const target = new URL(`mindboss-clipper-${manifest.version}.zip`, output);
await writeFile(target, zipSync(files, { level: 9 }));
console.log(
  `Created ${join(basename(output.pathname), basename(target.pathname))}`,
);
