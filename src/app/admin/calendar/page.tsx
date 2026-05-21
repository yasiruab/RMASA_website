import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { AdminHub, type HubActivity } from "@/components/admin/hub/admin-hub";
import { authOptions } from "@/lib/auth";
import { buildRevenueModel } from "@/lib/admin/revenue-model";
import { readCalendarDb } from "@/lib/calendar-store";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminCalendarHubPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/admin/login?next=/admin/calendar");
  }
  const email = session.user.email ?? "—";
  const isSuperAdmin = session.user.role === "super_admin";

  const [db, auditRows] = await Promise.all([
    readCalendarDb(),
    prisma.auditLog.findMany({
      where: { resourceType: "booking" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        actorEmail: true,
        action: true,
        resourceId: true,
        meta: true,
        actor: { select: { role: true } },
      },
    }),
  ]);

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 89);
  const rangeStart = ninetyDaysAgo.toISOString().slice(0, 10);
  const rangeEnd = today.toISOString().slice(0, 10);

  const revenue = buildRevenueModel(db.bookings, rangeStart, rangeEnd);

  const activity: HubActivity[] = auditRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorEmail: row.actorEmail,
    actorRole: row.actor?.role === "super_admin" ? "super_admin" : row.actor ? "admin" : "system",
    action: row.action,
    resourceId: row.resourceId,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
  }));

  return (
    <AdminHub
      activity={activity}
      blocks={db.blocks}
      bookings={db.bookings}
      email={email}
      isSuperAdmin={isSuperAdmin}
      revenue={revenue}
    />
  );
}
