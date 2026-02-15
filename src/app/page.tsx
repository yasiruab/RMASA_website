import Link from "next/link";
import { quickStats, venueHighlights } from "@/content/site-content";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="kicker">Royal MAS Arena</p>
          <h1>Train, compete, and host with confidence.</h1>
          <p className="lead">
            A practical, modern venue designed for badminton, recreation, and multi-purpose
            events in Panagoda.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" href="/bookings">
              Start Booking Journey
            </Link>
            <Link className="btn btn-outline" href="/contact">
              Contact Venue Team
            </Link>
          </div>
        </div>
      </section>

      <section className="stats-strip" aria-label="Venue quick facts">
        <div className="container stats-grid">
          {quickStats.map((item) => (
            <article className="stat" key={item.label}>
              <p className="stat-label">{item.label}</p>
              <p className="stat-value">{item.value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="page-section">
        <div className="container">
          <h2>Venue Highlights</h2>
          <ul className="card-grid">
            {venueHighlights.map((item) => (
              <li className="card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="page-section band">
        <div className="container split">
          <div>
            <h2>Simple Visitor Journey</h2>
            <p>
              Visitors can start with information discovery, then move to booking enquiry.
              Bookings and Contact pages are cross-linked to keep the flow clear.
            </p>
          </div>
          <div className="cta-stack">
            <Link className="btn btn-primary" href="/bookings">
              Go to Bookings
            </Link>
            <Link className="btn btn-outline" href="/facilities">
              Browse Facilities
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
