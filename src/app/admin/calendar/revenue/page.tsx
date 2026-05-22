import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminRevenue } from "@/components/admin/sections/admin-revenue";
import { authOptions } from "@/lib/auth";

export default async function AdminRevenuePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    notFound();
  }

  return (
    <div>
      <AdminBreadcrumbs
        trail={[
          { label: "Admin", href: "/admin/calendar" },
          { label: "Revenue" },
        ]}
      />
      <Suspense fallback={<div className="admin-revenue-loading ac-mono">Loading…</div>}>
        <AdminRevenue />
      </Suspense>
    </div>
  );
}
