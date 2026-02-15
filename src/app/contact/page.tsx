import { ContactForm } from "@/components/contact-form";

export default function ContactPage() {
  return (
    <section className="page-section container content-page">
      <h1>Contact</h1>

      <div className="contact-layout">
        <div>
          <h2>Address:</h2>
          <p>
            Royal MAS Arena,
            <br />
            Rajakeeya Mawatha,
            <br />
            Colombo 007,
            <br />
            Sri Lanka.
          </p>

          <h2>Phone:</h2>
          <p>+94 (0) 70 442 1590</p>

          <h2>E-Mail:</h2>
          <p>
            <a href="mailto:info@royalmasarena.lk">info@royalmasarena.lk</a>
          </p>

          <h2>Facebook Page:</h2>
          <p>
            <a href="https://www.facebook.com/royalmasarena" rel="noopener noreferrer" target="_blank">
              facebook.com/royalmasarena
            </a>
          </p>
        </div>

        <div>
          <iframe
            className="map-frame"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src="https://www.google.com/maps?q=Royal%20MAS%20Arena%20Colombo&output=embed"
            title="Royal MAS Arena map"
          />
        </div>
      </div>

      <div className="contact-form-wrap">
        <h2>Send an Enquiry</h2>
        <ContactForm />
      </div>
    </section>
  );
}
