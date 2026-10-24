import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { REDACTED_EMAIL, REDACTED_FIELDS, emailLogRetentionCutoff } from "@/lib/email-log-retention";
import { prisma } from "@/lib/prisma";

// Daily EmailLog retention job (GitHub Actions → POST, Bearer CRON_SECRET).
// Redacts the personal fields of rows older than the retention window; see
// src/lib/email-log-retention.ts for the policy. Idempotent: already-redacted
// rows are skipped, so a missed or repeated run is harmless.
export async function POST(req: Request) {
  if (!hasValidCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const cutoff = emailLogRetentionCutoff(new Date());
  const { count } = await prisma.emailLog.updateMany({
    where: { createdAt: { lt: cutoff }, toEmail: { not: REDACTED_EMAIL } },
    data: REDACTED_FIELDS,
  });

  if (count > 0) {
    await logAuditEvent({
      actorEmail: "cron:email-log-retention",
      action: "EMAIL_LOG_REDACTED",
      resourceType: "email_log",
      meta: { redacted: count, cutoff: cutoff.toISOString() },
    });
  }

  return NextResponse.json({ redacted: count, cutoff: cutoff.toISOString() });
}
