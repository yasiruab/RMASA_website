import Link from "next/link";
import { activities } from "@/content/site-content";

export default function ActivitiesPage() {
  return (
    <section className="page-section container">
      <h1>Activities</h1>
      <p className="section-intro">
        RMASA supports training, recreation, and event programs for players, families, clubs,
        schools, and corporate groups.
      </p>
      <ul className="card-grid">
        {activities.map((item) => (
          <li className="card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.details}</p>
          </li>
        ))}
      </ul>
      <p className="link-row">
        Continue to <Link href="/facilities">Facilities</Link> for venue details, then visit{" "}
        <Link href="/bookings">Bookings</Link> to begin scheduling.
      </p>
    </section>
  );
}
