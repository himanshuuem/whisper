import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createUserRepo } from "./users.js";
import { createWhisperRepo } from "./whispers.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool();
const app = createApp({ pool, users: createUserRepo(pool), whispers: createWhisperRepo(pool), config });

const server = app.listen(config.port, () => {
  console.log(`🤫 Whisper at http://localhost:${config.port}`);
  if (!config.google) console.log("   Google sign-in disabled (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable).");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))));
}
