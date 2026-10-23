import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { getActivePageAdmin } from "@/lib/auth-guards";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Only auto-forward an *active* admin. Using the raw session here would loop a
  // deactivated admin between this page and the admin layout's redirect.
  const admin = await getActivePageAdmin();
  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith("/admin") ? params.next : "/admin/calendar";

  if (admin) {
    redirect(nextPath);
  }

  return (
    <section className="page-section container admin-content-page">
      <Breadcrumbs current="Admin Login" />
      <h1>Admin Sign In</h1>
      <p>Sign in with your admin account to access booking operations and configuration tools.</p>
      <div className="contact-form-wrap">
        <AdminLoginForm nextPath={nextPath} />
      </div>
    </section>
  );
}
