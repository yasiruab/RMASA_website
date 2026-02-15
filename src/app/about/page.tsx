import Link from "next/link";
import { operatingPrinciples } from "@/content/site-content";

export default function AboutPage() {
  return (
    <section className="page-section container prose">
      <h1>About Royal MAS Arena</h1>
      <p>
        Royal MAS Arena is developed as a destination for sports participation and event
        hosting. The venue balances player needs, event practicality, and visitor comfort.
      </p>
      <h2>How We Operate</h2>
      <ul>
        {operatingPrinciples.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h2>Project Progress</h2>
      <p>
        Phase 1 delivers the full website experience and enquiry pipeline. Phase 2 introduces
        online booking automation with calendar logic and admin workflow controls.
      </p>
      <p>
        Review <Link href="/facilities">Facilities</Link> and <Link href="/activities">Activities</Link>,
        then use <Link href="/bookings">Bookings</Link> or <Link href="/contact">Contact Us</Link>.
      </p>
    </section>
  );
}
