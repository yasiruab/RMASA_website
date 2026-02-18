import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { authOptions } from "@/lib/auth";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith("/admin") ? params.next : "/admin/calendar/dashboard";

  if (session?.user?.id) {
    redirect(nextPath);
  }

  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Admin Login" />
      <h1>Admin Sign In</h1>
      <p>Sign in with your admin account to access booking operations and configuration tools.</p>
      <div className="contact-form-wrap">
        <AdminLoginForm nextPath={nextPath} />
      </div>
    </section>
  );
}
