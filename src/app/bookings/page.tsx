import { BookingCalendarFlow } from "@/components/calendar/booking-calendar-flow";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata({
  title: "Book the Floor",
  description:
    "Check live availability and request the Main Arena or Studio Room at Royal MAS Arena. The bookings desk replies within 24 hours.",
  path: "/bookings",
});

export default function BookingsPage() {
  return <BookingCalendarFlow />;
}
