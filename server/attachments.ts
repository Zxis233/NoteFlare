import { Hono } from "hono";
import { DAY } from "../shared/types";
import {
  allowedFilename,
  type Attachment,
  type AttachmentUsage,
} from "../shared/attachments";
import { sniffFile } from "./attachment-files";

export interface AttachmentBindings {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  UPLOAD_LIMITER: RateLimit;
}
interface Row extends Attachment {
  note_generation: string;
  object_key: string;
  started_at: number | null;
  delete_after: number;
}
const columns =
  "id, name, size, mime, state, created_at AS createdAt, note_generation, object_key, started_at, delete_after";
const publicRow = (r: Row): Attachment => ({
  id: r.id,
  name: r.name,
  size: r.size,
  mime: r.mime,
  state: r.state,
  createdAt: r.createdAt,
});
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const live = "SELECT generation FROM notes WHERE id=? AND expires_at>?";
const routes = new Hono<{ Bindings: AttachmentBindings }>();

export async function attachmentUsage(
  db: D1Database,
): Promise<AttachmentUsage> {
  return (await db
    .prepare(
      `SELECT
    coalesce(sum(CASE WHEN state='ready' THEN size ELSE 0 END),0) AS usedBytes,
    coalesce(sum(CASE WHEN state='pending' THEN size ELSE 0 END),0) AS reservedBytes,
    coalesce(sum(CASE WHEN state='deleting' THEN size ELSE 0 END),0) AS deletingBytes,
    count(CASE WHEN state='ready' THEN 1 END) AS count,
    count(CASE WHEN state='pending' THEN 1 END) AS pendingCount,
    count(CASE WHEN state='deleting' THEN 1 END) AS deletingCount,
    count(CASE WHEN failures>0 THEN 1 END) AS failedCount FROM attachments`,
    )
    .first<AttachmentUsage>())!;
}

// Never release a reservation until R2 deletion has succeeded. Pending uploads
// keep a 24h grace period, longer than our 5 minute upload deadline, to avoid a
// concurrent DELETE followed by a late PUT leaving an untracked object.
export async function collectAttachments(env: AttachmentBindings, limit = 10) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE attachments SET state='deleting',changed_at=? WHERE state='pending' AND delete_after<=?`,
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    `UPDATE attachments SET state='deleting',changed_at=? WHERE state='ready' AND NOT EXISTS
    (SELECT 1 FROM notes WHERE generation=attachments.note_generation AND expires_at>?)`,
  )
    .bind(now, now)
    .run();
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM attachments WHERE state='deleting' AND delete_after<=? AND retry_at<=? LIMIT ?`,
  )
    .bind(now, now, Math.min(limit, 200))
    .all<Row>();
  let deleted = 0;
  // Group R2 + SQL operations to stay within Free invocation query limits.
  for (let offset = 0; offset < rows.results.length; offset += 50) {
    const group = rows.results.slice(offset, offset + 50);
    const placeholders = group.map(() => "?").join(",");
    try {
      await env.ATTACHMENTS.delete(group.map((row) => row.object_key));
      const result = await env.DB.prepare(
        `DELETE FROM attachments WHERE id IN (${placeholders}) AND state='deleting' RETURNING id`,
      )
        .bind(...group.map((row) => row.id))
        .all();
      deleted += result.results.length;
    } catch {
      await env.DB.prepare(
        `UPDATE attachments SET failures=failures+1, retry_at=? WHERE id IN (${placeholders})`,
      )
        .bind(now + 60_000, ...group.map((row) => row.id))
        .run();
    }
  }
  const remaining = await env.DB.prepare(
    "SELECT count(*) AS n FROM attachments WHERE state='deleting'",
  ).first<number>("n");
  const actionable = await env.DB.prepare(
    "SELECT count(*) AS n FROM attachments WHERE state='deleting' AND delete_after<=? AND retry_at<=?",
  )
    .bind(Date.now(), Date.now())
    .first<number>("n");
  return { deleted, remaining: remaining || 0, actionable: actionable || 0 };
}

routes.get("/:id/attachments", async (c) => {
  const note = await c.env.DB.prepare(live)
    .bind(c.req.param("id"), Date.now())
    .first<{ generation: string }>();
  if (!note) return c.json({ error: "笔记不存在或已过期。" }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT ${columns} FROM attachments WHERE note_generation=? ORDER BY created_at`,
  )
    .bind(note.generation)
    .all<Row>();
  return c.json({ attachments: rows.results.map(publicRow) });
});

routes.post("/:id/attachments", async (c) => {
  if (
    !(
      await c.env.UPLOAD_LIMITER.limit({
        key: c.req.header("cf-connecting-ip") || "local",
      })
    ).success
  )
    return c.json({ error: "上传过于频繁，请稍后再试。" }, 429);
  const body = await c.req.json<{ id: string; name: string; size: number }>();
  if (
    !body ||
    !uuid(body.id) ||
    !allowedFilename(body.name) ||
    !Number.isSafeInteger(body.size) ||
    body.size <= 0
  )
    return c.json(
      { error: "文件名、类型或大小不符合要求；不支持空文件。" },
      400,
    );
  const now = Date.now();
  const note = await c.env.DB.prepare(
    "SELECT generation FROM notes WHERE id=? AND expires_at>? AND length(trim(content))>0",
  )
    .bind(c.req.param("id"), now)
    .first<{ generation: string }>();
  if (!note)
    return c.json({ error: "请先保存非空正文，且笔记不能已过期。" }, 409);
  const existing = await c.env.DB.prepare(
    `SELECT ${columns} FROM attachments WHERE id=?`,
  )
    .bind(body.id)
    .first<Row>();
  if (existing) {
    if (
      existing.note_generation !== note.generation ||
      existing.name !== body.name ||
      existing.size !== body.size
    )
      return c.json({ error: "上传标识冲突。" }, 409);
    return c.json(publicRow(existing));
  }
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO attachments(id,note_generation,object_key,name,size,created_at,changed_at,delete_after)
      VALUES(?,?,?,?,?,?,?,?) RETURNING ${columns}`,
    )
      .bind(
        body.id,
        note.generation,
        `${note.generation}/${body.id}`,
        body.name,
        body.size,
        now,
        now,
        now + DAY,
      )
      .first<Row>();
    return c.json(publicRow(row!), 201);
  } catch (e) {
    const error = String(e);
    if (error.includes("ATTACHMENT_QUOTA"))
      return c.json(
        { error: "附件数量或容量已达上限，待清理和上传中的文件也占用额度。" },
        409,
      );
    if (error.includes("ATTACHMENT_DISABLED"))
      return c.json({ error: "管理员已关闭新附件上传。" }, 403);
    if (error.includes("ATTACHMENT_NOTE_UNAVAILABLE"))
      return c.json({ error: "笔记已过期或被删除。" }, 404);
    throw e;
  }
});

routes.put("/:id/attachments/:attachment/content", async (c) => {
  if (c.req.header("content-type") !== "application/octet-stream")
    return c.json({ error: "上传必须为二进制文件。" }, 415);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `UPDATE attachments SET started_at=?,delete_after=? WHERE id=? AND state='pending' AND started_at IS NULL AND delete_after>?
    AND EXISTS(SELECT 1 FROM notes WHERE id=? AND generation=attachments.note_generation AND expires_at>?)
    AND EXISTS(SELECT 1 FROM settings WHERE uploads_enabled=1 AND max_file_bytes>=attachments.size)
    RETURNING ${columns}`,
  )
    .bind(
      now,
      now + DAY,
      c.req.param("attachment"),
      now,
      c.req.param("id"),
      now,
    )
    .first<Row>();
  if (!row)
    return c.json(
      { error: "上传不可用：已开始、已过期、已删除或上传已关闭。" },
      409,
    );
  const declared = c.req.header("content-length");
  if (declared && Number(declared) !== row.size) {
    await c.env.DB.prepare(
      "UPDATE attachments SET state='deleting' WHERE id=? AND state='pending'",
    )
      .bind(row.id)
      .run();
    return c.json({ error: "文件大小与声明不一致。" }, 400);
  }
  const reader = c.req.raw.body?.getReader();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    void reader?.cancel().catch(() => {});
  }, 300_000);
  try {
    if (!reader) throw new Error("文件内容为空。");
    let total = 0;
    const chunks: Uint8Array[] = [];
    const head = new Uint8Array(Math.min(512, row.size));
    let filled = 0;
    while (filled < head.length) {
      const { done, value } = await reader.read();
      if (done) throw new Error("文件内容不完整。");
      total += value.length;
      if (total > row.size) throw new Error("文件超过声明大小。");
      chunks.push(value);
      const part = value.subarray(0, head.length - filled);
      head.set(part, filled);
      filled += part.length;
    }
    const mime = sniffFile(row.name, head);
    if (!mime) throw new Error("文件内容与扩展名不匹配，或文件类型不支持。");
    const source = new ReadableStream<Uint8Array>({
      async pull(stream) {
        if (controller.signal.aborted) {
          stream.error(new Error("上传超时。"));
          return;
        }
        if (chunks.length) {
          stream.enqueue(chunks.shift()!);
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (total !== row.size) throw new Error("文件内容不完整。");
            stream.close();
            return;
          }
          total += value.length;
          if (total > row.size) throw new Error("文件超过声明大小。");
          stream.enqueue(value);
        } catch (e) {
          stream.error(e);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    const fixed = new FixedLengthStream(row.size);
    const pumping = source.pipeTo(fixed.writable, {
      signal: controller.signal,
    });
    const writing = c.env.ATTACHMENTS.put(row.object_key, fixed.readable, {
      httpMetadata: { contentType: mime },
    });
    // Abort the producer if R2 rejects early; always observe both promises.
    const results = await Promise.allSettled([
      pumping,
      writing.catch((e) => {
        controller.abort();
        throw e;
      }),
    ]);
    if (results.some((r) => r.status === "rejected"))
      throw new Error("上传未完成，请重试。");
    const completed = await c.env.DB.prepare(
      `UPDATE attachments SET state='ready',mime=?,delete_after=0,changed_at=? WHERE id=? AND state='pending'
      AND EXISTS(SELECT 1 FROM notes WHERE generation=attachments.note_generation AND expires_at>?) RETURNING ${columns}`,
    )
      .bind(mime, Date.now(), row.id, Date.now())
      .first<Row>();
    if (!completed) throw new Error("上传期间笔记已过期或被删除。");
    return c.json(publicRow(completed));
  } catch (e) {
    controller.abort();
    void reader?.cancel().catch(() => {});
    // Keep the object tracked even if cleanup fails. The grace period also
    // covers a remote PUT whose result is uncertain after a transport failure.
    await c.env.DB.prepare(
      "UPDATE attachments SET state='deleting' WHERE id=? AND state='pending'",
    )
      .bind(row.id)
      .run();
    return c.json(
      {
        error:
          e instanceof Error && /文件|上传/.test(e.message)
            ? e.message
            : "上传失败，请重试。",
      },
      400,
    );
  } finally {
    clearTimeout(timeout);
  }
});

routes.delete("/:id/attachments/:attachment", async (c) => {
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `UPDATE attachments SET state='deleting',changed_at=? WHERE id=? AND state!='deleting'
    AND EXISTS(SELECT 1 FROM notes WHERE id=? AND generation=attachments.note_generation AND expires_at>?) RETURNING ${columns}`,
  )
    .bind(now, c.req.param("attachment"), c.req.param("id"), now)
    .first<Row>();
  if (!row) {
    const exists = await c.env.DB.prepare(
      `SELECT 1 FROM attachments a JOIN notes n ON n.generation=a.note_generation WHERE a.id=? AND n.id=? AND n.expires_at>? AND a.state='deleting'`,
    )
      .bind(c.req.param("attachment"), c.req.param("id"), now)
      .first();
    if (!exists) return c.json({ error: "附件不存在或笔记已过期。" }, 404);
  }
  await collectAttachments(c.env, 10);
  return c.json({ ok: true });
});

routes.get("/:id/attachments/:attachment/file", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT ${columns
      .split(", ")
      .map((x) => `a.${x}`)
      .join(", ")} FROM attachments a
    JOIN notes n ON n.generation=a.note_generation WHERE a.id=? AND n.id=? AND a.state='ready' AND n.expires_at>?`,
  )
    .bind(c.req.param("attachment"), c.req.param("id"), Date.now())
    .first<Row>();
  if (!row) return c.json({ error: "附件不存在或已过期。" }, 404);
  const object = await c.env.ATTACHMENTS.get(row.object_key);
  if (!object) return c.json({ error: "附件文件暂不可用。" }, 404);
  const inline =
    row.mime.startsWith("image/") && c.req.query("download") !== "1";
  const filename = encodeURIComponent(row.name).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16)}`,
  );
  return new Response(object.body, {
    headers: {
      "Content-Type": inline ? row.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${filename}`,
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
export { routes as attachmentRoutes };
