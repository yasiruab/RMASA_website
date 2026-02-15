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
            <Image alt={card.title} className="feature-image" height={186} src={card.image} unoptimized width={280} />
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
    </>
  );
}
