import { Breadcrumbs } from "@/components/breadcrumbs";

type Fact = { value: string; label: string; sub: string; gold?: boolean };
type TimelineEntry = { year: string; title: string; body: string; current?: boolean };

const FACTS: Fact[] = [
  { value: "1,000", label: "PERSON CAPACITY", sub: "fully retractable seating", gold: true },
  { value: "2,000", label: "SQ FT TRAINING", sub: "A/C studio + mirrored wall" },
  { value: "LKR 150M", label: "INVESTMENT", sub: "donated by MAS founders" },
  { value: "2016", label: "YEAR OPENED", sub: "inaugurated 28 March" },
];

const TIMELINE: TimelineEntry[] = [
  {
    year: "2015",
    title: "Ground broken",
    body:
      "Site cleared on Rajakeeya Mawatha; construction begins under the 04th Engineering Regiment.",
  },
  {
    year: "2016",
    title: "Ceremonial opening",
    body:
      "28 March — opened by PM Ranil Wickremesinghe with distinguished guests in attendance.",
  },
  {
    year: "2018",
    title: "Public access expands",
    body:
      "Bookings opened to clubs, alumni, and community organisers beyond the school.",
  },
  {
    year: "NOW",
    title: "A bookings refresh",
    body:
      "New live calendar, instant holds, and 24-hour approval from the desk.",
    current: true,
  },
];

export default function AboutPage() {
  return (
    <>
      <section
        aria-label="About hero"
        className="ac-page-hero"
        style={{ backgroundImage: "url(/rmasa-hero-banners/rmasa-hero-banners-about.webp)" }}
      >
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="About" />
          <span className="ac-page-hero-eyebrow">{"// ABOUT THE ARENA"}</span>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              ABOUT<span className="punct">.</span>
            </span>
          </div>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">the purpose built indoor arena.</span>
          </div>
          <p className="ac-page-hero-lede">
            A purpose-built indoor arena on Rajakeeya Mawatha, designed to nurture young athletes
            and host events at every scale.
          </p>
        </div>
      </section>

      <section className="ac-fact-strip" aria-label="At a glance">
        {FACTS.map((fact) => (
          <div className="ac-fact-cell" key={fact.label}>
            <span className="ac-fact-label">{fact.label}</span>
            <div className="ac-fact-value">
              <span className={`ac-display ${fact.gold ? "is-gold" : ""}`}>{fact.value}</span>
            </div>
            <div className="ac-fact-sub">· {fact.sub}</div>
          </div>
        ))}
      </section>

      <section className="ac-story" aria-label="The story">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">01 /</span> THE STORY.
          </span>
          <span className="meta">ROYAL COLLEGE · RAJAKEEYA MAWATHA</span>
        </div>
        <div className="ac-story-grid">
          <div className="ac-story-body">
            <p>
              Royal MAS Arena is a versatile, fully functional arena, customisable to suit many
              sporting needs, located on Rajakeeya Mawatha, next to the entrance to the Royal
              College Primary Section.
            </p>
            <p>
              Featuring modern amenities such as completely retractable seating, fully equipped
              locker rooms and customisable lighting, the Royal MAS Arena also features Sri Lanka’s
              first-ever world-class gym pit for gymnastics. The arena can accommodate a maximum of{" "}
              <strong>1,000 spectators</strong>, and includes a 2,000 square foot training
              room/green room.
            </p>
            <p>
              Built at a cost of <strong>Rs. 150 million</strong>, Royal MAS Arena was donated to
              their Alma Mater by the founders of MAS and constructed by the 04th Engineering
              Regiment of the Sri Lanka Army.
            </p>
            <p>
              After construction, Royal MAS Arena was ceremonially opened on 28 March by Prime
              Minister Ranil Wickremesinghe amidst a gathering of distinguished dignitaries.
            </p>
            <p>
              The arena is designed to nurture and develop young sportsmen of the school and serve
              as a venue that benefits a range of sports in Sri Lanka including boxing, wrestling,
              karate, wushu, judo, fencing, table tennis, gymnastics, chess and carrom.
            </p>
            <p>This facility is managed by the Royal College Union.</p>
          </div>

          <aside className="ac-aside">
            <span className="ac-aside-eyebrow ac-aside-eyebrow-gold">{"// THE INTENT"}</span>
            <p className="ac-aside-quote">
              A venue that benefits a range of sports in Sri Lanka — and a home court for the next
              generation of Royalists.
            </p>
            <div className="ac-aside-block">
              <span className="ac-aside-eyebrow">MANAGED BY</span>
              <p className="ac-aside-name">The Royal College Union</p>
              <p className="ac-aside-note">Booking enquiries handled by the on-site desk.</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="ac-timeline-section" aria-label="A short history">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">02 /</span> A SHORT HISTORY.
          </span>
          <span className="meta">A DECADE OF THE FLOOR</span>
        </div>
        <ol className="ac-timeline">
          {TIMELINE.map((item) => (
            <li
              className={`ac-timeline-item ${item.current ? "is-current" : ""}`}
              key={item.year}
            >
              <div className="ac-timeline-marker" aria-hidden="true" />
              <div className="ac-timeline-headline">
                <span className="ac-display ac-timeline-year">{item.year}</span>
                <span className="ac-italic ac-timeline-title">{item.title}</span>
              </div>
              <p className="ac-timeline-body">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
