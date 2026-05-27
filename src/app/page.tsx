import Link from "next/link";
import { HeroSlider } from "@/components/hero-slider";

type Chapter = {
  image: string;
  tag: string;
  title: string;
  italic: string;
  href: string;
  body: string;
};

const CHAPTERS: Chapter[] = [
  {
    image: "/rmasa-hero-banners/rmasa-hero-banners-about.webp",
    tag: "CHAPTER ONE",
    title: "About",
    italic: "the arena.",
    href: "/about",
    body: "A versatile indoor venue with retractable seating, modern amenities, and event-ready infrastructure.",
  },
  {
    image: "/rmasa-hero-banners/rmasa-hero-banners-activities.webp",
    tag: "CHAPTER TWO",
    title: "Activities",
    italic: "we host.",
    href: "/activities",
    body: "Boxing, fencing, gymnastics, karate, wushu, wrestling — plus seminars, meetings and performing arts.",
  },
  {
    image: "/rmasa-hero-banners/rmasa-hero-banners-facilities.webp",
    tag: "CHAPTER THREE",
    title: "Facilities",
    italic: "on offer.",
    href: "/facilities",
    body: "Purpose-designed main arena, training/green room, and support amenities for large-format events.",
  },
];

type RoomCard = {
  tag: string;
  name: string;
  name2: string;
  best: string;
  bullets: string[];
  meta: string[];
  cta: string;
  href: string;
  accent?: boolean;
};

const ROOMS: RoomCard[] = [
  {
    tag: "VENUE 01",
    name: "MAIN",
    name2: "ARENA",
    best: "Best for large competitions and high-attendance events.",
    bullets: [
      "Capacity up to 1,000 with configurable seating",
      "Suitable for tournaments, seminars, theatre and concerts",
      "Includes support spaces for event operations",
    ],
    meta: ["1,200 SQM", "LKR 18.5K/HR", "DAY · LKR 165K"],
    cta: "Book Main Arena",
    href: "/bookings",
    accent: true,
  },
  {
    tag: "VENUE 02",
    name: "STUDIO",
    name2: "ROOM",
    best: "Best for rehearsals, practice blocks, and workshops.",
    bullets: [
      "Air-conditioned 2,000 square foot training space",
      "Mirrored wall for movement-focused sessions",
      "Ideal for focused groups and repeat sessions",
    ],
    meta: ["280 SQM", "LKR 6.4K/HR", "DAY · LKR 56K"],
    cta: "Book Studio Room",
    href: "/bookings",
  },
];

export default function HomePage() {
  return (
    <>
      {/* LCP element — preload first slide so the browser fetches it during HTML parse
          instead of waiting for CSS to resolve the .ac-hero-slide background-image. */}
      <link
        rel="preload"
        as="image"
        href="/home-sliders/home-slider-1.webp"
        fetchPriority="high"
      />
      <HeroSlider />

      <section className="ac-intro" aria-label="Introduction">
        <div className="ac-intro-inner">
          <span className="ac-intro-eyebrow">{"// COLOMBO 07 · INDOOR SPORTS & EVENT VENUE"}</span>
          <p className="ac-intro-lede">
            Royal MAS Arena is a state-of-the-art, purpose-built indoor sports facility at{" "}
            <em>Rajakeeya Mawatha, Colombo 07.</em>
          </p>
          <p className="ac-intro-sub">
            Available for grappling sports, table tennis, chess, carom, skill development training,
            seminars, theatre, concerts and more.
          </p>
          <div className="ac-intro-phone">
            FOR RESERVATIONS · <span className="num">+94 (0) 70 442 1590</span>
          </div>
        </div>
      </section>

      <section className="ac-section-cards" aria-label="The tour">
        <div className="ac-section-heading">
          <span className="title">THE TOUR.</span>
          <span className="meta">THREE CHAPTERS · EVERY ROOM, EVERY USE</span>
        </div>
        <div className="ac-section-cards-grid">
          {CHAPTERS.map((chapter) => (
            <Link className="ac-section-card" href={chapter.href} key={chapter.title}>
              <div
                className="ac-section-card-media"
                style={{
                  backgroundImage: `linear-gradient(180deg, rgba(6,17,46,0) 60%, rgba(6,17,46,0.85)), url(${chapter.image})`,
                }}
              >
                <span className="ac-section-card-tag">{chapter.tag}</span>
              </div>
              <div className="ac-section-card-body">
                <div>
                  <div className="ac-section-card-title">
                    <span className="ac-display">
                      {chapter.title}
                      <span className="punct">.</span>
                    </span>
                  </div>
                  <div className="ac-section-card-italic">
                    <span className="ac-italic">{chapter.italic}</span>
                  </div>
                </div>
                <p>{chapter.body}</p>
                <span className="ac-read-more">Read more ↗</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="ac-room-compare" aria-label="Find the floor">
        <div className="ac-section-heading">
          <span className="title">FIND THE FLOOR.</span>
          <span className="meta">TWO CORE SPACES · PICK THE ONE FOR YOUR FORMAT</span>
        </div>
        <div className="ac-room-grid">
          {ROOMS.map((room) => (
            <div
              className={`ac-room-card ${room.accent ? "is-accent" : ""}`}
              key={room.tag}
            >
              {room.accent && <div className="ac-room-badge">● MOST POPULAR</div>}
              <span className="ac-room-tag">{room.tag}</span>
              <div className="ac-room-name">
                <span className="ac-display">{room.name}</span>
                <span className="ac-display">{room.name2}</span>
              </div>
              <p className="ac-room-best">{room.best}</p>
              <ul className="ac-room-bullets">
                {room.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <div className="ac-room-meta">
                {room.meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
              <Link className="ac-room-cta" href={room.href}>
                {room.cta} <span aria-hidden="true">↗</span>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="ac-closing" aria-label="Book the floor today">
        <div className="ac-closing-grid">
          <div>
            <span className="ac-closing-eyebrow">{"// READY?"}</span>
            <div className="ac-closing-title">
              <span className="ac-display">
                BOOK<span className="punct">.</span>
              </span>
            </div>
            <div className="ac-closing-italic">
              <span className="ac-italic">the floor today.</span>
            </div>
            <p className="ac-closing-sub">
              Open the live bookings calendar, hold a slot, and the desk confirms within 24 hours.
            </p>
            <div className="ac-closing-cta-row">
              <Link className="ac-btn-primary" href="/bookings">
                Open the calendar <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>

          <aside className="ac-assistance">
            <span className="ac-assistance-eyebrow">FOR ASSISTANCE</span>
            <p className="ac-assistance-body">The desk takes calls between 08:00–18:00 daily.</p>
            <p className="ac-assistance-phone">+94&nbsp;&nbsp;70&nbsp;&nbsp;442&nbsp;&nbsp;1590</p>
            <Link className="ac-assistance-link" href="/contact">
              Or write to the bookings office →
            </Link>
          </aside>
        </div>
      </section>
    </>
  );
}
