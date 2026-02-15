import Image from "next/image";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function FacilitiesPage() {
  return (
    <section className="page-section container content-page">
      <Breadcrumbs current="Facilities" />
      <h1>Facilities</h1>

      <div className="gallery-3">
        <Image alt="Main Arena" height={220} sizes="(max-width: 980px) 94vw, 32vw" src="/rmasa/slider-1.jpg" width={360} />
        <Image alt="Training area" height={220} sizes="(max-width: 980px) 94vw, 32vw" src="/rmasa/slider-2.jpg" width={360} />
        <Image alt="Support room" height={220} sizes="(max-width: 980px) 94vw, 32vw" src="/rmasa/slider-3.jpg" width={360} />
      </div>

      <h2>Main Arena</h2>
      <p>
        Main arena is a purpose designed sports and performing arts facility with seating capacity
        of 1000. The seating system can be configured depending on performance space and seating
        requirements. Suitable for boxing, karate, wushu, gymnastics, fencing, wrestling, table
        tennis, chess, carrom, seminars, theatre, concerts and more.
      </p>

      <h2>Training Room/Green Room</h2>
      <p>
        Air-conditioned 2,000 square foot training/rehearsal area with mirrored wall. Can be used
        for indoor sports practice, rehearsal, and training of visual or performing arts.
      </p>

      <h2>Other Facilities</h2>
      <p>
        The arena can be equipped with facilities needed to host events with large crowds,
        including spacious changing rooms, shower rooms, and toilets for both ladies and gents.
      </p>
    </section>
  );
}
