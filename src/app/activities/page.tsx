import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

type Activity = {
  label: string;
  image: string;
};

// Order: sport/combat first, then performance, then formal gatherings.
// Image filenames live in public/activities/ — swap a file at the same name to
// change the photo, or append to this list (and drop a matching .webp in
// public/activities/) to add a new activity.
const ACTIVITIES: Activity[] = [
  { label: "Badminton", image: "/activities/Activities-Badminton-1.webp" },
  { label: "Fencing", image: "/activities/activities-fencing-1.webp" },
  { label: "Gymnastics", image: "/activities/activities-gymnastics-1.webp" },
  { label: "Martial Arts", image: "/activities/activities-martial-arts-1.webp" },
  { label: "Concerts", image: "/activities/activities-concerts-1.webp" },
  { label: "Fashion Shows", image: "/activities/activities-fashion-shows-1.webp" },
  { label: "Exhibitions", image: "/activities/activities-exhibitions-1.webp" },
  { label: "Seminars", image: "/activities/activities-seminars-1.webp" },
  { label: "Gatherings", image: "/activities/activities-gatherings-1.webp" },
];

export default function ActivitiesPage() {
  return (
    <>
      <section
        aria-label="Activities hero"
        className="ac-page-hero"
        style={
          {
            backgroundImage: "url(/rmasa-hero-banners/rmasa-hero-banners-activities.webp)",
            "--hero-bg-pos": "center 15%",
          } as CSSProperties
        }
      >
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="Activities" />
          <span className="ac-page-hero-eyebrow">{"// WHAT THE FLOOR CAN HOST"}</span>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              ACTIVITIES<span className="punct">.</span>
            </span>
          </div>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">sport, training, gatherings.</span>
          </div>
          <p className="ac-page-hero-lede">
            From combat sports to chess tournaments, performing arts to corporate gatherings — the
            floor has hosted them all.
          </p>
        </div>
      </section>

      <section className="ac-disciplines-section" aria-label="Disciplines">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">01 /</span> THE DISCIPLINES.
          </span>
          <span className="meta">{ACTIVITIES.length} USES</span>
        </div>

        <div className="ac-discipline-grid">
          {ACTIVITIES.map((activity) => (
            <article className="ac-activity-card" key={activity.label}>
              <div className="ac-activity-image">
                <Image
                  alt={activity.label}
                  fill
                  sizes="(max-width: 600px) 100vw, (max-width: 980px) 50vw, 33vw"
                  src={activity.image}
                />
              </div>
              <div className="ac-activity-body">
                <span className="ac-display ac-activity-name">{activity.label}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ac-callout-section" aria-label="Got a different event in mind">
        <div className="ac-callout-card">
          <div>
            <span className="ac-page-hero-eyebrow">{"// ANYTHING ELSE?"}</span>
            <div className="ac-callout-title">
              <span className="ac-display">Got a different event in mind?</span>
            </div>
            <p className="ac-callout-body">
              The floor is adaptable to many formats beyond the disciplines listed here. Tell the
              bookings desk what you have planned and we&apos;ll work out the setup with you.
            </p>
          </div>
          <Link className="ac-btn-primary ac-callout-cta" href="/contact">
            Talk to the desk <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </>
  );
}
