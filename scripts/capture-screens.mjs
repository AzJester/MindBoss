import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

await mkdir(new URL("../artifacts/qa/", import.meta.url), { recursive: true });
const browser = await chromium.launch();
for (const [name, viewport] of Object.entries({
  desktop: { width: 1440, height: 1000 },
  android: { width: 390, height: 844 },
})) {
  const page = await browser.newPage({ viewport });
  await page.goto("http://127.0.0.1:8788");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({
    path: new URL(
      `../artifacts/qa/${name}.png`,
      import.meta.url,
    ).pathname.slice(1),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.screenshot({
    path: new URL(
      `../artifacts/qa/${name}-capture.png`,
      import.meta.url,
    ).pathname.slice(1),
    fullPage: true,
  });
  await page.close();
}
await browser.close();
console.log("Captured desktop and Android QA screens.");
