import { expect, test, type Page } from "@playwright/test";
import { installFakeTauri, type FakeProject } from "./fakeTauri";

const alpha: FakeProject = {
  project_id: "proj_a",
  name: "Alpha",
  root_path: "/Users/me/Alpha",
  last_opened_at: new Date().toISOString(),
  missing: false,
};

test.beforeEach(async ({ page }) => {
  await installFakeTauri(page, { library: [alpha] });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Alpha" }).click();
  await page
    .getByRole("navigation", { name: "Documents" })
    .getByRole("button", { name: "plan.md" })
    .click();
  await page.getByRole("button", { name: "Source" }).click();
});

const type = async (page: Page, text: string) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
};
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) => (window as unknown as { __calls: { cmd: string }[] }).__calls.filter((x) => x.cmd === c),
    cmd,
  );

test("the source view shows the file, an edit marks the tab, and Cmd+S saves it", async ({
  page,
}) => {
  await expect(page.locator(".cm-content")).toContainText("The system must be local-first.");
  await type(page, "Added line.");
  await expect(
    page.getByRole("tab", { name: /plan\.md/ }).getByRole("img", { name: "unsaved changes" }),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("img", { name: "unsaved changes" })).toHaveCount(0);
  expect(await calls(page, "save_document")).toHaveLength(1);

  await page.getByRole("button", { name: "Rendered" }).click();
  await expect(page.locator("article")).toContainText("Added line.");
});

test("toggling makes no save", async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Rendered" }).click();
    await page.getByRole("button", { name: "Source" }).click();
  }
  expect(await calls(page, "save_document")).toHaveLength(0);
});

test("a save refused because the file changed opens the conflict dialog and keeps the text", async ({
  page,
}) => {
  await type(page, "My edit.");
  await page.evaluate(() => (window as unknown as { __externalEdit: () => void }).__externalEdit());
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alertdialog", { name: "File changed on disk" })).toBeVisible();
  await expect(page.getByRole("img", { name: "unsaved changes" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("My edit.");
});

test("Cmd+B wraps the selected text and Cmd+F opens find", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.locator(".cm-content")).toContainText("**# Plan");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(".cm-search")).toBeVisible();
});

test("closing an unsaved tab asks first", async ({ page }) => {
  await type(page, "x");
  await page.getByRole("button", { name: "Close plan.md" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("tab", { name: /plan\.md/ })).toBeVisible();
});
