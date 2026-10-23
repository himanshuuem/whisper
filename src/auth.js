import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

export function configurePassport({ users, google, baseUrl }) {
  passport.use(new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await users.verify(email, password);
      // Same message for unknown email and wrong password — don't leak which accounts exist.
      return done(null, user ?? false, user ? undefined : { message: "Email or password is incorrect." });
    } catch (error) {
      return done(error);
    }
  }));

  if (google) {
    passport.use(new GoogleStrategy(
      { ...google, callbackURL: `${baseUrl}/auth/google/callback` },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.find((e) => e.verified)?.value ?? profile.emails?.[0]?.value;
          if (!email) return done(null, false, { message: "Google didn't share an email address." });
          return done(null, await users.findOrCreateGoogle(profile.id, email));
        } catch (error) {
          return done(error);
        }
      },
    ));
  }

  // Only the id goes into the session; the user is re-loaded per request.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      done(null, (await users.findById(id)) ?? false);
    } catch (error) {
      done(error);
    }
  });

  return passport;
}

export function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect(303, "/login");
}
