import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";
import { authOptions } from "@/lib/auth";

const adminSections = [
  { href: "/admin/calendar/dashboard", label: "Dashboard", requiresSuperAdmin: false },
  { href: "/admin/calendar/revenue", label: "Revenue", requiresSuperAdmin: false },
  { href: "/admin/calendar/accounts", label: "Accounts", requiresSuperAdmin: true },
  { href: "/admin/calendar/rooms", label: "Rooms", requiresSuperAdmin: true },
  { href: "/admin/calendar/event-types", label: "Event Types", requiresSuperAdmin: true },
  { href: "/admin/calendar/pricing", label: "Pricing", requiresSuperAdmin: true },
  { href: "/admin/calendar/bookings", label: "Bookings", requiresSuperAdmin: false },
  { href: "/admin/calendar/blockouts", label: "Blockouts", requiresSuperAdmin: false },
];

export default async function AdminCalendarLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/admin/login?next=/admin/calendar/dashboard");
  }

  const isSuperAdmin = session.user.role === "super_admin";

  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Admin Calendar" />
      <div className="admin-head-row">
        <div>
          <h1>Admin Calendar Console</h1>
          <p>
            Manage settings and operations by section. Use setup pages for configuration and
            operations pages for live booking actions.
          </p>
          <p className="admin-user-meta">
            Signed in as <strong>{session.user.email}</strong> ({session.user.role})
          </p>
        </div>
        <AdminLogoutButton />
      </div>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <h2>Navigation</h2>
          <nav className="admin-sidebar-nav" aria-label="Admin calendar sections">
            {adminSections
              .filter((section) => (section.requiresSuperAdmin ? isSuperAdmin : true))
              .map((section) => (
                <Link key={section.href} href={section.href}>
                  {section.label}
                </Link>
              ))}
          </nav>
        </aside>
        <div className="admin-content">{children}</div>
      </div>
    </section>
  );
}
