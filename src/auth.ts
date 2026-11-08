import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: { email: string; name?: string | null; image?: string | null; isOwner: boolean };
  }
}

const isOwner = (email?: string | null) => Boolean(email && env.ownerEmails().includes(email.toLowerCase()));

/**
 * Single-owner auth. There is no registration: Google sign-in succeeds only when the verified email
 * is in OWNER_EMAILS. Sessions are encrypted JWTs (JWE) in an httpOnly cookie, 7-day lifetime;
 * nothing authentication-related is stored in Redis.
 * The Credentials provider exists solely for automated tests and is hard-disabled in production.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [
    Google({ allowDangerousEmailAccountLinking: false }),
    ...(env.testAuthEnabled()
      ? [
          Credentials({
            id: "test",
            name: "Test owner",
            credentials: { email: {}, secret: {} },
            authorize: (c) => {
              const email = String(c?.email ?? "").toLowerCase();
              const secret = process.env.TEST_AUTH_SECRET;
              return secret && c?.secret === secret && isOwner(email) ? { id: email, email, name: "Test Owner" } : null;
            },
          }),
        ]
      : []),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ account, profile, user }) {
      if (account?.provider === "google") return profile?.email_verified === true && isOwner(profile.email);
      if (account?.provider === "test") return env.testAuthEnabled() && isOwner(user.email);
      return false;
    },
    jwt({ token }) {
      token.isOwner = isOwner(token.email); // re-evaluated each refresh: removing an email revokes access
      return token;
    },
    session({ session, token }) {
      return { ...session, user: { ...session.user, isOwner: token.isOwner === true } };
    },
  },
}));
