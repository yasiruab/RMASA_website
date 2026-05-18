import { getServerSession } from "next-auth";
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
