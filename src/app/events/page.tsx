import Image from "next/image";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function EventsPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Events" />
      <h1>Events</h1>

      <article className="event-article">
        <h2>Opening Ceremony of Royal MAS Arena</h2>
        <p className="event-meta">July 2, 2017 • Royal MAS Arena • Events</p>
        <p>
          Royal MAS Arena, built at a cost of Rs. 150 million, was donated to their Alma Mater by
          the founders of MAS and constructed by the 04th Engineering Regiment of the Sri Lanka
          Army.
        </p>
        <p>
          The arena was ceremonially opened on 28 March by Prime Minister Ranil Wickremesinghe
          amidst a gathering of distinguished dignitaries.
        </p>
        <div className="event-images">
          <Image
            alt="Opening ceremony"
            height={210}
            sizes="(max-width: 980px) 94vw, 46vw"
            src="/rmasa/about.jpg"
            width={420}
          />
          <Image alt="Audience" height={210} sizes="(max-width: 980px) 94vw, 46vw" src="/rmasa/activities.jpg" width={420} />
        </div>
      </article>
    </section>
  );
}
