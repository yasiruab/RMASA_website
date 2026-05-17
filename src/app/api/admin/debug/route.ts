import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const resendKeySet = !!(process.env.RESEND_API_KEY ?? process.env._AMPLIFY_RESEND_API_KEY);
  const resendFrom = process.env.RESEND_FROM ?? process.env._AMPLIFY_RESEND_FROM ?? "(not set — will use onboarding@resend.dev)";
  const adminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env._AMPLIFY_ADMIN_NOTIFICATION_EMAIL) ? "(set)" : "(not set)";

  const describe = (raw: string | undefined) => {
    if (raw === undefined) return "undefined";
    if (raw === "") return "empty-string";
    return `len=${raw.length}`;
  };

  const envProbe = {
    RESEND_API_KEY: describe(process.env.RESEND_API_KEY),
    _AMPLIFY_RESEND_API_KEY: describe(process.env._AMPLIFY_RESEND_API_KEY),
    RESEND_FROM: describe(process.env.RESEND_FROM),
    _AMPLIFY_RESEND_FROM: describe(process.env._AMPLIFY_RESEND_FROM),
    ADMIN_NOTIFICATION_EMAIL: describe(process.env.ADMIN_NOTIFICATION_EMAIL),
    _AMPLIFY_ADMIN_NOTIFICATION_EMAIL: describe(process.env._AMPLIFY_ADMIN_NOTIFICATION_EMAIL),
    DATABASE_URL: describe(process.env.DATABASE_URL),
    _AMPLIFY_DATABASE_URL: describe(process.env._AMPLIFY_DATABASE_URL),
    NEXTAUTH_URL: describe(process.env.NEXTAUTH_URL),
    _AMPLIFY_NEXTAUTH_URL: describe(process.env._AMPLIFY_NEXTAUTH_URL),
    COGNITO_CLIENT_ID: describe(process.env.COGNITO_CLIENT_ID),
    _AMPLIFY_COGNITO_CLIENT_ID: describe(process.env._AMPLIFY_COGNITO_CLIENT_ID),
  };

  const allEnvKeys = Object.keys(process.env).filter(
    (k) => k.includes("RESEND") || k.includes("ADMIN") || k.startsWith("_AMPLIFY_") || k === "DATABASE_URL" || k.startsWith("COGNITO") || k.startsWith("NEXTAUTH"),
  ).sort();

  let emailLogTableExists = false;
  let emailLogCount = 0;
  let recentEmailLogs: unknown[] = [];

  try {
    emailLogCount = await prisma.emailLog.count();
    emailLogTableExists = true;
    recentEmailLogs = await prisma.emailLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingReference: true,
        type: true,
        toEmail: true,
        subject: true,
        status: true,
        errorMessage: true,
        createdAt: true,
      },
    });
  } catch {
    emailLogTableExists = false;
  }

  return NextResponse.json({
    resendKeySet,
    resendFrom,
    adminEmail,
    envProbe,
    allEnvKeys,
    emailLogTableExists,
    emailLogCount,
    recentEmailLogs,
  });
}
