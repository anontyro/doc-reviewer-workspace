import { expect, test } from "@playwright/test";
import { installFakeTauri, selectPhrase, type FakeProject } from "./fakeTauri";

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
});

const comment = async (page: import("@playwright/test").Page, phrase: string, text: string) => {
  await selectPhrase(page, phrase);
  await page.keyboard.press("Meta+Shift+M");
  await page.getByLabel("Comment", { exact: true }).fill(text);
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator(".comment-text")).toHaveText(text);
};

test("opening a project lists its documents, never dot-files, and opens one in a tab", async ({
  page,
}) => {
  const explorer = page.getByRole("navigation", { name: "Documents" });
  await expect(explorer.getByRole("button", { name: "plan.md" })).toBeVisible();
  await expect(explorer.getByRole("button", { name: "notes.md" })).toBeVisible();
  await expect(explorer).not.toContainText(".tmp");

  await explorer.getByRole("button", { name: "plan.md" }).click();
  await expect(page.getByRole("tab", { name: "plan.md" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("article h1")).toHaveText("Plan");
});

test("each tab keeps its own comments, and a comment in one tab is not shown in another", async ({
  page,
}) => {
  const explorer = page.getByRole("navigation", { name: "Documents" });
  await explorer.getByRole("button", { name: "plan.md" }).click();
  await comment(page, "Use the cache", "plan comment");

  await explorer.getByRole("button", { name: "notes.md" }).click();
  await expect(page.locator("article h1")).toHaveText("Notes");
  await expect(page.locator(".comment-text")).toHaveCount(0);
  await comment(page, "Second document", "notes comment");

  await page.getByRole("tab", { name: "plan.md" }).click();
  await expect(page.locator("article h1")).toHaveText("Plan");
  await expect(page.locator(".comment-text")).toHaveText("plan comment");
  await page.getByRole("tab", { name: "notes.md" }).click();
  await expect(page.locator(".comment-text")).toHaveText("notes comment");
});

test("arrow keys move between tabs and closing the last tab shows the empty state", async ({
  page,
}) => {
  const explorer = page.getByRole("navigation", { name: "Documents" });
  await explorer.getByRole("button", { name: "plan.md" }).click();
  await explorer.getByRole("button", { name: "notes.md" }).click();
  await page.getByRole("tab", { name: "notes.md" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "plan.md" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "plan.md" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Close plan.md" }).click();
  await expect(page.getByRole("tab", { name: "notes.md" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Close notes.md" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Select a document to open it.")).toBeVisible();
});

test("collapsing the sidebars by shortcut keeps the document and its scroll position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 260 });
  await page
    .getByRole("navigation", { name: "Documents" })
    .getByRole("button", { name: "plan.md" })
    .click();
  const centre = page.locator(".workspace-centre");
  await centre.evaluate((el) => (el.scrollTop = 40));
  const before = await centre.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);

  await page.keyboard.press("Meta+\\");
  await expect(page.getByRole("navigation", { name: "Documents" })).toBeHidden();
  await page.keyboard.press("Meta+Shift+\\");
  await expect(page.getByRole("complementary", { name: "Comments and export" })).toBeHidden();
  expect(await centre.evaluate((el) => el.scrollTop)).toBe(before);

  await page.keyboard.press("Meta+\\");
  await expect(page.getByRole("navigation", { name: "Documents" })).toBeVisible();
  await expect(page.locator("article h1")).toHaveText("Plan");
});

test("Quick open shows one document, no explorer, and says it is not in a project", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("button", { name: "Quick open" }).click();
  await expect(page.getByText("Not in a project")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Documents" })).toHaveCount(0);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.locator("article h1")).toHaveText("Plan");
});
