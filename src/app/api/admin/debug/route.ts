import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const resendKeySet = !!(process.env.RESEND_API_KEY ?? process.env._AMPLIFY_RESEND_API_KEY);
  const resendFrom = process.env.RESEND_FROM ?? process.env._AMPLIFY_RESEND_FROM ?? "(not set — will use onboarding@resend.dev)";
  const adminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env._AMPLIFY_ADMIN_NOTIFICATION_EMAIL) ? "(set)" : "(not set)";

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
    emailLogTableExists,
    emailLogCount,
    recentEmailLogs,
  });
}
