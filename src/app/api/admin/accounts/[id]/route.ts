import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

type UpdateAccountPayload = {
  role?: "admin" | "super_admin";
  active?: boolean;
  name?: string;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const payload = (await req.json()) as UpdateAccountPayload;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 });
  }

  const isSelf = target.id === auth.actor.userId;
  const isRoleDowngrade = payload.role === "admin" && target.role === "super_admin";
  const isDeactivation = payload.active === false && target.active;
  const removesSuperAdminCapability = isRoleDowngrade || isDeactivation;

  if (isSelf && isDeactivation) {
    return NextResponse.json({ message: "Cannot deactivate your own account." }, { status: 400 });
  }

  if (isSelf && isRoleDowngrade) {
    return NextResponse.json(
      { message: "Cannot remove your own super admin role." },
      { status: 400 },
    );
  }

  if (target.role === "super_admin" && removesSuperAdminCapability) {
    const otherActiveSuperAdminCount = await prisma.user.count({
      where: {
        role: "super_admin",
        active: true,
        NOT: { id: target.id },
      },
    });
    if (otherActiveSuperAdminCount === 0) {
      return NextResponse.json(
        { message: "Cannot remove the last active super admin account." },
        { status: 400 },
      );
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      role: payload.role,
      active: payload.active,
      name: payload.name,
    },
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
