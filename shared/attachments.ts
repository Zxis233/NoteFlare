export const MiB = 1024 * 1024;
export const attachmentDefaults = {
  uploadsEnabled: true,
  maxFileBytes: 10 * MiB,
  maxNoteFiles: 5,
  maxNoteBytes: 50 * MiB,
  maxTotalBytes: 1024 * MiB,
};
export type AttachmentSettings = typeof attachmentDefaults;
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  state: "pending" | "ready" | "deleting";
  createdAt: number;
}
export interface AttachmentUsage {
  usedBytes: number;
  reservedBytes: number;
  deletingBytes: number;
  count: number;
  pendingCount: number;
  deletingCount: number;
  failedCount: number;
}
export const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export const textExtensions = new Set([
  "txt",
  "md",
  "markdown",
  "v",
  "vh",
  "sv",
  "svh",
  "json",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hxx",
  "py",
  "ini",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "css",
  "tcl",
  "tk",
  "diff",
  "patch",
  "mk",
  "mak",
  "ps1",
  "psm1",
  "psd1",
]);
export const binaryExtensions = new Set([
  "pdf",
  "doc",
  "xls",
  "ppt",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "zip",
  "7z",
  "rar",
  "tar",
  "gz",
  "tgz",
]);
export function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}
export function allowedFilename(name: unknown): name is string {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    new TextEncoder().encode(name).length > 240 ||
    /[\x00-\x1f\x7f/\\]/.test(name)
  )
    return false;
  return (
    name.toLowerCase() === "makefile" ||
    textExtensions.has(fileExtension(name)) ||
    binaryExtensions.has(fileExtension(name)) ||
    Object.hasOwn(imageTypes, fileExtension(name))
  );
}
export const fileAccept = [
  ...Object.keys(imageTypes),
  ...textExtensions,
  ...binaryExtensions,
]
  .map((ext) => `.${ext}`)
  .join(",");
export function formatBytes(bytes: number) {
  if (bytes >= 1024 * MiB) return `${(bytes / (1024 * MiB)).toFixed(2)} GiB`;
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
