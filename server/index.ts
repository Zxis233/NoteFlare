import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { DAY, MAX_BYTES, type Settings, type Note } from "../shared/types";
import { parseSettings, randomId, validContent, validId } from "./helpers";

interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  CREATE_LIMITER: RateLimit;
  WRITE_LIMITER: RateLimit;
  READ_LIMITER: RateLimit;
  ALLOW_LOCAL_ADMIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  APP_SECRET?: string;
}
const app = new Hono<{ Bindings: Bindings }>();
const local = (request: Request) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
const localMode = (request: Request, env: Bindings) =>
  local(request) && env.ALLOW_LOCAL_ADMIN === "true";
const noteColumns =
  "id, content, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt";
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function secret(request: Request, env: Bindings) {
  const value =
    env.APP_SECRET ||
    (localMode(request, env)
      ? "local-development-only-do-not-use-on-public-host"
      : "");
  if (value.length < 32) throw new Error("APP_SECRET is not configured");
  return new TextEncoder().encode(value);
}
async function settings(db: D1Database): Promise<Settings> {
  const row = await db
    .prepare(
      "SELECT background_url AS backgroundUrl, overlay, link_length AS linkLength, retention_days AS retentionDays FROM settings WHERE id = 1",
    )
    .first<Settings>();
  if (!row) throw new Error("Database migrations have not been applied");
  return row;
}
async function authorize(request: Request, env: Bindings): Promise<boolean> {
  if (localMode(request, env)) return true;
  const domain = env.ACCESS_TEAM_DOMAIN || "";
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD)
    return false;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  try {
    const issuer = `https://${domain}`;
    let jwks = jwksCache.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      jwksCache.set(issuer, jwks);
    }
    await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    return true;
  } catch {
    return false;
  }
}

app.use("*", async (c, next) => {
  await next();
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' https: data:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (
    c.req.path.startsWith("/api/") ||
    c.req.path.startsWith("/admin") ||
    c.req.path.startsWith("/n/")
  )
    c.header("Cache-Control", "no-store");
});

app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const expected = new URL(c.req.url).origin;
    // Vite and Wrangler run on separate localhost ports during development.
    const allowedLocal =
      localMode(c.req.raw, c.env) &&
      (origin === "http://127.0.0.1:5173" ||
        origin === "http://localhost:5173");
    if (origin && origin !== expected && !allowedLocal)
      return c.json({ error: "不允许跨站请求。" }, 403);
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return c.json({ error: "请求必须使用 JSON。" }, 415);
    // Bound the actual stream, not just Content-Length (which can be absent).
    const length = Number(c.req.header("content-length") || 0);
    if (length > MAX_BYTES * 6 + 4096)
      return c.json({ error: "请求过大。" }, 413);
    const reader = c.req.raw.body?.getReader();
    if (reader) {
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES * 6 + 4096) {
          await reader.cancel();
          return c.json({ error: "请求过大。" }, 413);
        }
        chunks.push(value);
      }
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        c.req.bodyCache.json = Promise.resolve(
          JSON.parse(new TextDecoder().decode(all)),
        );
      } catch {
        return c.json({ error: "JSON 格式无效。" }, 400);
      }
    }
  }
  await next();
});

app.use("/api/admin/*", async (c, next) => {
  if (!(await authorize(c.req.raw, c.env)))
    return c.json(
      { error: "管理员身份验证失败。请通过 Cloudflare Access 登录。" },
      401,
    );
  await next();
});

app.get("/api/config", async (c) => c.json(await settings(c.env.DB)));
app.post("/api/new", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await c.env.CREATE_LIMITER.limit({ key: ip })).success)
    return c.json({ error: "创建过于频繁，请稍后再试。" }, 429);
  const config = await settings(c.env.DB);
  for (let i = 0; i < 12; i++) {
    const id = randomId(config.linkLength);
    if (
      await c.env.DB.prepare("SELECT id FROM notes WHERE id = ?")
        .bind(id)
        .first()
    )
      continue;
    const createToken = await new SignJWT({ id, purpose: "create" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret(c.req.raw, c.env));
    return c.json({ id, createToken });
  }
  return c.json({ error: "此链接长度的可用空间不足，请管理员增加长度。" }, 503);
});
app.use("/api/notes/*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  const limiter =
    c.req.method === "GET" ? c.env.READ_LIMITER : c.env.WRITE_LIMITER;
  if (!(await limiter.limit({ key: ip })).success)
    return c.json({ error: "访问过于频繁，请稍后重试。" }, 429);
  await next();
});
app.get("/api/notes/:id", async (c) => {
  const id = c.req.param("id");
  if (!validId(id)) return c.json({ error: "笔记不存在或已过期。" }, 404);
  const note = await c.env.DB.prepare(
    `SELECT ${noteColumns} FROM notes WHERE id = ? AND expires_at > ?`,
  )
    .bind(id, Date.now())
    .first<Note>();
  return note ? c.json(note) : c.json({ error: "笔记不存在或已过期。" }, 404);
});
app.put("/api/notes/:id", async (c) => {
  const id = c.req.param("id");
  if (!validId(id)) return c.json({ error: "无效链接。" }, 400);
  const body = await c.req.json<{ content?: unknown; createToken?: string }>();
  if (!body || !validContent(body.content))
    return c.json({ error: "正文必须是文本，且不能超过 200 KB。" }, 413);
  const now = Date.now();
  const config = await settings(c.env.DB);
  const expires = now + config.retentionDays * DAY;
  if (body.createToken) {
    try {
      const { payload } = await jwtVerify(
        body.createToken,
        secret(c.req.raw, c.env),
        { algorithms: ["HS256"] },
      );
      if (payload.id !== id || payload.purpose !== "create")
        throw new Error("Wrong token");
    } catch {
      return c.json(
        { error: "新建链接凭证已失效，请复制草稿后新建笔记。" },
        403,
      );
    }
    if (!body.content.trim())
      return c.json({ error: "首次保存需要输入内容。" }, 400);
    const result = await c.env.DB.prepare(
      `INSERT INTO notes (id, content, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING ${noteColumns}`,
    )
      .bind(id, body.content, now, now, expires)
      .first<Note>();
    if (!result)
      return c.json(
        {
          error:
            "链接已被使用，或上次创建已成功。请先重新加载；若内容不同，请复制草稿后新建。",
        },
        409,
      );
    return c.json(result, 201);
  }
  const updated = await c.env.DB.prepare(
    `UPDATE notes SET content = ?, updated_at = ?, expires_at = ? WHERE id = ? AND expires_at > ? AND content != ? RETURNING ${noteColumns}`,
  )
    .bind(body.content, now, expires, id, now, body.content)
    .first<Note>();
  if (updated) return c.json(updated);
  const existing = await c.env.DB.prepare(
    `SELECT ${noteColumns} FROM notes WHERE id = ? AND expires_at > ?`,
  )
    .bind(id, now)
    .first<Note>();
  return existing
    ? c.json(existing)
    : c.json({ error: "笔记不存在或已过期。请复制草稿后新建。" }, 404);
});

app.get("/api/admin/stats", async (c) => {
  const now = Date.now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notes WHERE expires_at > ?",
    ).bind(now),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notes WHERE expires_at <= ?",
    ).bind(now),
    c.env.DB.prepare(
      "SELECT ran_at, deleted, kind, status FROM maintenance WHERE id = 1",
    ),
  ]);
  return c.json({
    active: (results[0].results[0] as { count: number }).count,
    expired: (results[1].results[0] as { count: number }).count,
    lastCleanup: results[2].results[0],
  });
});
app.put("/api/admin/settings", async (c) => {
  const config = parseSettings(await c.req.json());
  if (!config)
    return c.json(
      {
        error:
          "设置无效：背景需为 HTTPS 地址，链接 3–8 位，保留期限 1–365 天。",
      },
      400,
    );
  await c.env.DB.prepare(
    "UPDATE settings SET background_url = ?, overlay = ?, link_length = ?, retention_days = ? WHERE id = 1",
  )
    .bind(
      config.backgroundUrl,
      config.overlay,
      config.linkLength,
      config.retentionDays,
    )
    .run();
  return c.json(config);
});

async function cleanup(
  db: D1Database,
  kind: "expired" | "all",
  cutoff: number,
  batches: number,
) {
  let deleted = 0;
  const column = kind === "all" ? "created_at" : "expires_at";
  try {
    for (let i = 0; i < batches; i++) {
      const result = await db
        .prepare(
          `DELETE FROM notes WHERE id IN (SELECT id FROM notes WHERE ${column} <= ? LIMIT 500)`,
        )
        .bind(cutoff)
        .run();
      deleted += result.meta.changes;
      if (result.meta.changes < 500) break;
    }
    const remaining = await db
      .prepare(`SELECT COUNT(*) AS count FROM notes WHERE ${column} <= ?`)
      .bind(cutoff)
      .first<number>("count");
    await db
      .prepare(
        "UPDATE maintenance SET ran_at = ?, deleted = ?, kind = ?, status = ? WHERE id = 1",
      )
      .bind(Date.now(), deleted, kind, remaining ? "partial" : "complete")
      .run();
    return { deleted, remaining: remaining || 0 };
  } catch (error) {
    try {
      await db
        .prepare(
          "UPDATE maintenance SET ran_at = ?, deleted = ?, kind = ?, status = 'failed' WHERE id = 1",
        )
        .bind(Date.now(), deleted, kind)
        .run();
    } catch {
      /* DB quota failure may prevent recording. */
    }
    throw error;
  }
}
app.post("/api/admin/cleanup", async (c) => {
  const body = await c.req.json<{
    kind: "expired" | "all";
    confirmation?: string;
    cutoff?: number;
  }>();
  if (!body || !["expired", "all"].includes(body.kind))
    return c.json({ error: "无效清理类型。" }, 400);
  if (body.kind === "all" && body.confirmation !== "清空全部")
    return c.json({ error: "请输入“清空全部”确认。" }, 400);
  const cutoff = body.cutoff ?? Date.now();
  if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now())
    return c.json({ error: "无效清理时间。" }, 400);
  return c.json({ ...(await cleanup(c.env.DB, body.kind, cutoff, 1)), cutoff });
});

app.all("/api/*", (c) => c.json({ error: "接口不存在。" }, 404));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
app.get("*", async (c) => {
  if (
    (c.req.path === "/admin" || c.req.path.startsWith("/admin/")) &&
    !(await authorize(c.req.raw, c.env))
  ) {
    return c.text(
      "管理员身份验证失败。请配置并通过 Cloudflare Access 登录。",
      401,
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});
app.onError((error, c) => {
  // Do not log URLs, bearer links or note contents.
  console.error(
    "Request failed:",
    error instanceof SyntaxError ? "invalid-json" : "service-error",
  );
  return c.json(
    {
      error:
        "服务暂不可用。请保留本地草稿，稍后重试；管理员可检查数据库额度和部署配置。",
    },
    503,
  );
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(cleanup(env.DB, "expired", Date.now(), 10));
  },
};
