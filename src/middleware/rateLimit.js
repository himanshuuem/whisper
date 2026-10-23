/** Fixed-window limiter by IP (single-instance). */
export function rateLimit({ windowMs = 15 * 60_000, max = 10, now = Date.now } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    for (const [key, entry] of hits) if (now() - entry.start > windowMs) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now() - entry.start > windowMs) {
      hits.set(key, { start: now(), count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count <= max) return next();
    res.set("Retry-After", String(Math.ceil((entry.start + windowMs - now()) / 1000)));
    res.status(429).render("message", { title: "Slow down", message: "Too many attempts. Please wait a few minutes and try again." });
  };
}
