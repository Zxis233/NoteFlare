import { describe, expect, it } from "vitest";
import {
  byteLength,
  parseSettings,
  randomId,
  validContent,
  validId,
} from "./helpers";
import { MAX_BYTES } from "../shared/types";
import { attachmentDefaults } from "../shared/attachments";

describe("content and settings boundaries", () => {
  it("enforces UTF-8 bytes instead of JS character count", () => {
    expect(byteLength("中文")).toBe(6);
    expect(validContent("a".repeat(MAX_BYTES))).toBe(true);
    expect(validContent("a".repeat(MAX_BYTES + 1))).toBe(false);
    expect(validContent("中".repeat(Math.ceil(MAX_BYTES / 3)))).toBe(false);
    expect(validContent(null)).toBe(false);
  });
  it("rejects unsafe URLs, credentials, invalid ranges and non-finite numbers", () => {
    const base = {
      backgroundUrl: "",
      overlay: 0.7,
      linkLength: 8,
      retentionDays: 30,
    };
    expect(parseSettings(base)).toEqual({ ...base, ...attachmentDefaults });
    for (const change of [
      { backgroundUrl: "javascript:alert(1)" },
      { backgroundUrl: "http://example.com/a.png" },
      { backgroundUrl: "https://user:pass@example.com/a.png" },
      { overlay: NaN },
      { overlay: 1.1 },
      { linkLength: 2 },
      { linkLength: 9 },
      { linkLength: 3.5 },
      { retentionDays: 0 },
      { retentionDays: 366 },
    ])
      expect(parseSettings({ ...base, ...change })).toBeNull();
  });
  it("only accepts supported bearer-link formats", () => {
    for (const id of ["abc", "AB12cd34"]) expect(validId(id)).toBe(true);
    for (const id of ["ab", "abcdefghi", "../admin", "abc_"])
      expect(validId(id)).toBe(false);
    for (const length of [3, 8]) {
      const id = randomId(length);
      expect(id.length).toBe(length);
      expect(validId(id)).toBe(true);
    }
  });
});
