import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type AuditInput = {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export async function logAuditEvent(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        meta: (input.meta as Prisma.InputJsonValue | undefined) ?? undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch {
    // Avoid blocking primary flows if audit persistence fails.
  }
}
