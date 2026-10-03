import {
  fileExtension,
  imageTypes,
  textExtensions,
} from "../shared/attachments";

// Conservative header sniffing, not a virus scanner. Only raster images inline.
export function sniffFile(name: string, head: Uint8Array): string | null {
  const ext = fileExtension(name);
  const at = (offset: number, bytes: number[]) =>
    bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, text: string) =>
    at(
      offset,
      [...text].map((c) => c.charCodeAt(0)),
    );
  if (ascii(0, "MZ") || at(0, [0x7f, 69, 76, 70])) return null;
  if (ext === "png")
    return at(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? imageTypes.png : null;
  if (ext === "jpg" || ext === "jpeg")
    return at(0, [255, 216, 255]) ? imageTypes.jpg : null;
  if (ext === "gif")
    return ascii(0, "GIF87a") || ascii(0, "GIF89a") ? imageTypes.gif : null;
  if (ext === "webp")
    return ascii(0, "RIFF") && ascii(8, "WEBP") ? imageTypes.webp : null;
  if (ext === "pdf")
    return ascii(0, "%PDF-") ? "application/octet-stream" : null;
  if (["zip", "docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(ext))
    return at(0, [80, 75, 3, 4]) || at(0, [80, 75, 5, 6])
      ? "application/octet-stream"
      : null;
  if (["doc", "xls", "ppt"].includes(ext))
    return at(0, [208, 207, 17, 224, 161, 177, 26, 225])
      ? "application/octet-stream"
      : null;
  if (ext === "7z")
    return at(0, [55, 122, 188, 175, 39, 28])
      ? "application/octet-stream"
      : null;
  if (ext === "rar")
    return at(0, [82, 97, 114, 33, 26, 7]) ? "application/octet-stream" : null;
  if (ext === "gz" || ext === "tgz")
    return at(0, [31, 139]) ? "application/octet-stream" : null;
  if (ext === "tar")
    return ascii(257, "ustar") ? "application/octet-stream" : null;
  if (textExtensions.has(ext) || name.toLowerCase() === "makefile") {
    // UTF-16 BOMs are common for PowerShell; all text is served as a download.
    if (at(0, [255, 254]) || at(0, [254, 255]))
      return "application/octet-stream";
    if (head.some((b) => b === 0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(head, {
        stream: true,
      });
      return "application/octet-stream";
    } catch {
      return null;
    }
  }
  return null;
}
