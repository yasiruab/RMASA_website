import Link from "next/link";
import { bookingRoadmap } from "@/content/site-content";

export default function BookingsPage() {
  return (
    <section className="page-section container prose">
      <h1>Bookings</h1>
      <p>
        Booking automation is currently being built. Right now, booking requests are handled
        through the enquiry flow while calendar logic is finalized.
      </p>
      <h2>Current Booking Steps</h2>
      <ol>
        <li>Review facilities and activity options.</li>
        <li>Submit preferred dates, times, and purpose through Contact Us.</li>
        <li>RMASA team validates slot availability and confirms next actions.</li>
      </ol>
      <div className="cta-row">
        <Link className="btn btn-primary" href="/contact">
          Submit Booking Enquiry
        </Link>
        <Link className="btn btn-outline" href="/facilities">
          Review Facilities
        </Link>
      </div>
      <h2>Calendar Module Roadmap</h2>
      <ul>
        {bookingRoadmap.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>
        Contact and Bookings are intentionally connected to keep the visitor path clear before
        full automation goes live.
      </p>
    </section>
  );
}
