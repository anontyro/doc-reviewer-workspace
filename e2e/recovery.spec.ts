import { expect, test, type Page } from "@playwright/test";
import { installFakeTauri, type FakeProject } from "./fakeTauri";

const alpha: FakeProject = {
  project_id: "proj_a",
  name: "Alpha",
  root_path: "/Users/me/Alpha",
  last_opened_at: new Date().toISOString(),
  missing: false,
};

const open = async (page: Page, setup?: () => Promise<void>) => {
  await installFakeTauri(page, { library: [alpha] });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Alpha" }).click();
  await setup?.();
  await page
    .getByRole("navigation", { name: "Documents" })
    .getByRole("button", { name: "plan.md" })
    .click();
};
const toSource = (page: Page) => page.getByRole("button", { name: "Source" }).click();
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
const fake = (page: Page, fn: "__externalEdit" | "__deleteFile") =>
  page.evaluate((f) => (window as unknown as Record<string, () => void>)[f](), fn);
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const unsaved = (page: Page) => page.getByRole("img", { name: "unsaved changes" });

test.describe("conflict dialog", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await toSource(page);
    await type(page, "My edit.");
    await fake(page, "__externalEdit");
    await focus(page);
    await expect(page.getByRole("alertdialog", { name: "File changed on disk" })).toBeVisible();
  });

  test("Keep editing is the default and writes nothing", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(unsaved(page)).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("My edit.");
    expect(await calls(page, "save_document")).toHaveLength(0);
  });

  test("Load the disk version keeps the user's text as a backup, then reloads", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Load the disk version" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(unsaved(page)).toHaveCount(0);
    expect(await calls(page, "backup_text")).toHaveLength(1);
    expect(await calls(page, "save_document")).toHaveLength(0);
  });

  test("Overwrite asks twice, and only the second confirmation saves", async ({ page }) => {
    await page.getByRole("button", { name: "Overwrite the disk version" }).click();
    expect(await calls(page, "save_document")).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.getByRole("button", { name: "Yes, overwrite the disk version" }).click();
    await expect(unsaved(page)).toHaveCount(0);
    expect(await calls(page, "save_document")).toHaveLength(1);
  });
});

test("a file deleted behind the app's back says so and turns saving off", async ({ page }) => {
  await open(page);
  await toSource(page);
  await type(page, "x");
  await fake(page, "__deleteFile");
  await focus(page);
  await expect(page.locator(".banner")).toContainText("no longer where it was");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a clean tab whose file changed shows Reload and reloads only on click", async ({ page }) => {
  await open(page);
  await fake(page, "__externalEdit");
  await focus(page);
  await expect(page.locator(".banner")).toContainText("changed on disk");
  const before = (await calls(page, "open_project_document")).length;
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator(".banner")).toHaveCount(0);
  expect((await calls(page, "open_project_document")).length).toBe(before + 1);
});

test("a draft left by a crashed session is offered, and Restore brings the text back", async ({
  page,
}) => {
  await open(page, async () => {
    await page.evaluate(() =>
      (window as unknown as { __setDraft: (n: string, t: string, b: string) => void }).__setDraft(
        "plan.md",
        "# Plan\n\ntext typed before the crash\n",
        "1".repeat(64),
      ),
    );
  });
  await expect(page.getByRole("alertdialog", { name: "Unsaved text found" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".cm-content")).toContainText("text typed before the crash");
  await expect(unsaved(page)).toBeVisible();

  // The file is not the one the draft was made from, so saving goes to the conflict dialog.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alertdialog", { name: "File changed on disk" })).toBeVisible();
});

test("Discard throws the draft away", async ({ page }) => {
  await open(page, async () => {
    await page.evaluate(() =>
      (window as unknown as { __setDraft: (n: string, t: string, b: string) => void }).__setDraft(
        "plan.md",
        "stale draft",
        "0".repeat(64),
      ),
    );
  });
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await calls(page, "clear_draft")).toHaveLength(1);
  await expect(unsaved(page)).toHaveCount(0);
});
