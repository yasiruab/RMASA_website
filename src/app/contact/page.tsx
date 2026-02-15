import Link from "next/link";
import { ContactForm } from "@/components/contact-form";

export default function ContactPage() {
  return (
    <section className="page-section container">
      <h1>Contact Us</h1>
      <p className="section-intro">
        Ask about facilities, activities, and availability. If you are ready to reserve a
        slot, include your preferred dates and times.
      </p>
      <ContactForm />
      <p className="link-row">
        Ready to reserve? Go to <Link href="/bookings">Bookings</Link> for the booking
        journey.
      </p>
    </section>
  );
}
