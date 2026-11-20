import { expect, test, type Page } from "@playwright/test";
import { installFakeTauri, type FakeProject } from "./fakeTauri";

const project = (id: string, name: string, over: Partial<FakeProject> = {}): FakeProject => ({
  project_id: id,
  name,
  root_path: `/Users/me/${name}`,
  last_opened_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  missing: false,
  ...over,
});

const library = [project("proj_b", "Beta"), project("proj_a", "Alpha", { missing: true })];
const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) => (window as unknown as { __calls: { cmd: string }[] }).__calls.filter((x) => x.cmd === c),
    cmd,
  );

test("the home screen lists recent projects with a Folder missing badge", async ({ page }) => {
  await installFakeTauri(page, { library });
  await page.goto("/");
  const cards = page.locator(".project-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Beta");
  await expect(cards.nth(0)).toContainText("3 hours ago");
  await expect(cards.nth(0)).not.toContainText("Folder missing");
  await expect(cards.nth(1)).toContainText("Folder missing");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick open" })).toBeVisible();
});

test("opening a project shows it and sets the window title", async ({ page }) => {
  await installFakeTauri(page, { library });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Beta" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Beta" })).toBeFocused();
  await expect(page).toHaveTitle("Beta · LLM Review Workspace");
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page.locator(".project-card")).toHaveCount(2);
});

test("Remove asks first and removes nothing until confirmed", async ({ page }) => {
  await installFakeTauri(page, { library });
  await page.goto("/");
  await page.getByRole("button", { name: "Remove Beta" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("stay on your disk");
  expect(await calls(page, "remove_from_library")).toHaveLength(0);

  await page.getByRole("button", { name: "Keep" }).click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  expect(await calls(page, "remove_from_library")).toHaveLength(0);

  await page.getByRole("button", { name: "Remove Beta" }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);
  expect(await calls(page, "remove_from_library")).toHaveLength(1);
});

test("a cancelled folder dialog leaves the home screen as it was", async ({ page }) => {
  await installFakeTauri(page, { library, pick: null });
  await page.goto("/");
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Projects" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".project-card")).toHaveCount(2);
});

test("opening a project whose folder is gone shows an alert and stays home", async ({ page }) => {
  await installFakeTauri(page, { library });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Alpha" }).click();
  await expect(page.getByRole("alert")).toHaveText("that folder is gone");
  await expect(page.getByRole("heading", { level: 2, name: "Projects" })).toBeVisible();
});

test("Rename changes the card", async ({ page }) => {
  await installFakeTauri(page, { library });
  await page.goto("/");
  await page.getByRole("button", { name: "Rename Beta" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Gamma");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".project-card").first()).toContainText("Gamma");
});
