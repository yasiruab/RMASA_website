import { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ContactForm } from "@/components/contact-form";
import {
  EnvelopeIcon,
  FacebookIcon,
  PhoneIcon,
  PinIcon,
  WhatsAppIcon,
} from "@/components/icons";

type Channel = {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  sub: string;
  href?: string;
};

const CHANNELS: Channel[] = [
  { Icon: PhoneIcon, label: "Call", value: "+94 (0) 70 442 1590", sub: "Open 08:00–18:00 daily", href: "tel:+94704421590" },
  { Icon: EnvelopeIcon, label: "Email", value: "info@royalmasarena.lk", sub: "Tap to open your mail app", href: "mailto:info@royalmasarena.lk" },
  {
    Icon: PinIcon,
    label: "Address",
    value: "Rajakeeya Mawatha, Colombo 07",
    sub: "Open directions",
    href: "https://maps.google.com/?q=Royal%20MAS%20Arena%20Colombo",
  },
  {
    Icon: FacebookIcon,
    label: "Facebook",
    value: "facebook.com/royalmasarena",
    sub: "Visit page",
    href: "https://www.facebook.com/royalmasarena",
  },
  {
    Icon: WhatsAppIcon,
    label: "WhatsApp",
    value: "Message the desk",
    sub: "Replies within working hours",
    href: "https://wa.me/94704421590",
  },
];

const SPACE_LABELS: Record<string, string> = {
  "main-arena": "Main Arena",
  "studio-room": "Studio Room",
};

type ContactPageProps = {
  searchParams?: Promise<{ space?: string | string[] }>;
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const resolved = searchParams ? await searchParams : undefined;
  const raw = resolved?.space;
  const key = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
  const selectedLabel = SPACE_LABELS[key];
  const prefilledMessage = selectedLabel
    ? `I would like to enquire about booking the ${selectedLabel}.`
    : "";

  return (
    <>
      <section aria-label="Contact hero" className="ac-page-hero is-gradient">
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="Contact" />
          <span className="ac-page-hero-eyebrow">{"// REACH THE DESK"}</span>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              CONTACT<span className="punct">.</span>
            </span>
          </div>
          <div className="ac-page-hero-italic">
            <span className="ac-italic">four ways in.</span>
          </div>
          <p className="ac-page-hero-lede">
            Ready to book directly? <Link href="/bookings">Open the bookings calendar.</Link>{" "}
            Otherwise pick a channel below.
          </p>
          {selectedLabel ? (
            <p className="ac-contact-context">
              Booking context: <strong>{selectedLabel}</strong>. Continue your enquiry below.
            </p>
          ) : null}
        </div>
      </section>

      <section className="ac-channels-section" aria-label="Reach us">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">01 /</span> REACH US.
          </span>
          <span className="meta">DESK OPEN 08:00–18:00 DAILY</span>
        </div>
        <div className="ac-channels-grid">
          <div className="ac-channels-list">
            {CHANNELS.map((channel) => {
              const { Icon } = channel;
              const isExternal = channel.href?.startsWith("http");
              const ChannelInner = (
                <>
                  <div className="ac-channel-code">
                    <Icon />
                  </div>
                  <div>
                    <span className="ac-channel-label">{channel.label}</span>
                    <div className="ac-channel-value">{channel.value}</div>
                    <div className="ac-channel-sub">· {channel.sub}</div>
                  </div>
                  <span className="ac-channel-arrow" aria-hidden="true">
                    ↗
                  </span>
                </>
              );

              if (!channel.href) {
                return (
                  <div className="ac-channel-card" key={channel.label}>
                    {ChannelInner}
                  </div>
                );
              }

              return (
                <a
                  className="ac-channel-card"
                  href={channel.href}
                  key={channel.label}
                  {...(isExternal
                    ? { rel: "noopener noreferrer", target: "_blank" }
                    : {})}
                >
                  {ChannelInner}
                </a>
              );
            })}
          </div>

          <div className="ac-map-panel">
            <span className="ac-page-hero-eyebrow">{"// FIND US"}</span>
            <p className="ac-map-address">
              Royal MAS Arena, Rajakeeya Mawatha, Colombo 007, Sri Lanka.
            </p>
            <div className="ac-map-frame">
              <iframe
                allowFullScreen={false}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps?q=Royal%20MAS%20Arena%20Colombo&output=embed"
                title="Royal MAS Arena map"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="ac-enquiry-section" aria-label="Send an enquiry">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">02 /</span> SEND AN ENQUIRY.
          </span>
          <span className="meta">REPLIES WITHIN 24 HOURS</span>
        </div>
        <div className="ac-enquiry-grid">
          <div className="ac-enquiry-form">
            <ContactForm initialMessage={prefilledMessage} />
          </div>

          <aside className="ac-aside">
            <span className="ac-aside-eyebrow">FOR ASSISTANCE</span>
            <p className="ac-aside-quote ac-aside-quote-sm">
              The desk takes calls between 08:00–18:00 daily.
            </p>
            <p className="ac-aside-phone">+94&nbsp;&nbsp;70&nbsp;&nbsp;442&nbsp;&nbsp;1590</p>
            <a className="ac-aside-link" href="mailto:info@royalmasarena.lk">
              Or email the bookings office →
            </a>

            <div className="ac-aside-block">
              <span className="ac-aside-eyebrow ac-aside-eyebrow-gold">{"// RESPONSE TIME"}</span>
              <div className="ac-aside-stat">
                <span className="ac-display">24h</span>
              </div>
              <p className="ac-aside-note">
                We aim to reply to every enquiry within one working day.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
