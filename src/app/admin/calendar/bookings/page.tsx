import { Suspense } from "react";
import { AdminBookings } from "@/components/admin/sections/admin-bookings";

export const dynamic = "force-dynamic";

export default function AdminBookingsPage() {
  return (
    <Suspense fallback={null}>
      <AdminBookings />
    </Suspense>
  );
}
