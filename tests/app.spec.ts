import { test, expect } from "@playwright/test";

test("desktop: save, markdown safety, restore, autosave and preview preference", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9]{8}$/);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.fill(
    "# Hello NoteFlare\n\n**中文笔记**\n\n<script>window.hacked = true</script>",
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByText("已保存至云端", { exact: true })).toBeVisible();
  await expect(page.locator(".markdown-body h1")).toHaveText("Hello NoteFlare");
  const textLine = await page.locator(".cm-line").first().boundingBox();
  const lineNumber = await page
    .locator(".cm-lineNumbers .cm-gutterElement")
    .filter({ hasText: /^1$/ })
    .boundingBox();
  expect(Math.abs(textLine!.y - lineNumber!.y)).toBeLessThan(3);
  expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined();
  await page.screenshot({
    path: "test-results/editor-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(editor).toContainText("中文笔记");
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".preview-pane")).toBeHidden();
  await page.reload();
  await expect(page.locator(".preview-pane")).toBeHidden();
  await editor.fill("# Autosaved");
  await expect(page.getByText("已保存至云端", { exact: true })).toBeVisible({
    timeout: 35_000,
  });
  await editor.fill("未保存的本地草稿");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(editor).toContainText("未保存的本地草稿");
  await expect(page.getByText("已恢复此设备上的未保存草稿。")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile: switches preview without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".cm-content").fill("# 手机笔记\n\n移动端预览");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator(".preview-pane")).toBeVisible();
  await expect(page.locator(".edit-pane")).toBeHidden();
  await expect(page.locator(".markdown-body h1")).toHaveText("手机笔记");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/editor-mobile.png",
    fullPage: true,
  });
});

test("admin: settings, live preview and destructive confirmation", async ({
  page,
}) => {
  await page.route("https://images.example.com/background.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#334155"/></svg>',
    }),
  );
  await page.goto("/admin");
  await expect(page.getByText("活跃笔记", { exact: true })).toBeVisible();
  await page.getByLabel("随机链接长度").selectOption("3");
  await page.getByLabel("笔记保留天数").fill("15");
  await page.getByLabel("深色遮罩强度").fill("0.6");
  await page
    .getByLabel("背景图片地址")
    .fill("https://images.example.com/background.svg");
  await expect(page.getByAltText("背景预览")).toBeVisible();
  await page.getByRole("button", { name: "保存全部设置" }).click();
  await expect(page.getByText("设置已保存。")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("随机链接长度")).toHaveValue("3");
  await expect(page.getByLabel("笔记保留天数")).toHaveValue("15");
  await expect(page.locator(".background img")).toBeAttached();
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "清空全部笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认清空" })).toBeDisabled();
  await page.getByLabel("请输入“清空全部”确认").fill("清空全部");
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(/清理完成，共删除/)).toBeVisible();
});
