import { it, expect, vi } from "vitest";
import { collectAttachments, type AttachmentBindings } from "./attachments";
it("retains metadata and quota when R2 deletion fails, then releases only after success", async () => {
  const calls: string[] = [];
  const row = { id: "file", object_key: "generation/file" };
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        bind: () => statement,
        run: async () => {
          calls.push(sql);
          return {};
        },
        all: async () => {
          calls.push(sql);
          return { results: [row] };
        },
        first: async () => 1,
      };
      return statement;
    }),
  };
  const bucket = {
    delete: vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValue(undefined),
  };
  const env = { DB: db, ATTACHMENTS: bucket } as unknown as AttachmentBindings;
  const first = await collectAttachments(env);
  expect(first.deleted).toBe(0);
  expect(calls.some((s) => s.startsWith("DELETE FROM attachments"))).toBe(
    false,
  );
  expect(calls.some((s) => s.includes("failures=failures+1"))).toBe(true);
  calls.length = 0;
  expect((await collectAttachments(env)).deleted).toBe(1);
  expect(calls.some((s) => s.startsWith("DELETE FROM attachments"))).toBe(true);
});
