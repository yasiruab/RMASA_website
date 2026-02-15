import Link from "next/link";

export default function BookingsPage() {
  return (
    <section className="page-section container content-page">
      <h1>Bookings</h1>
      <p>Please select the preferred room to continue with the booking.</p>

      <div className="booking-grid">
        <article className="booking-card">
          <h2>Main Arena</h2>
          <p>Ideal for tournaments, events, seminars and large-format programs.</p>
          <Link className="read-more" href="/contact">
            Enquire Main Arena
          </Link>
        </article>

        <article className="booking-card">
          <h2>Studio Room</h2>
          <p>Suitable for rehearsals, workshops, training blocks and focused sessions.</p>
          <Link className="read-more" href="/contact">
            Enquire Studio Room
          </Link>
        </article>
      </div>
    </section>
  );
}
