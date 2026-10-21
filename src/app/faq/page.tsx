import { Breadcrumbs } from "@/components/breadcrumbs";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata({
  title: "FAQ",
  description:
    "Answers to common questions about booking, confirmation, cancellation and using Royal MAS Arena.",
  path: "/faq",
});

const faqItems = [
  {
    question: "How do I start a booking?",
    answer:
      "Go to the Bookings page, choose the room and event type, pick your slots on the live calendar, then fill in your details and submit the request on the same page.",
  },
  {
    question: "When is my booking confirmed?",
    answer:
      "A booking is confirmed only after the bookings desk reviews your request — usually within 24 hours — and lets you know the outcome.",
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
      "Add them in the Purpose of Booking field when you book — expected participants, setup needs and anything else we should know. For anything longer, use the enquiry form on the Contact page.",
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
