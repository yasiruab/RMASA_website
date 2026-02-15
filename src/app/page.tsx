import Image from "next/image";
import Link from "next/link";
import { HeroSlider } from "@/components/hero-slider";

const cards = [
  {
    title: "About",
    image: "/rmasa/about.jpg",
    href: "/about",
    text: "A versatile indoor arena with retractable seating, modern amenities, and event-ready infrastructure.",
  },
  {
    title: "Activities",
    image: "/rmasa/activities.jpg",
    href: "/activities",
    text: "Supports boxing, fencing, gymnastics, karate, wushu, wrestling, seminars, meetings, and performing arts.",
  },
  {
    title: "Facilities",
    image: "/rmasa/facilities.jpg",
    href: "/facilities",
    text: "Purpose-designed main arena, training/green room, and support amenities for large-format events.",
  },
];

export default function HomePage() {
  return (
    <>
      <HeroSlider />

      <section className="home-intro container">
        <p>
          <strong>
            Royal MAS Arena is a state of the art, purpose built indoor sports facility located at
            Rajakeeya Mawatha, Colombo 7.
          </strong>
        </p>
        <p>
          Available for grappling sports, table tennis, chess, carom, skill development training,
          seminars, theatre, concerts and more.
        </p>
        <p>
          <strong>For reservations please contact +94 (0) 70 442 1590</strong>
        </p>
      </section>

      <section className="home-cards container" aria-label="Featured sections">
        {cards.map((card) => (
          <article className="feature-card" key={card.title}>
            <Image
              alt={card.title}
              className="feature-image"
              height={186}
              sizes="(max-width: 980px) 94vw, (max-width: 1200px) 30vw, 360px"
              src={card.image}
              width={280}
            />
            <h2>
              <Link href={card.href}>{card.title}</Link>
            </h2>
            <p>{card.text}</p>
            <Link className="read-more" href={card.href}>
              Read more
            </Link>
          </article>
        ))}
      </section>

      <section className="compare-wrap container" aria-label="Compare spaces">
        <h2>Find The Right Space Fast</h2>
        <p className="compare-intro">
          Compare our two core spaces and choose the one that best fits your event format.
        </p>
        <div className="compare-grid">
          <article className="compare-card">
            <h3>Main Arena</h3>
            <p className="compare-tag">Best for large competitions and high-attendance events.</p>
            <ul className="bullet-list">
              <li>Capacity up to 1,000 with configurable seating</li>
              <li>Suitable for tournaments, seminars, theatre and concerts</li>
              <li>Includes support spaces for event operations</li>
            </ul>
            <Link className="read-more" href="/bookings">
              Book Main Arena
            </Link>
          </article>

          <article className="compare-card">
            <h3>Studio Room</h3>
            <p className="compare-tag">Best for rehearsals, practice blocks, and workshops.</p>
            <ul className="bullet-list">
              <li>Air-conditioned 2,000 square foot training space</li>
              <li>Mirrored wall for movement-focused sessions</li>
              <li>Ideal for focused groups and repeat sessions</li>
            </ul>
            <Link className="read-more" href="/contact">
              Enquire Studio Room
            </Link>
          </article>
        </div>
      </section>
    </>
  );
}
