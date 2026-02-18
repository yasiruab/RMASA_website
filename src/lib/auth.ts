import bcrypt from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

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
    CredentialsProvider({
      name: "Admin Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "").trim();

        if (!email || !password) {
          await logAuditEvent({
            actorEmail: email || null,
            action: "AUTH_LOGIN_FAILED",
            meta: { reason: "missing_credentials" },
          });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !user.active) {
          await logAuditEvent({
            actorEmail: email,
            action: "AUTH_LOGIN_FAILED",
            meta: { reason: "invalid_user" },
          });
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          await logAuditEvent({
            actorUserId: user.id,
            actorEmail: user.email,
            action: "AUTH_LOGIN_FAILED",
            meta: { reason: "invalid_password" },
          });
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
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
