import { ContactForm } from "@/components/contact-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import Link from "next/link";

type ContactPageProps = {
  searchParams?: Promise<{
    space?: string | string[];
  }>;
};

const spaceLabelMap: Record<string, string> = {
  "main-arena": "Main Arena",
  "studio-room": "Studio Room",
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const spaceValue = resolvedSearchParams?.space;
  const selectedSpaceKey = Array.isArray(spaceValue)
    ? String(spaceValue[0] ?? "")
    : String(spaceValue ?? "");
  const selectedSpaceLabel = spaceLabelMap[selectedSpaceKey];
  const prefilledMessage = selectedSpaceLabel
    ? `I would like to enquire about booking the ${selectedSpaceLabel}.`
    : "";

  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Contact" />
      <h1>Contact</h1>
      <p>
        Ready to book directly? <Link href="/bookings">Open the Bookings calendar</Link>.
      </p>
      {selectedSpaceLabel ? (
        <p className="contact-context-banner">
          Booking context saved: <strong>{selectedSpaceLabel}</strong>. Continue with your enquiry
          below.
        </p>
      ) : null}

      <div className="contact-layout">
        <div className="contact-actions-grid">
          <a className="contact-action-card" href="tel:+94704421590">
            <h2>Call</h2>
            <p>+94 (0) 70 442 1590</p>
            <span>Tap to call now</span>
          </a>

          <a className="contact-action-card" href="mailto:info@royalmasarena.lk">
            <h2>Email</h2>
            <p>info@royalmasarena.lk</p>
            <span>Tap to open your mail app</span>
          </a>

          <a
            className="contact-action-card"
            href="https://maps.google.com/?q=Royal%20MAS%20Arena%20Colombo"
            rel="noopener noreferrer"
            target="_blank"
          >
            <h2>Address</h2>
            <p>Rajakeeya Mawatha, Colombo 007, Sri Lanka</p>
            <span>Open directions</span>
          </a>

          <a
            className="contact-action-card"
            href="https://www.facebook.com/royalmasarena"
            rel="noopener noreferrer"
            target="_blank"
          >
            <h2>Facebook</h2>
            <p>facebook.com/royalmasarena</p>
            <span>Visit page</span>
          </a>
        </div>

        <div className="map-panel">
          <h2>Find Us</h2>
          <p>Royal MAS Arena, Rajakeeya Mawatha, Colombo 007, Sri Lanka</p>
          <iframe
            className="map-frame"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src="https://www.google.com/maps?q=Royal%20MAS%20Arena%20Colombo&output=embed"
            title="Royal MAS Arena map"
          />
          <div className="contact-quick-row">
            <WhatsAppCta
              className="btn whatsapp-cta"
              message={
                selectedSpaceLabel
                  ? `Hi Royal MAS Arena, I would like to enquire about booking the ${selectedSpaceLabel}.`
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      <div className="contact-form-wrap">
        <h2>Send an Enquiry</h2>
        <ContactForm initialMessage={prefilledMessage} />
      </div>
    </section>
  );
}
