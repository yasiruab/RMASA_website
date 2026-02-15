import { Breadcrumbs } from "@/components/breadcrumbs";

const faqItems = [
  {
    question: "How do I start a booking?",
    answer:
      "Go to the Bookings page, select your preferred space, then continue to the Contact page to submit your enquiry.",
  },
  {
    question: "When is my booking confirmed?",
    answer:
      "A booking is confirmed only after the RMASA team reviews your request and shares confirmation details directly.",
  },
  {
    question: "Can I cancel or reschedule?",
    answer:
      "Yes. Contact the team as early as possible by phone, email, or WhatsApp so they can review your schedule request.",
  },
  {
    question: "Do you support event and tournament use?",
    answer:
      "Yes. The Main Arena is suitable for large events and competitions, while the Studio Room suits rehearsals and training.",
  },
  {
    question: "How can I share event requirements?",
    answer:
      "Use the enquiry form and include preferred date, time, participant count, and any setup requirements in your message.",
  },
];

export default function FaqPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="FAQ" />
      <h1>Frequently Asked Questions</h1>
      <p>
        Common questions about booking flow, confirmation, and venue usage. If your case is
        specific, contact us directly for a faster answer.
      </p>
      <div className="faq-list">
        {faqItems.map((item) => (
          <article className="faq-item" key={item.question}>
            <h2>{item.question}</h2>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
