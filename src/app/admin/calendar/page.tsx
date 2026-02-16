import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdminCalendarConsole } from "@/components/admin/admin-calendar-console";

export default function AdminCalendarPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Admin Calendar" />
      <h1>Admin Calendar Console</h1>
      <p>
        Manage room types, appointment types, AC pricing matrix, blockouts, pending requests,
        approvals, and reconciliation records.
      </p>
      <AdminCalendarConsole />
    </section>
  );
}
