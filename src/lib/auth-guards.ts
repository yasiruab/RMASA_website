import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AdminActor = {
  userId: string;
  email?: string | null;
  role: "admin" | "super_admin";
};

function toResponse(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

// Re-read role + active from Postgres on every admin request. The NextAuth JWT
// stamps these at sign-in and is valid for 4 hours; without this lookup, a
// deactivated or demoted admin keeps their previous privileges until the
// session expires. One PK lookup per request is cheap and makes the deactivate
// button mean what it says.
async function loadActiveAdmin(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, active: true, email: true },
  });
}

// Server-component counterpart to requireAdmin(): the session plus the same
// Postgres role/active re-check. Admin pages that render data server-side
// (the hub) must use this rather than getServerSession() alone, which trusts
// the JWT for up to 4 hours after an admin is deactivated or demoted.
// Returns null when there is no session or the account is inactive.
export async function getActivePageAdmin(): Promise<AdminActor | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const dbUser = await loadActiveAdmin(session.user.id);
  if (!dbUser || !dbUser.active) return null;

  return { userId: session.user.id, email: dbUser.email ?? session.user.email, role: dbUser.role };
}

export async function requireAdminPage(): Promise<AdminActor> {
  const admin = await getActivePageAdmin();
  if (!admin) {
    redirect("/admin/login?next=/admin/calendar");
  }
  return admin;
}

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { response: toResponse(401, "Authentication required.") } as const;
  }

  const dbUser = await loadActiveAdmin(session.user.id);
  if (!dbUser || !dbUser.active) {
    return { response: toResponse(401, "Account is inactive. Please sign in again.") } as const;
  }

  if (dbUser.role !== "admin" && dbUser.role !== "super_admin") {
    return { response: toResponse(403, "Forbidden.") } as const;
  }

  return {
    actor: {
      userId: session.user.id,
      email: dbUser.email ?? session.user.email,
      role: dbUser.role,
    } satisfies AdminActor,
  } as const;
}

export async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { response: toResponse(401, "Authentication required.") } as const;
  }

  const dbUser = await loadActiveAdmin(session.user.id);
  if (!dbUser || !dbUser.active) {
    return { response: toResponse(401, "Account is inactive. Please sign in again.") } as const;
  }

  if (dbUser.role !== "super_admin") {
    return { response: toResponse(403, "Super admin permission required.") } as const;
  }

  return {
    actor: {
      userId: session.user.id,
      email: dbUser.email ?? session.user.email,
      role: "super_admin",
    } satisfies AdminActor,
  } as const;
}
