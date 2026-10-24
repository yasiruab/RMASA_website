import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { parseAccountUpdate } from "@/lib/admin/account-update";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

type AccountGuardFailure = { status: number; message: string };

// Thrown inside the transaction to abort it with a user-facing 4xx.
class AccountGuardError extends Error {
  constructor(readonly failure: AccountGuardFailure) {
    super(failure.message);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const parsed = parseAccountUpdate(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }
  const payload = parsed.update;

  // The "last active super admin" guard is a read (count) followed by a write.
  // Running both in one SERIALIZABLE transaction means two super-admins
  // demoting each other at the same moment can't both pass the count and
  // leave zero; Postgres aborts one with a serialization failure instead.
  let user;
  try {
    user = await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id } });
        if (!target) throw new AccountGuardError({ status: 404, message: "Account not found." });

        const isSelf = target.id === auth.actor.userId;
        const isRoleDowngrade = payload.role === "admin" && target.role === "super_admin";
        const isDeactivation = payload.active === false && target.active;

        if (isSelf && isDeactivation) {
          throw new AccountGuardError({ status: 400, message: "Cannot deactivate your own account." });
        }
        if (isSelf && isRoleDowngrade) {
          throw new AccountGuardError({ status: 400, message: "Cannot remove your own super admin role." });
        }

        if (target.role === "super_admin" && (isRoleDowngrade || isDeactivation)) {
          const otherActiveSuperAdminCount = await tx.user.count({
            where: { role: "super_admin", active: true, NOT: { id: target.id } },
          });
          if (otherActiveSuperAdminCount === 0) {
            throw new AccountGuardError({
              status: 400,
              message: "Cannot remove the last active super admin account.",
            });
          }
        }

        return tx.user.update({
          where: { id },
          data: { role: payload.role, active: payload.active, name: payload.name },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof AccountGuardError) {
      return NextResponse.json({ message: error.failure.message }, { status: error.failure.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json(
        { message: "Another account change happened at the same time. Please try again." },
        { status: 409 },
      );
    }
    throw error;
  }

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_ACCOUNT_UPDATED",
    resourceType: "admin_account",
    resourceId: user.id,
    meta: {
      role: payload.role,
      active: payload.active,
      name: payload.name,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Account updated.", user });
}
