import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Synchroniser-token CSRF protection: a random token lives in the session and must be echoed
 * back in every state-changing form. SameSite=Lax cookies already block most CSRF; this closes the rest.
 */
export function csrf() {
  return (req, res, next) => {
    req.session.csrfToken ??= randomBytes(24).toString("base64url");
    res.locals.csrfToken = req.session.csrfToken;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

    const sent = Buffer.from(String(req.body?._csrf ?? ""));
    const expected = Buffer.from(req.session.csrfToken);
    if (sent.length === expected.length && timingSafeEqual(sent, expected)) return next();
    res.status(403).render("message", { title: "Form expired", message: "That form expired or came from somewhere else. Go back, refresh and try again." });
  };
}
