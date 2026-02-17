import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

const adminSections = [
  { href: "/admin/calendar/dashboard", label: "Dashboard" },
  { href: "/admin/calendar/revenue", label: "Revenue" },
  { href: "/admin/calendar/rooms", label: "Rooms" },
  { href: "/admin/calendar/event-types", label: "Event Types" },
  { href: "/admin/calendar/pricing", label: "Pricing" },
  { href: "/admin/calendar/bookings", label: "Bookings" },
  { href: "/admin/calendar/blockouts", label: "Blockouts" },
];

export default function AdminCalendarLayout({ children }: { children: ReactNode }) {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Admin Calendar" />
      <h1>Admin Calendar Console</h1>
      <p>
        Manage settings and operations by section. Use setup pages for configuration and
        operations pages for live booking actions.
      </p>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <h2>Navigation</h2>
          <nav className="admin-sidebar-nav" aria-label="Admin calendar sections">
            {adminSections.map((section) => (
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
