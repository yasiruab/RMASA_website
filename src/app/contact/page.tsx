import Link from "next/link";
import { ContactForm } from "@/components/contact-form";

export default function ContactPage() {
  return (
    <section className="page-section container">
      <h1>Contact Us</h1>
      <p className="section-intro">
        Share your booking preferences or ask about venue options. Include intended date/time,
        participant count, and event purpose for faster processing.
      </p>
      <ContactForm />
      <p className="link-row">
        If you are ready to start planning slots, continue to <Link href="/bookings">Bookings</Link>.
      </p>
    </section>
  );
}
