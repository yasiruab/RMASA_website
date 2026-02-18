import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export type AdminActor = {
  userId: string;
  email?: string | null;
  role: "admin" | "super_admin";
};

function toResponse(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { response: toResponse(401, "Authentication required.") } as const;
  }

  const role = session.user.role;
  if (role !== "admin" && role !== "super_admin") {
    return { response: toResponse(403, "Forbidden.") } as const;
  }

  return {
    actor: {
      userId: session.user.id,
      email: session.user.email,
      role,
    } satisfies AdminActor,
  } as const;
}

export async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { response: toResponse(401, "Authentication required.") } as const;
  }

  if (session.user.role !== "super_admin") {
    return { response: toResponse(403, "Super admin permission required.") } as const;
  }

  return {
    actor: {
      userId: session.user.id,
      email: session.user.email,
      role: "super_admin",
    } satisfies AdminActor,
  } as const;
}
