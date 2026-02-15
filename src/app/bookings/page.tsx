import { Breadcrumbs } from "@/components/breadcrumbs";
import { GuidedBookingFlow } from "@/components/guided-booking-flow";

export default function BookingsPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Bookings" />
      <h1>Bookings</h1>
      <p>Select your preferred room, then continue with a prefilled enquiry.</p>
      <GuidedBookingFlow />
    </section>
  );
}
