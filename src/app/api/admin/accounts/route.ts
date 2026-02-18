import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

type CreateAccountPayload = {
  email?: string;
  password?: string;
  role?: "admin" | "super_admin";
  name?: string;
};

function isEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
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

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as CreateAccountPayload;
  const email = String(payload.email ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "").trim();
  const role = payload.role === "super_admin" ? "super_admin" : "admin";
  const name = String(payload.name ?? "").trim() || null;

  if (!email || !password || !isEmail(email)) {
    return NextResponse.json({ message: "Valid email and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ message: "Account already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      active: true,
      passwordHash,
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
    action: "ADMIN_ACCOUNT_CREATED",
    resourceType: "admin_account",
    resourceId: user.id,
    meta: { email: user.email, role: user.role },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Account created.", user });
}
