import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import {
  AdminCalendarConsole,
  type AdminCalendarSection,
} from "@/components/admin/admin-calendar-console";
import { authOptions } from "@/lib/auth";

const allowedSections: AdminCalendarSection[] = [
  "dashboard",
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
      <AdminCalendarConsole section={typedSection} />
    </div>
  );
}
