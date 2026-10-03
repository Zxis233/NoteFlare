import { MAX_BYTES, type Settings } from "../shared/types";
import { attachmentDefaults, MiB } from "../shared/attachments";

export const validId = (id: string) => /^[A-Za-z0-9]{3,8}$/.test(id);
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;
export const validContent = (value: unknown): value is string =>
  typeof value === "string" && byteLength(value) <= MAX_BYTES;

export function randomId(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // Reject the biased tail instead of reducing all 256 values modulo 62.
      if (byte < 248) result += alphabet[byte % 62];
      if (result.length === length) break;
    }
  }
  return result;
}

export function parseSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const s = { ...attachmentDefaults, ...value } as Settings;
  if (typeof s.backgroundUrl !== "string" || s.backgroundUrl.length > 2048)
    return null;
  if (s.backgroundUrl) {
    try {
      const url = new URL(s.backgroundUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
    } catch {
      return null;
    }
  }
  if (
    typeof s.overlay !== "number" ||
    !Number.isFinite(s.overlay) ||
    s.overlay < 0 ||
    s.overlay > 1
  )
    return null;
  if (!Number.isInteger(s.linkLength) || s.linkLength < 3 || s.linkLength > 8)
    return null;
  if (
    !Number.isInteger(s.retentionDays) ||
    s.retentionDays < 1 ||
    s.retentionDays > 365
  )
    return null;
  if (typeof s.uploadsEnabled !== "boolean") return null;
  if (
    !Number.isSafeInteger(s.maxFileBytes) ||
    s.maxFileBytes < MiB ||
    s.maxFileBytes > 50 * MiB ||
    s.maxFileBytes % MiB
  )
    return null;
  if (
    !Number.isSafeInteger(s.maxNoteFiles) ||
    s.maxNoteFiles < 1 ||
    s.maxNoteFiles > 100
  )
    return null;
  if (
    !Number.isSafeInteger(s.maxNoteBytes) ||
    s.maxNoteBytes < s.maxFileBytes ||
    s.maxNoteBytes > 1024 * MiB ||
    s.maxNoteBytes % MiB
  )
    return null;
  if (
    !Number.isSafeInteger(s.maxTotalBytes) ||
    s.maxTotalBytes < s.maxNoteBytes ||
    s.maxTotalBytes > 100 * 1024 * MiB ||
    s.maxTotalBytes % MiB
  )
    return null;
  return {
    backgroundUrl: s.backgroundUrl,
    overlay: s.overlay,
    linkLength: s.linkLength,
    retentionDays: s.retentionDays,
    uploadsEnabled: s.uploadsEnabled,
    maxFileBytes: s.maxFileBytes,
    maxNoteFiles: s.maxNoteFiles,
    maxNoteBytes: s.maxNoteBytes,
    maxTotalBytes: s.maxTotalBytes,
  };
}
