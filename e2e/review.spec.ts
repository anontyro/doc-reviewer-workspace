import { expect, test } from "@playwright/test";
import { installFakeTauri, openDoc, selectPhrase } from "./fakeTauri";

test.beforeEach(async ({ page }) => {
  await installFakeTauri(page);
  await openDoc(page);
});

const selection = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    text: getSelection()!.toString(),
    inArticle: document.activeElement === document.querySelector("article"),
  }));

test("the Comment menu sits just below the selection and does not cover it", async ({ page }) => {
  await selectPhrase(page, "cache when offline");
  const menu = page.getByRole("toolbar");
  await expect(menu).toBeVisible();
  const rect = await page.evaluate(() =>
    getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON(),
  );
  const m = (await menu.boundingBox())!;
  expect(m.y).toBeGreaterThanOrEqual(rect.bottom - 1);
  expect(m.y - rect.bottom).toBeLessThan(40);
});

test("clicking the menu keeps the selection, then Cmd+Enter saves the comment exactly as typed", async ({
  page,
}) => {
  await selectPhrase(page, "cache when offline");
  await page.getByRole("button", { name: "Comment" }).click();
  const typed = "  keep `these` spaces 🙂  ";
  await page.getByLabel("Comment", { exact: true }).fill(typed);
  await page.getByLabel("Comment", { exact: true }).press("Meta+Enter");

  await expect(page.locator(".comment-text")).toHaveText(typed);
  await expect(page.locator(".comment-quote")).toHaveText("cache when offline");
  expect(await selection(page)).toEqual({ text: "cache when offline", inArticle: true });
});

test("Cmd+Shift+M opens the composer and Escape closes it, saving nothing and restoring the selection", async ({
  page,
}) => {
  await selectPhrase(page, "cache when offline");
  await page.keyboard.press("Meta+Shift+M");
  await page.getByLabel("Comment", { exact: true }).fill("draft");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".comment-text")).toHaveCount(0);
  expect(await selection(page)).toEqual({ text: "cache when offline", inArticle: true });
});

test("a phrase that appears twice is refused, and enough context makes it saveable", async ({
  page,
}) => {
  await selectPhrase(page, "The system must be local-first.");
  await page.keyboard.press("Meta+Shift+M");
  await expect(page.getByRole("alert")).toContainText("2 places");
  await expect(page.getByLabel("Comment", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await selectPhrase(page, "Use the cache");
  await page.keyboard.press("Meta+Shift+M");
  await expect(page.getByLabel("Comment", { exact: true })).toBeVisible();
});

test("a selection across two blocks says it is not supported and saves nothing", async ({
  page,
}) => {
  const box = await page.locator("article").boundingBox();
  await page.mouse.move(box!.x + 5, box!.y + 5);
  await page.mouse.down();
  await page.evaluate(() => {
    const ps = document.querySelectorAll("article p");
    const r = document.createRange();
    r.setStart(ps[2].firstChild!, 4);
    r.setEnd(ps[3].firstChild!, 2);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await page.mouse.up();
  await page.keyboard.press("Meta+Shift+M");
  await expect(page.getByRole("alert")).toContainText("Not supported");
  await expect(page.locator(".comment-text")).toHaveCount(0);
});

test("a saved comment is highlighted, and clicking it in the panel selects its passage", async ({
  page,
  browserName,
}) => {
  await selectPhrase(page, "The cache is local");
  await page.keyboard.press("Meta+Shift+M");
  await page.getByLabel("Comment", { exact: true }).fill("tighten");
  await page.keyboard.press("Meta+Enter");

  // Highlights use the CSS Custom Highlight API. Where the engine lacks it the panel still works.
  const supported = await page.evaluate(() => typeof CSS !== "undefined" && "highlights" in CSS);
  if (supported) {
    expect(
      await page.evaluate(() => [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0)),
    ).toBe(1);
  } else {
    test.info().annotations.push({ type: "no-highlight-api", description: browserName });
  }

  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.locator(".comment-jump").click();
  expect(await selection(page)).toEqual({ text: "The cache is local", inArticle: true });
});

test("a link in the document does not navigate the app window", async ({ page }) => {
  await page.locator("#ext").click();
  await expect(page).toHaveURL("http://localhost:1420/");
  await expect(page.locator("article h1")).toBeVisible();
});

test("a failed open shows the error and leaves the app usable", async ({ browser }) => {
  const page = await browser.newPage();
  await installFakeTauri(page, { failOpen: true });
  await page.goto("http://localhost:1420/");
  await page.getByRole("button", { name: "Quick open" }).click();
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
  await expect(page.getByRole("button", { name: "Quick open" })).toBeVisible();
  await page.close();
});
