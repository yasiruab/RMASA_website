import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import {
  AdminCalendarConsole,
  type AdminCalendarSection,
} from "@/components/admin/admin-calendar-console";
import { authOptions } from "@/lib/auth";

const SECTION_LABELS: Record<AdminCalendarSection, string> = {
  dashboard: "Console",
  revenue: "Revenue",
  accounts: "Accounts",
  rooms: "Rooms",
  "event-types": "Event Types",
  pricing: "Pricing",
  bookings: "Bookings",
  blockouts: "Blockouts",
};

// "dashboard" used to be the default; it has been replaced by the new hub at
// /admin/calendar. The remaining legacy sections stay here until each is
// reimplemented as an explicit route in Phase 5 of the admin redesign.
const allowedSections: AdminCalendarSection[] = [
  "revenue",
  "accounts",
  "rooms",
  "event-types",
  "pricing",
  "bookings",
  "blockouts",
];

export default async function AdminCalendarSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    notFound();
  }

  const { section } = await params;
  if (!allowedSections.includes(section as AdminCalendarSection)) {
    notFound();
  }

  const typedSection = section as AdminCalendarSection;
  if (
    ["accounts", "rooms", "event-types", "pricing"].includes(typedSection) &&
    session.user.role !== "super_admin"
  ) {
    notFound();
  }

  return (
    <div>
      <AdminBreadcrumbs
        trail={[
          { label: "Admin", href: "/admin/calendar" },
          { label: SECTION_LABELS[typedSection] ?? typedSection },
        ]}
      />
      <AdminCalendarConsole section={typedSection} />
    </div>
  );
}
