import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminSchedule } from "@/components/admin/sections/admin-schedule";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminSchedulePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    notFound();
  }

  return (
    <div>
      <AdminBreadcrumbs
        trail={[
          { label: "Admin", href: "/admin/calendar" },
          { label: "Calendar" },
        ]}
      />
      <Suspense fallback={<div className="admin-schedule-loading ac-mono">Loading…</div>}>
        <AdminSchedule />
      </Suspense>
    </div>
  );
}
