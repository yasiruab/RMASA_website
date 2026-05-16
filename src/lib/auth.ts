import type { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 4;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 15,
  },
  pages: {
    signIn: "/admin/login",
  },
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID ?? "",
      clientSecret: process.env.COGNITO_CLIENT_SECRET ?? "",
      issuer: process.env.COGNITO_ISSUER ?? "",
      profile(profile) {
        return {
          id: profile.sub,
          email: typeof profile.email === "string" ? profile.email : "",
          name:
            (typeof profile.name === "string" && profile.name) ||
            (typeof profile.email === "string" ? profile.email : ""),
          image: null,
          // Placeholder — the signIn callback overwrites this with the
          // authoritative role from the Postgres User row.
          role: "admin",
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email = user?.email?.trim().toLowerCase();
      if (!email) {
        await logAuditEvent({
          actorEmail: null,
          action: "AUTH_LOGIN_FAILED",
          meta: { reason: "no_email_from_cognito" },
        });
        return false;
      }

      const dbUser = await prisma.user.findUnique({ where: { email } });
      if (!dbUser) {
        await logAuditEvent({
          actorEmail: email,
          action: "AUTH_LOGIN_FAILED",
          meta: { reason: "not_in_postgres" },
        });
        return false;
      }

      if (!dbUser.active) {
        await logAuditEvent({
          actorUserId: dbUser.id,
          actorEmail: email,
          action: "AUTH_LOGIN_FAILED",
          meta: { reason: "inactive" },
        });
        return false;
      }

      const cognitoSub = (profile as { sub?: unknown } | undefined)?.sub;
      if (typeof cognitoSub === "string" && cognitoSub && !dbUser.cognitoSub) {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { cognitoSub },
        });
      }

      // Carry Postgres identity into the jwt + events callbacks. NextAuth
      // mutates the same user object across the auth flow.
      user.id = dbUser.id;
      (user as { role?: "admin" | "super_admin" }).role = dbUser.role;

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.role = (user as { role?: "admin" | "super_admin" }).role ?? "admin";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.email = token.email;
        session.user.role =
          ((token as { role?: "admin" | "super_admin" }).role ?? "admin");
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      await logAuditEvent({
        actorUserId: user.id,
        actorEmail: user.email,
        action: "AUTH_LOGIN_SUCCESS",
      });
    },
    async signOut({ token }) {
      await logAuditEvent({
        actorUserId: token?.sub,
        actorEmail: token?.email,
        action: "AUTH_LOGOUT",
      });
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
