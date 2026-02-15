import { Breadcrumbs } from "@/components/breadcrumbs";

export default function PrivacyPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Privacy Policy" />
      <h1>Privacy Policy</h1>
      <p>Last updated: February 15, 2026</p>

      <h2>What We Collect</h2>
      <p>
        When you submit an enquiry, we collect your name, contact number, email address, message,
        and consent confirmation.
      </p>

      <h2>Why We Collect It</h2>
      <p>
        We use enquiry details to respond to booking requests, clarify requirements, and coordinate
        venue scheduling and follow-up communication.
      </p>

      <h2>How We Handle Your Data</h2>
      <p>
        Enquiry information is used only for operational communication related to Royal MAS Arena
        services. We do not publish personal contact details.
      </p>

      <h2>Data Retention</h2>
      <p>
        We retain enquiry records only as long as needed for booking administration, compliance,
        and service follow-up.
      </p>

      <h2>Your Choices</h2>
      <p>
        You may request an update or deletion of your submitted enquiry data by contacting the
        venue team at <a href="mailto:info@royalmasarena.lk">info@royalmasarena.lk</a>.
      </p>
    </section>
  );
}
