import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../public/icon.svg", import.meta.url));
for (const size of [192, 512]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(
      fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)),
    );
}
for (const size of [16, 32, 48, 128]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(
      fileURLToPath(new URL(`../extension/icon-${size}.png`, import.meta.url)),
    );
}
console.log("Generated PWA and extension icons.");
