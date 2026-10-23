export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret && isProduction) throw new Error("SESSION_SECRET must be set in production.");
  return {
    port: Number(env.PORT ?? 3000),
    isProduction,
    sessionSecret: sessionSecret ?? "dev-only-secret-change-me",
    baseUrl: env.BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientID: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null,
  };
}
