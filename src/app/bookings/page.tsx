import Link from "next/link";

export default function BookingsPage() {
  return (
    <section className="page-section container prose">
      <h1>Bookings</h1>
      <p>
        Full calendar automation is planned for the next phase. It will include slot
        availability, recurring reservations, pricing breakdown, approval workflow, and admin
        overrides.
      </p>
      <h2>Current Booking Journey</h2>
      <ol>
        <li>Review facilities and activity options.</li>
        <li>Share your preferred date, time, and purpose through the enquiry form.</li>
        <li>RMASA team confirms availability and next steps.</li>
      </ol>
      <div className="cta-row">
        <Link className="btn btn-primary" href="/contact">
          Submit Booking Enquiry
        </Link>
        <Link className="btn btn-outline" href="/facilities">
          Review Facilities
        </Link>
      </div>
      <p>
        The Bookings and Contact pages are intentionally linked both ways so visitors can move
        clearly through the reservation journey.
      </p>
    </section>
  );
}
