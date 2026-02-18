import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

type ResetPasswordPayload = {
  password?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const payload = (await req.json()) as ResetPasswordPayload;
  const password = String(payload.password ?? "").trim();

  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_ACCOUNT_PASSWORD_RESET",
    resourceType: "admin_account",
    resourceId: id,
    meta: { targetEmail: target.email },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Password reset." });
}
