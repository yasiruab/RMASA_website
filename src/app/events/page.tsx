import Image from "next/image";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata({
  title: "Events",
  description:
    "Events and news from Royal MAS Arena, including the venue's opening ceremony.",
  path: "/events",
});

export default function EventsPage() {
  return (
    <>
      <section aria-label="Events hero" className="ac-page-hero is-gradient">
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="Events" />
          <span className="ac-page-hero-eyebrow">{"// NEWS & EVENTS"}</span>
          <h1 className="ac-page-hero-title">
            <span className="ac-display">
              EVENTS<span className="punct">.</span>
            </span>
          </h1>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">moments on the floor.</span>
          </div>
          <p className="ac-page-hero-lede">
            Ceremonies, tournaments and milestones from Royal MAS Arena.
          </p>
        </div>
      </section>

      <section aria-label="Opening ceremony" className="ac-story">
        <div className="ac-section-heading">
          <h2 className="title">
            <span aria-hidden="true" className="num">01 /</span> OPENING CEREMONY.
          </h2>
          <span className="meta">2 JULY 2017 · ROYAL MAS ARENA</span>
        </div>
        <article className="ac-story-body ac-event-article">
          <p>
            Royal MAS Arena, built at a cost of <strong>Rs. 150 million</strong>, was donated to
            their Alma Mater by the founders of MAS and constructed by the 04th Engineering
            Regiment of the Sri Lanka Army.
          </p>
          <p>
            The arena was ceremonially opened on 28 March by Prime Minister Ranil Wickremesinghe
            amidst a gathering of distinguished dignitaries.
          </p>
          <div className="event-images">
            <Image
              alt="Dignitaries at the Royal MAS Arena opening ceremony"
              height={210}
              sizes="(max-width: 980px) 94vw, 46vw"
              src="/events/rmasa-opening-ceromony-1.webp"
              width={420}
            />
            <Image
              alt="Audience seated in the arena during the opening ceremony"
              height={210}
              sizes="(max-width: 980px) 94vw, 46vw"
              src="/events/rmasa-opening-ceromony-2.webp"
              width={420}
            />
          </div>
        </article>
      </section>
    </>
  );
}
