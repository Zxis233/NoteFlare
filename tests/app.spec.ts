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

test("attachments wait for an in-flight save and preserve edits made during upload", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.waitFor();
  await editor.fill("original");
  let release: (() => void) | undefined;
  let first = true;
  await page.route("**/api/notes/*", async (route) => {
    if (route.request().method() === "PUT" && first) {
      first = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await editor.fill("edited while saving");
  await page.getByLabel("选择附件").setInputFiles({
    name: "race.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("saved first"),
  });
  release!();
  await expect(page.locator(".attachment-row")).toHaveCount(1);
  const id = new URL(page.url()).pathname.split("/").pop();
  expect(
    (await (await page.request.get(`/api/notes/${id}`)).json()).content,
  ).toBe("edited while saving");
  await expect(editor).toHaveText("edited while saving");
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

test("attachments: save before upload, images, paste/drop, download, deletion and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.waitFor();
  const picker = page.getByLabel("选择附件");
  await picker.setInputFiles({
    name: "empty-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("no text yet"),
  });
  await expect(
    page.getByText("请先输入非空正文，再上传附件。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("移除失败记录").click();
  await editor.fill("# 附件测试\n\n先保存正文，再传文件。");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  await picker.setInputFiles([
    { name: "截图.png", mimeType: "image/png", buffer: png },
    {
      name: "示例.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("附件 UTF-8 内容"),
    },
  ]);
  await expect(page.locator(".attachment-row")).toHaveCount(2);
  await expect(editor).toContainText("![截图.png]");
  await expect(page.locator(".markdown-body img")).toBeVisible();
  await expect(page.getByText("已保存至云端", { exact: true })).toBeVisible();
  const noteId = new URL(page.url()).pathname.split("/").pop();
  const remote = await (await page.request.get(`/api/notes/${noteId}`)).json();
  expect(remote.content).toContain("![截图.png]");
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("下载 示例.txt").click();
  expect((await downloadPromise).suggestedFilename()).toBe("示例.txt");
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "粘贴.png", { type: "image/png" }),
    );
    document.querySelector(".cm-content")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(png));
  await expect(page.locator(".attachment-row")).toHaveCount(3);
  await expect(editor).toContainText("![粘贴.png]");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(['puts "hello"'], "test.tcl", { type: "text/plain" }),
    );
    document.querySelector(".workspace")!.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".attachment-row")).toHaveCount(4);
  await page.getByLabel("删除 截图.png").click();
  await page.getByRole("button", { name: "确认删除附件" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".attachment-row")).toHaveCount(3);
  await expect(editor).toContainText("![截图.png]");
  await page.screenshot({
    path: "test-results/attachments-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/attachments-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
