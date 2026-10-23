import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
// A real hash to compare against when the user doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 4);

export class AuthError extends Error {}

export function validateCredentials(email, password) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const errors = [];
  if (!EMAIL.test(cleanEmail)) errors.push("Enter a valid email address.");
  if (typeof password !== "string" || password.length < 10) errors.push("Passwords need at least 10 characters.");
  else if (password.length > 72) errors.push("Passwords can be at most 72 characters.");
  else if (!/[a-z]/i.test(password) || !/\d/.test(password)) errors.push("Use at least one letter and one number.");
  return { email: cleanEmail, errors };
}

export function createUserRepo(pool) {
  return {
    async register(email, password) {
      const { email: cleanEmail, errors } = validateCredentials(email, password);
      if (errors.length) throw new AuthError(errors.join(" "));
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      try {
        const { rows } = await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email", [cleanEmail, hash]);
        return rows[0];
      } catch (error) {
        if (error.code === "23505") throw new AuthError("An account with that email already exists. Try logging in.");
        throw error;
      }
    },

    async verify(email, password) {
      const { rows } = await pool.query("SELECT id, email, password_hash FROM users WHERE lower(email) = lower($1)", [String(email ?? "").trim()]);
      const user = rows[0];
      const ok = await bcrypt.compare(String(password ?? ""), user?.password_hash ?? DUMMY_HASH);
      return ok && user?.password_hash ? { id: user.id, email: user.email } : null;
    },

    async findById(id) {
      const { rows } = await pool.query("SELECT id, email FROM users WHERE id = $1", [id]);
      return rows[0] ?? null;
    },

    /** Google sign-in: link to an existing account with the same verified email, or create a new one. */
    async findOrCreateGoogle(googleId, email) {
      const { rows } = await pool.query(
        `INSERT INTO users (email, google_id) VALUES ($1, $2)
         ON CONFLICT ((lower(email))) DO UPDATE SET google_id = COALESCE(users.google_id, EXCLUDED.google_id)
         RETURNING id, email`,
        [email.toLowerCase(), googleId],
      );
      return rows[0];
    },

    async remove(id) {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    },
  };
}
