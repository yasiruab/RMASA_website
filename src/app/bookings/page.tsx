import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BookingCalendarFlow } from "@/components/calendar/booking-calendar-flow";

export default function BookingsPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Bookings" />
      <h1>Bookings</h1>
      <p>
        Choose a room, appointment duration, and available slots from the calendar. All requests are
        submitted as <strong>pending</strong> until admin approval.
      </p>
      <p>
        Looking for general venue information first? <Link href="/contact">Go to Contact</Link>.
      </p>
      <BookingCalendarFlow />
    </section>
  );
}
