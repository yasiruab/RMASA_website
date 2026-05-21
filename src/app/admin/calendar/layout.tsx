import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminSessionProvider } from "@/components/admin/admin-session-context";

export default async function AdminCalendarLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/admin/login?next=/admin/calendar");
  }

  const role = session.user.role === "super_admin" ? "super_admin" : "admin";
  const sessionValue = {
    userId: session.user.id,
    email: session.user.email ?? null,
    role,
    isSuperAdmin: role === "super_admin",
  } as const;

  // Public Nav + Footer from the root layout already wrap every admin page in
  // the Arena Court chrome. This layout just enforces auth and exposes the
  // signed-in identity to client pages via context. Each page renders its own
  // hero + breadcrumb inside <section className="admin-section">.
  return (
    <AdminSessionProvider value={sessionValue}>
      <section className="admin-section">{children}</section>
    </AdminSessionProvider>
  );
}
