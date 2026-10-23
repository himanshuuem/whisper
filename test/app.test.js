import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { createUserRepo, validateCredentials } from "../src/users.js";
import { createWhisperRepo, pseudonym, validateWhisper } from "../src/whispers.js";
import { loadConfig } from "../src/config.js";

test("password policy", () => {
  assert.deepEqual(validateCredentials("A@B.co", "longpassword1").errors, []);
  assert.match(validateCredentials("nope", "short").errors.join(" "), /valid email.*10 characters/);
  assert.match(validateCredentials("a@b.co", "onlylettersss").errors.join(" "), /letter and one number/);
});

test("pseudonyms are stable per whisper", () => {
  assert.equal(pseudonym(7), pseudonym(7));
  assert.match(pseudonym(7), /^\w+ \w+$/);
});

test("whisper validation", () => {
  assert.throws(() => validateWhisper({ body: "hi", mood: "hope" }), /few words/);
  assert.throws(() => validateWhisper({ body: "hello there", mood: "rage" }), /mood/);
});

test("production requires SESSION_SECRET", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /SESSION_SECRET/);
});

/** Minimal browser: keeps cookies and pulls the CSRF token out of each page. */
function createAgent(base) {
  let cookie = "";
  const request = async (path, init = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie } });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  };
  return {
    get: request,
    async csrf(path = "/login") {
      const html = await (await request(path)).text();
      return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
    },
    post: (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }),
  };
}

describe("Whisper with PostgreSQL", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, () => {
  let pool;
  let server;
  let base;

  before(async () => {
    pool = createPool();
    await pool.query('DROP TABLE IF EXISTS hearts, whispers, users, "session"');
    await pool.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
    const config = { ...loadConfig({}), sessionSecret: "test-secret" };
    server = createApp({ pool, users: createUserRepo(pool), whispers: createWhisperRepo(pool), config, loginLimit: 5 }).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await pool?.end();
  });

  test("feed requires login", async () => {
    const res = await fetch(`${base}/feed`, { redirect: "manual" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/login");
  });

  test("forms without a CSRF token are rejected", async () => {
    const agent = createAgent(base);
    await agent.csrf("/register");
    const res = await agent.post("/register", { email: "x@y.dev", password: "abcdefghij1" });
    assert.equal(res.status, 403);
  });

  test("register → post → heart → delete → logout", async () => {
    const alice = createAgent(base);
    let _csrf = await alice.csrf("/register");
    const reg = await alice.post("/register", { _csrf, email: "Alice@Example.com", password: "correct-horse-1" });
    assert.equal(reg.status, 303);
    assert.equal(reg.headers.get("location"), "/feed");

    _csrf = await alice.csrf("/feed");
    await alice.post("/whispers", { _csrf, body: "I still use tabs.", mood: "confession" });
    const { rows: [whisper] } = await pool.query("SELECT id FROM whispers WHERE body = 'I still use tabs.'");

    await alice.post(`/whispers/${whisper.id}/heart`, { _csrf });
    const feed = await (await alice.get("/feed")).text();
    assert.match(feed, /I still use tabs\./);
    assert.match(feed, /♥ 1/);
    assert.match(feed, /class="you"/);

    // Passwords are stored as bcrypt hashes, never in plain text.
    const { rows: [stored] } = await pool.query("SELECT password_hash FROM users WHERE lower(email) = 'alice@example.com'");
    assert.match(stored.password_hash, /^\$2[aby]\$12\$/);

    // Another user can't delete Alice's whisper.
    const bob = createAgent(base);
    let bobCsrf = await bob.csrf("/register");
    await bob.post("/register", { _csrf: bobCsrf, email: "bob@example.com", password: "battery-staple-2" });
    bobCsrf = await bob.csrf("/feed");
    assert.equal((await bob.post(`/whispers/${whisper.id}/delete`, { _csrf: bobCsrf })).status, 403);

    assert.equal((await alice.post(`/whispers/${whisper.id}/delete`, { _csrf })).status, 303);
    await alice.post("/logout", { _csrf });
    assert.equal((await alice.get("/feed")).status, 303);
  });

  test("login: duplicate email, wrong password, success with case-insensitive email", async () => {
    const agent = createAgent(base);
    let _csrf = await agent.csrf("/register");
    const dupe = await agent.post("/register", { _csrf, email: "alice@example.com", password: "another-pass-3" });
    assert.equal(dupe.status, 422);

    _csrf = await agent.csrf("/login");
    const wrong = await agent.post("/login", { _csrf, email: "alice@example.com", password: "wrong-pass-99" });
    assert.equal(wrong.status, 401);
    assert.match(await wrong.text(), /Email or password is incorrect/);

    _csrf = await agent.csrf("/login");
    const ok = await agent.post("/login", { _csrf, email: "ALICE@example.com", password: "correct-horse-1" });
    assert.equal(ok.status, 303);
  });

  test("sessions are persisted in Postgres", async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "session"');
    assert.ok(rows[0].n > 0);
  });
});
