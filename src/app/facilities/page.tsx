import Link from "next/link";
import { facilities } from "@/content/site-content";

export default function FacilitiesPage() {
  return (
    <section className="page-section container">
      <h1>Facilities</h1>
      <p className="section-intro">
        Explore the venue zones available for sports and event usage. Final slot allocation is
        confirmed through booking workflow.
      </p>
      <ul className="card-grid">
        {facilities.map((facility) => (
          <li className="card" key={facility.title}>
            <h2>{facility.title}</h2>
            <p>{facility.description}</p>
          </li>
        ))}
      </ul>
      <div className="cta-row">
        <Link className="btn btn-primary" href="/bookings">
          Start Booking Enquiry
        </Link>
        <Link className="btn btn-outline" href="/contact">
          Ask a Question
        </Link>
      </div>
    </section>
  );
}
