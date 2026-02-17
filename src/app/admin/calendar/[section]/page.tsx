import { notFound } from "next/navigation";
import {
  AdminCalendarConsole,
  type AdminCalendarSection,
} from "@/components/admin/admin-calendar-console";

const allowedSections: AdminCalendarSection[] = [
  "dashboard",
  "revenue",
  "rooms",
  "event-types",
  "pricing",
  "bookings",
  "blockouts",
];

const sectionTitles: Record<AdminCalendarSection, string> = {
  dashboard: "Dashboard",
  revenue: "Revenue Insights",
  rooms: "Rooms and Working Hours",
  "event-types": "Event Types",
  pricing: "Pricing Matrix",
  bookings: "Booking Queue",
  blockouts: "Calendar Blockouts",
};

export default async function AdminCalendarSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!allowedSections.includes(section as AdminCalendarSection)) {
    notFound();
  }

  const typedSection = section as AdminCalendarSection;

  return (
    <div>
      <h2>{sectionTitles[typedSection]}</h2>
      <AdminCalendarConsole section={typedSection} />
    </div>
  );
}
