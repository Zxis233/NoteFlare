import { describe, it, expect } from "vitest";
import { sniffFile } from "./attachment-files";
import {
  allowedFilename,
  attachmentDefaults,
  MiB,
} from "../shared/attachments";
import { parseSettings } from "./helpers";
describe("attachment validation", () => {
  it("accepts selected file extensions and rejects paths, executables, SVG and controls", () => {
    for (const name of [
      "测试.png",
      "Makefile",
      "script.ps1",
      "module.sv",
      "archive.tar.gz",
      "表格.xlsx",
    ])
      expect(allowedFilename(name)).toBe(true);
    for (const name of [
      "bad.exe",
      "bad.svg",
      "../a.txt",
      "x\\a.txt",
      "a\r\n.txt",
      "x".repeat(250) + ".txt",
    ])
      expect(allowedFilename(name)).toBe(false);
  });
  it("does not trust image names or executable files renamed as text", () => {
    const bytes = new TextEncoder();
    expect(sniffFile("image.png", bytes.encode("<svg/>"))).toBeNull();
    expect(sniffFile("file.txt", bytes.encode("MZ executable"))).toBeNull();
    expect(sniffFile("file.txt", bytes.encode("中文 and code"))).toBe(
      "application/octet-stream",
    );
    expect(
      sniffFile("file.html", bytes.encode("<script>alert(1)</script>")),
    ).toBe("application/octet-stream");
  });
  it("enforces sane admin bounds without deleting existing files", () => {
    const base = {
      backgroundUrl: "",
      overlay: 0.5,
      linkLength: 8,
      retentionDays: 30,
      ...attachmentDefaults,
    };
    for (const patch of [
      { maxFileBytes: 51 * MiB },
      { maxNoteFiles: 0 },
      { maxNoteBytes: MiB },
      { maxTotalBytes: MiB },
      { uploadsEnabled: "yes" },
    ])
      expect(parseSettings({ ...base, ...patch })).toBeNull();
    expect(
      parseSettings({
        ...base,
        maxFileBytes: MiB,
        maxNoteBytes: MiB,
        maxTotalBytes: MiB,
      }),
    ).not.toBeNull();
  });
});
