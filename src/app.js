import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { configurePassport, requireAuth } from "./auth.js";
import { csrf } from "./middleware/csrf.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { AuthError } from "./users.js";
import { MOODS } from "./whispers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createApp({ pool, users, whispers, config, loginLimit = 10 }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(root, "views"));
  app.locals.MOODS = MOODS;
  app.locals.googleEnabled = Boolean(config.google);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    next();
  });
  app.use(express.static(path.join(root, "public")));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));

  const PgStore = connectPgSimple(session);
  app.use(session({
    store: new PgStore({ pool, tableName: "session" }),
    name: "whisper.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: config.isProduction, maxAge: 7 * 24 * 3600 * 1000 },
  }));

  const passport = configurePassport({ users, google: config.google, baseUrl: config.baseUrl });
  app.use(passport.session());
  app.use((req, res, next) => {
    res.locals.user = req.user ?? null;
    res.locals.flash = req.session.flash ?? null;
    delete req.session.flash;
    next();
  });
  app.use(csrf());


  const flash = (req, type, text) => { req.session.flash = { type, text }; };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const limiter = rateLimit({ max: loginLimit });

  // ---- Public pages -------------------------------------------------------
  app.get("/", (req, res) => (req.user ? res.redirect(303, "/feed") : res.render("home")));
  app.get("/register", (req, res) => res.render("register", { email: "", errors: [] }));
  app.get("/login", (req, res) => res.render("login", { email: "" }));

  app.post("/register", limiter, wrap(async (req, res, next) => {
    try {
      const user = await users.register(req.body.email, req.body.password);
      req.login(user, (error) => {
        if (error) return next(error);
        flash(req, "ok", "Welcome to Whisper. Say what you've never said. 🤫");
        res.redirect(303, "/feed");
      });
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      res.status(422).render("register", { email: req.body.email ?? "", errors: [error.message] });
    }
  }));

  app.post("/login", limiter, (req, res, next) => {
    passport.authenticate("local", (error, user, info) => {
      if (error) return next(error);
      if (!user) return res.status(401).render("login", { email: req.body.email ?? "", error: info?.message });
      const returnTo = req.session.returnTo;
      // passport 0.7 regenerates the session on login (prevents session fixation).
      req.login(user, (loginError) => {
        if (loginError) return next(loginError);
        res.redirect(303, returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/feed");
      });
    })(req, res, next);
  });

  if (config.google) {
    app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
    app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login", successRedirect: "/feed" }));
  }

  app.post("/logout", (req, res, next) => {
    req.logout((error) => (error ? next(error) : res.redirect(303, "/")));
  });

  // ---- Authenticated ------------------------------------------------------
  app.get("/feed", requireAuth, wrap(async (req, res) => {
    const mood = Object.hasOwn(MOODS, req.query.mood) ? req.query.mood : null;
    res.render("feed", { items: await whispers.feed(req.user.id, { mood }), mood, draft: "" });
  }));

  app.post("/whispers", requireAuth, wrap(async (req, res) => {
    try {
      await whispers.create(req.user.id, req.body);
      flash(req, "ok", "Whispered. Nobody will know it was you.");
    } catch (error) {
      flash(req, "err", error.message);
    }
    res.redirect(303, "/feed");
  }));

  app.post("/whispers/:id/heart", requireAuth, wrap(async (req, res) => {
    await whispers.toggleHeart(req.user.id, Number(req.params.id));
    res.redirect(303, `/feed#w${Number(req.params.id)}`);
  }));

  app.post("/whispers/:id/delete", requireAuth, wrap(async (req, res) => {
    const removed = await whispers.remove(req.user.id, Number(req.params.id));
    if (!removed) return res.status(403).render("message", { title: "Not yours", message: "You can only delete your own whispers." });
    flash(req, "ok", "Whisper deleted.");
    res.redirect(303, "/feed");
  }));

  app.get("/account", requireAuth, wrap(async (req, res) => {
    res.render("account", { count: await whispers.countFor(req.user.id) });
  }));

  app.post("/account/delete", requireAuth, wrap(async (req, res, next) => {
    await users.remove(req.user.id);
    req.logout((error) => (error ? next(error) : res.redirect(303, "/")));
  }));

  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use((req, res) => res.status(404).render("message", { title: "Not found", message: "Nothing to see here." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render("message", { title: "Something broke", message: "Please try again in a moment." });
  });

  return app;
}
