import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/components/admin/admin-session-context";
import { requireAdminPage } from "@/lib/auth-guards";
// Admin-only stylesheet — scoped to /admin/calendar/* so its ~130 KB of admin
// selectors don't ship on every public page (PSI flagged 99% unused).
import "../../../styles/admin.css";

export default async function AdminCalendarLayout({ children }: { children: ReactNode }) {
  // Role comes from Postgres, not the JWT, so a demoted super-admin stops
  // seeing super-admin UI on their next page load.
  const admin = await requireAdminPage();
  const sessionValue = {
    userId: admin.userId,
    email: admin.email ?? null,
    role: admin.role,
    isSuperAdmin: admin.role === "super_admin",
  } as const;

  // Public Nav + Footer from the root layout already wrap every admin page in
  // the Arena Court chrome. This layout just enforces auth and exposes the
  // signed-in identity to client pages via context. Each page renders its own
  // hero + breadcrumb inside <section className="admin-section">.
  return (
    <AdminSessionProvider value={sessionValue}>
      {/* data-clarity-mask: backstop so Clarity never captures customer PII here,
          even if a session that started on a public page is still recording. */}
      <section className="admin-section" data-clarity-mask="true">
        {children}
      </section>
    </AdminSessionProvider>
  );
}
