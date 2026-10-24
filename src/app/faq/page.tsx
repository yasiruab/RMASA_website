import Link from "next/link";
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
    <>
      <section aria-label="FAQ hero" className="ac-page-hero is-gradient">
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="FAQ" />
          <span className="ac-page-hero-eyebrow">{"// BOOKING HELP"}</span>
          <h1 className="ac-page-hero-title">
            <span className="ac-display">
              FAQ<span className="punct">.</span>
            </span>
          </h1>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">questions, answered.</span>
          </div>
          <p className="ac-page-hero-lede">
            Booking, confirmation and venue use. If your case is specific,{" "}
            <Link href="/contact">contact the desk</Link> for a faster answer.
          </p>
        </div>
      </section>

      <section aria-label="Frequently asked questions" className="ac-story">
        <div className="ac-section-heading">
          <h2 className="title">
            <span aria-hidden="true" className="num">01 /</span> THE ANSWERS.
          </h2>
          <span className="meta">{faqItems.length} QUESTIONS</span>
        </div>
        <div className="ac-faq-list">
          {faqItems.map((item) => (
            <article className="ac-faq-item" key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
