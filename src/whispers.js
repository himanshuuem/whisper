export const MOODS = {
  confession: "🤫",
  hope: "🌱",
  regret: "🌧️",
  win: "🏆",
  fear: "🌑",
};

const ANIMALS = ["Owl", "Fox", "Otter", "Heron", "Lynx", "Moth", "Panda", "Koi", "Raven", "Tiger", "Gecko", "Yak"];
const COLOURS = ["Amber", "Indigo", "Jade", "Coral", "Slate", "Saffron", "Teal", "Plum"];

/** A stable pseudonym per whisper (not per user), so posts can't be linked to each other. */
export function pseudonym(whisperId) {
  const n = Math.imul(whisperId ^ 0x5bd1e995, 2654435761) >>> 0;
  return `${COLOURS[n % COLOURS.length]} ${ANIMALS[(n >>> 8) % ANIMALS.length]}`;
}

export function validateWhisper({ body, mood }) {
  const text = String(body ?? "").trim().replace(/\s+\n/g, "\n");
  if (text.length < 3) throw new Error("Say at least a few words.");
  if (text.length > 500) throw new Error("Keep it under 500 characters.");
  if (!Object.hasOwn(MOODS, mood)) throw new Error("Pick a mood.");
  return { body: text, mood };
}

export function createWhisperRepo(pool) {
  return {
    async feed(viewerId, { mood } = {}) {
      const { rows } = await pool.query(
        `SELECT w.id, w.body, w.mood, w.created_at,
                (w.user_id = $1) AS mine,
                count(h.user_id)::int AS hearts,
                bool_or(h.user_id = $1) AS hearted
         FROM whispers w LEFT JOIN hearts h ON h.whisper_id = w.id
         WHERE $2::text IS NULL OR w.mood = $2
         GROUP BY w.id
         ORDER BY w.created_at DESC
         LIMIT 100`,
        [viewerId, mood ?? null],
      );
      return rows.map((row) => ({ ...row, hearted: Boolean(row.hearted), alias: pseudonym(row.id) }));
    },

    async create(userId, input) {
      const { body, mood } = validateWhisper(input);
      const { rows } = await pool.query("INSERT INTO whispers (user_id, body, mood) VALUES ($1, $2, $3) RETURNING id", [userId, body, mood]);
      return rows[0].id;
    },

    async toggleHeart(userId, whisperId) {
      const { rowCount } = await pool.query("DELETE FROM hearts WHERE user_id = $1 AND whisper_id = $2", [userId, whisperId]);
      if (rowCount === 0) {
        await pool.query("INSERT INTO hearts (user_id, whisper_id) SELECT $1, id FROM whispers WHERE id = $2 ON CONFLICT DO NOTHING", [userId, whisperId]);
      }
    },

    /** Only the author can delete — enforced in SQL, not just hidden in the UI. */
    async remove(userId, whisperId) {
      const { rowCount } = await pool.query("DELETE FROM whispers WHERE id = $1 AND user_id = $2", [whisperId, userId]);
      return rowCount === 1;
    },

    async countFor(userId) {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM whispers WHERE user_id = $1", [userId]);
      return rows[0].n;
    },
  };
}
