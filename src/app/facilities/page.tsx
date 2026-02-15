import Link from "next/link";

const facilities = [
  {
    title: "Indoor Badminton Courts",
    description: "Competition-ready courts for training blocks, casual sessions, and events.",
  },
  {
    title: "Multipurpose Event Zones",
    description: "Adaptable spaces suitable for workshops, private programs, and gatherings.",
  },
  {
    title: "Support Amenities",
    description: "Changing areas, spectator comfort, and operational support for event days.",
  },
  {
    title: "Parking and Access",
    description: "Convenient access routes and on-site circulation designed for steady traffic.",
  },
];

export default function FacilitiesPage() {
  return (
    <section className="page-section container">
      <h1>Facilities</h1>
      <p className="section-intro">
        Browse venue areas available for sports and event reservations. Final scheduling and
        slot confirmation will be handled through the booking workflow.
      </p>
      <ul className="card-grid">
        {facilities.map((facility) => (
          <li className="card" key={facility.title}>
            <h2>{facility.title}</h2>
            <p>{facility.description}</p>
          </li>
        ))}
      </ul>
      <p className="link-row">
        Ready to reserve? Visit <Link href="/bookings">Bookings</Link>. Need advice first?
        Visit <Link href="/contact"> Contact Us</Link>.
      </p>
    </section>
  );
}
