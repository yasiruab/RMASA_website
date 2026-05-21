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

// "dashboard" was replaced by the new hub at /admin/calendar.
// "bookings" was replaced by the explicit route at /admin/calendar/bookings,
// which Next.js automatically prefers over this dynamic segment.
const allowedSections: AdminCalendarSection[] = [
  "revenue",
  "accounts",
  "rooms",
  "event-types",
  "pricing",
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
