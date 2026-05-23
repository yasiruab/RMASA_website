import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

type Stat = { label: string; value: string };

const MAIN_STATS: Stat[] = [
  { label: "CAPACITY", value: "1,000" },
  { label: "SEATING", value: "Retractable" },
  { label: "USE", value: "Sport · Theatre · Concerts" },
];

const STUDIO_STATS: Stat[] = [
  { label: "AREA", value: "2,000 sqft" },
  { label: "CLIMATE", value: "Air-conditioned" },
  { label: "FLOOR", value: "Wooden" },
  { label: "WALL", value: "Full mirror" },
  { label: "BEST FOR", value: "Dance · Rehearsal" },
  { label: "USE", value: "Practice · Green room" },
];

type Support = { label: string; body: string };
const SUPPORT: Support[] = [
  { label: "Changing rooms", body: "Lockers, benches and changing space for both teams and large groups." },
  { label: "Shower rooms", body: "Ladies and gents, with hot water on-site." },
  { label: "Toilets", body: "Multiple stations across both levels of the building." },
  { label: "Parking", body: "On Rajakeeya Mawatha, with overflow available nearby." },
];

export default function FacilitiesPage() {
  return (
    <>
      <section
        aria-label="Facilities hero"
        className="ac-page-hero"
        style={{ backgroundImage: "url(/rmasa-hero-banners/rmasa-hero-banners-facilities.webp)" }}
      >
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="Facilities" />
          <span className="ac-page-hero-eyebrow">{"// SPACES & SUPPORT"}</span>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              FACILITIES<span className="punct">.</span>
            </span>
          </div>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">every room, equipped.</span>
          </div>
          <p className="ac-page-hero-lede">
            Two purpose-built spaces and a full set of support amenities — designed for events at
            any scale.
          </p>
        </div>
      </section>

      <section className="ac-facility-section" aria-label="Main arena">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">01 /</span> MAIN ARENA.
          </span>
          <span className="meta">THE 1,200 SQM CENTRE FLOOR</span>
        </div>
        <div className="ac-facility-grid">
          <div
            className="ac-facility-media"
            style={{ backgroundImage: "url(/home-sliders/home-slider-2.webp)" }}
            aria-hidden="true"
          >
            <span className="ac-facility-badge">● CONFIG · CONCERT MODE</span>
          </div>
          <div className="ac-facility-body">
            <p>
              The main arena is a purpose-designed sports and performing arts facility with seating
              capacity of <strong>1,000</strong>. The seating system can be configured depending on
              performance space and seating requirements.
            </p>
            <p className="ac-facility-body-dim">
              Suitable for boxing, karate, wushu, gymnastics, fencing, wrestling, table tennis,
              chess, carrom, seminars, theatre, concerts and more.
            </p>
            <div className="ac-stat-grid ac-stat-grid-3">
              {MAIN_STATS.map((stat) => (
                <div className="ac-stat-card" key={stat.label}>
                  <span className="ac-stat-label">{stat.label}</span>
                  <span className="ac-stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
            <Link className="ac-btn-primary" href="/bookings">
              Reserve Main Arena <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="ac-facility-section is-alt" aria-label="Studio room">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">02 /</span> STUDIO ROOM.
          </span>
          <span className="meta">WOODEN-FLOOR REHEARSAL &amp; TRAINING</span>
        </div>
        <div className="ac-facility-grid is-reverse">
          <div className="ac-facility-body">
            <p>
              Air-conditioned <strong>2,000 square foot</strong> rehearsal and training room with a
              polished <strong>wooden floor</strong> and a full mirrored wall. Ideal for dance,
              movement classes, performing-arts rehearsal and small-group training.
            </p>
            <p className="ac-facility-body-dim">
              Doubles as a green room for performers during main arena events.
            </p>
            <div className="ac-stat-grid ac-stat-grid-3">
              {STUDIO_STATS.map((stat) => (
                <div className="ac-stat-card" key={stat.label}>
                  <span className="ac-stat-label">{stat.label}</span>
                  <span className="ac-stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
            <Link className="ac-btn-primary" href="/bookings">
              Book Studio Room <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div
            className="ac-facility-media"
            style={{ backgroundImage: "url(/home-sliders/home-slider-3.webp)" }}
            aria-hidden="true"
          />
        </div>
      </section>

      <section className="ac-support-section" aria-label="Support amenities">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">03 /</span> SUPPORT.
          </span>
          <span className="meta">EVERYTHING ROUND THE FLOOR</span>
        </div>
        <p className="ac-support-lede">
          The arena can be equipped with facilities needed to host events with large crowds,
          including spacious changing rooms, shower rooms, and toilets for both ladies and gents.
        </p>
        <div className="ac-support-grid">
          {SUPPORT.map((item) => (
            <article className="ac-support-card" key={item.label}>
              <span className="ac-display ac-support-card-title">{item.label}</span>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
