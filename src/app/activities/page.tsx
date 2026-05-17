import { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  BadmintonIcon,
  BoxingIcon,
  FencingIcon,
  GrapplingIcon,
  GymnasticsIcon,
  KarateIcon,
  MeetingsIcon,
  PerformingArtsIcon,
  SeminarsIcon,
  WrestlingIcon,
  WushuIcon,
} from "@/components/icons";

type Activity = {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

type Category = {
  key: string;
  display: string;
  items: Activity[];
};

const CATEGORIES: Category[] = [
  {
    key: "combat",
    display: "combat.",
    items: [
      { label: "Boxing", Icon: BoxingIcon },
      { label: "Wrestling", Icon: WrestlingIcon },
      { label: "Karate", Icon: KarateIcon },
      { label: "Wushu", Icon: WushuIcon },
      { label: "Fencing", Icon: FencingIcon },
      { label: "Any type of grappling sport", Icon: GrapplingIcon },
    ],
  },
  {
    key: "sport",
    display: "sport.",
    items: [
      { label: "Gymnastics", Icon: GymnasticsIcon },
      { label: "Badminton", Icon: BadmintonIcon },
    ],
  },
  {
    key: "gatherings",
    display: "gatherings.",
    items: [
      { label: "Seminars", Icon: SeminarsIcon },
      { label: "Meetings", Icon: MeetingsIcon },
      { label: "Performing arts", Icon: PerformingArtsIcon },
    ],
  },
];

const TOTAL_ACTIVITIES = CATEGORIES.reduce((sum, cat) => sum + cat.items.length, 0);

export default function ActivitiesPage() {
  return (
    <>
      <section
        aria-label="Activities hero"
        className="ac-page-hero"
        style={{ backgroundImage: "url(/rmasa/activities.jpg)" }}
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
          <span className="meta">
            {CATEGORIES.length} CATEGORIES · {TOTAL_ACTIVITIES} USES
          </span>
        </div>

        {CATEGORIES.map((cat) => (
          <div className="ac-discipline-group" key={cat.key}>
            <div className="ac-discipline-group-head">
              <span className="ac-italic ac-discipline-group-name">{cat.display}</span>
              <span className="ac-discipline-group-count">
                {cat.items.length} {cat.items.length === 1 ? "ACTIVITY" : "ACTIVITIES"}
              </span>
            </div>
            <div className="ac-discipline-grid">
              {cat.items.map((item) => {
                const { Icon } = item;
                return (
                  <article className="ac-activity-card" key={item.label}>
                    <div className="ac-activity-tile" aria-hidden="true">
                      <Icon />
                    </div>
                    <div className="ac-activity-body">
                      <span className="ac-display ac-activity-name">{item.label}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
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
