import Link from "next/link";

const activities = [
  "Badminton practice sessions",
  "Structured coaching programs",
  "Fitness and recreational play",
  "Corporate and private events",
  "Seasonal tournaments and leagues",
];

export default function ActivitiesPage() {
  return (
    <section className="page-section container">
      <h1>Activities</h1>
      <p className="section-intro">
        RMASA supports a range of programs for athletes, families, schools, and corporate
        groups.
      </p>
      <ul className="card-grid">
        {activities.map((item) => (
          <li className="card" key={item}>
            <p>{item}</p>
          </li>
        ))}
      </ul>
      <p className="link-row">
        Check space options on <Link href="/facilities">Facilities</Link> or proceed to{" "}
        <Link href="/bookings">Bookings</Link>.
      </p>
    </section>
  );
}
