import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkAttachments({ root, request, sql }) {
  const config = (await request("/api/config")).result;
  const stats = async () =>
    (await request("/api/admin/stats")).result.attachments;
  const newNote = async (text = "正文") => {
    const draft = (await request("/api/new", "POST", {})).result;
    assert.equal(
      (
        await request(`/api/notes/${draft.id}`, "PUT", {
          content: text,
          createToken: draft.createToken,
        })
      ).status,
      201,
    );
    return draft.id;
  };
  let ip = 1;
  const reserve = (id, name, size, aid = randomUUID()) =>
    request(
      `/api/notes/${id}/attachments`,
      "POST",
      { id: aid, name, size },
      { "cf-connecting-ip": `198.51.100.${ip++}` },
    );
  const put = (id, aid, data, headers = {}) =>
    fetch(`${root}/api/notes/${id}/attachments/${aid}/content`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", ...headers },
      body: data,
    });
  const path = (id, aid) => `/api/notes/${id}/attachments/${aid}/file`;
  const cleanup = () =>
    request("/api/admin/cleanup", "POST", { kind: "expired" });
  const id = await newNote();
  const before = (await request(`/api/notes/${id}`)).result.expiresAt;
  const text = Buffer.from("附件 UTF-8 <script> & 内容\n");
  const r = await reserve(id, "笔记.txt", text.length);
  assert.equal(r.status, 201);
  assert.equal((await stats()).reservedBytes, text.length);
  assert.equal(
    (await reserve(id, "笔记.txt", text.length, r.result.id)).status,
    200,
    "reservation idempotency",
  );
  assert.equal(
    (await stats()).reservedBytes,
    text.length,
    "no double reservation",
  );
  const uploaded = await put(id, r.result.id, text);
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  assert.equal((await stats()).usedBytes, text.length);
  assert.equal((await stats()).reservedBytes, 0);
  assert.ok((await request(`/api/notes/${id}`)).result.expiresAt >= before);
  const download = await fetch(root + path(id, r.result.id));
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(await download.text(), text.toString());
  const other = await newNote();
  assert.equal(
    (await fetch(root + path(other, r.result.id))).status,
    404,
    "cross-note access blocked",
  );
  assert.equal(
    (await put(id, r.result.id, text)).status,
    409,
    "upload cannot overwrite completed object",
  );

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const image = await reserve(id, "image.png", png.length);
  assert.equal((await put(id, image.result.id, png)).status, 200);
  const imageResponse = await fetch(root + path(id, image.result.id));
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.match(imageResponse.headers.get("content-disposition"), /^inline;/);
  assert.match(
    (await fetch(root + path(id, image.result.id) + "?download=1")).headers.get(
      "content-disposition",
    ),
    /^attachment;/,
  );
  assert.equal((await reserve(id, "bad.svg", 100)).status, 400);
  assert.equal((await reserve(id, "bad.exe", 100)).status, 400);
  const fake = await reserve(id, "fake.png", text.length);
  assert.equal(
    (await put(id, fake.result.id, text)).status,
    400,
    "fake image rejected",
  );
  assert.equal(
    (await stats()).deletingBytes,
    text.length,
    "failure stays accounted",
  );
  const oversize = await reserve(id, "wrong.txt", 2);
  assert.equal(
    (await put(id, oversize.result.id, Buffer.from("1234"))).status,
    400,
    "actual size mismatch rejected",
  );
  const csrf = await reserve(other, "csrf.txt", 3);
  assert.equal(
    (
      await put(other, csrf.result.id, Buffer.from("abc"), {
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  await request("/api/admin/settings", "PUT", {
    ...config,
    uploadsEnabled: false,
  });
  assert.equal((await reserve(other, "closed.txt", 3)).status, 403);
  assert.equal(
    (await put(other, csrf.result.id, Buffer.from("abc"))).status,
    409,
    "disable also blocks reserved uploads",
  );
  assert.equal(
    (await fetch(root + path(id, r.result.id))).status,
    200,
    "disabled upload still permits downloads",
  );
  assert.equal(
    (await request(`/api/notes/${id}/attachments/${r.result.id}`, "DELETE", {}))
      .status,
    200,
    "disabled upload still permits deletion",
  );
  assert.equal((await fetch(root + path(id, r.result.id))).status, 404);
  await request("/api/admin/settings", "PUT", config);

  // The SQL below manipulates only the test's isolated local database.
  await sql('UPDATE attachments SET delete_after=0 WHERE state="deleting"');
  await cleanup();
  await request("/api/admin/cleanup", "POST", {
    kind: "all",
    confirmation: "清空全部",
  });
  await sql("UPDATE attachments SET delete_after=0");
  await cleanup();
  assert.equal(
    (await stats()).usedBytes +
      (await stats()).reservedBytes +
      (await stats()).deletingBytes,
    0,
  );

  const limited = await newNote();
  await sql(
    "UPDATE settings SET max_note_files=2, max_note_bytes=6, max_total_bytes=6",
  );
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, (_, i) => reserve(limited, `file${i}.txt`, 3)),
  );
  assert.equal(
    concurrent.filter((r) => r.status === 201).length,
    2,
    "atomic quota reservation",
  );
  assert.equal((await stats()).reservedBytes, 6);
  const limitedOther = await newNote();
  assert.equal(
    (await reserve(limitedOther, "full.txt", 1)).status,
    409,
    "global quota includes other notes",
  );
  const pending = concurrent.find((r) => r.status === 201).result.id;
  await sql(`UPDATE notes SET expires_at=1 WHERE id='${limited}'`);
  assert.equal(
    (await put(limited, pending, Buffer.from("abc"))).status,
    409,
    "expired note cannot complete pending upload",
  );
  await cleanup();
  assert.equal(
    (await stats()).deletingBytes,
    6,
    "pending files keep quota during grace",
  );
  await sql("UPDATE attachments SET delete_after=0");
  await cleanup();
  assert.equal((await stats()).deletingBytes, 0);

  await request("/api/admin/settings", "PUT", config);
  const ephemeral = await reserve(limitedOther, "abandoned.txt", 3);
  await sql("UPDATE attachments SET delete_after=0");
  const scheduled = await fetch(root + "/cdn-cgi/local/scheduled");
  assert.equal(scheduled.status, 200);
  for (let i = 0; i < 30; i++) {
    if ((await stats()).reservedBytes === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (await stats()).reservedBytes,
    0,
    "Cron recovers abandoned reservations",
  );
  assert.equal(
    (await put(limitedOther, ephemeral.result.id, Buffer.from("abc"))).status,
    409,
  );

  const old = await reserve(limitedOther, "old.txt", 3);
  await put(limitedOther, old.result.id, Buffer.from("old"));
  await sql(
    `DELETE FROM notes WHERE id='${limitedOther}'; INSERT INTO notes(id,content,created_at,updated_at,expires_at) VALUES('${limitedOther}','new generation',1,1,9999999999999)`,
  );
  assert.equal(
    (await fetch(root + path(limitedOther, old.result.id))).status,
    404,
    "short ID reuse never exposes old attachment",
  );
  await request("/api/admin/cleanup", "POST", {
    kind: "all",
    confirmation: "清空全部",
  });
  assert.equal((await stats()).usedBytes, 0);
  console.log(
    "Attachments passed: binary R2 roundtrip, images, type/size checks, isolation, concurrency quotas, disable, expiry, Cron and ID reuse.",
  );
}
