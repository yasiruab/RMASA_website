import Link from "next/link";

export default function AboutPage() {
  return (
    <section className="page-section container prose">
      <h1>About Royal MAS Arena</h1>
      <p>
        Royal MAS Arena is built to serve both competitive sports and community recreation.
        Our venue supports structured training, casual play, and organized events through a
        welcoming and practical environment.
      </p>
      <p>
        The RMASA website is being developed in phases. Phase 1 focuses on clear venue
        information and enquiry flow. Phase 2 will introduce complete online calendar-based
        booking automation.
      </p>
      <p>
        Continue to <Link href="/facilities">Facilities</Link> to review spaces, or go to{" "}
        <Link href="/contact">Contact Us</Link> for help selecting the right option.
      </p>
    </section>
  );
}
