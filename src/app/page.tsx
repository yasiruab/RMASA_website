import Link from "next/link";

const highlights = [
  {
    title: "Court Bookings",
    description: "Reserve sports spaces for practice sessions, tournaments, or private events.",
  },
  {
    title: "Community Programs",
    description: "Weekly coaching and recreation activities for players across skill levels.",
  },
  {
    title: "Event Hosting",
    description: "Flexible venue areas for corporate gatherings, school events, and celebrations.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="kicker">Royal MAS Arena</p>
          <h1>Where sport and community meet.</h1>
          <p className="lead">
            Royal MAS Arena is a modern sports and events venue in Panagoda, designed for
            training, recreation, and memorable gatherings.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" href="/bookings">
              Start Booking Journey
            </Link>
            <Link className="btn btn-outline" href="/facilities">
              Explore Facilities
            </Link>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="container">
          <h2>What You Can Do Here</h2>
          <ul className="card-grid">
            {highlights.map((item) => (
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
            <h2>Booking and Enquiry Path</h2>
            <p>
              If you already know your dates, start from Bookings. If you need guidance on
              facilities, pricing, or event suitability, contact the team first.
            </p>
          </div>
          <div className="cta-stack">
            <Link className="btn btn-primary" href="/bookings">
              Go to Bookings
            </Link>
            <Link className="btn btn-outline" href="/contact">
              Go to Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
