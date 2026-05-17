"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Slide = {
  src: string;
  eyebrow: string;
  title: string;
  italic: string;
  sub: string;
};

const SLIDES: Slide[] = [
  {
    src: "/rmasa/slider-1.jpg",
    eyebrow: "TOURNAMENT-GRADE",
    title: "The arena,",
    italic: "made for you.",
    sub: "Boxing, wrestling, gymnastics, fencing — built for crowds of 1,000.",
  },
  {
    src: "/rmasa/slider-2.jpg",
    eyebrow: "WORLD-CLASS",
    title: "A pit for",
    italic: "gymnastics.",
    sub: "Sri Lanka’s first purpose-built indoor gymnastics venue.",
  },
  {
    src: "/rmasa/slider-3.jpg",
    eyebrow: "RETRACTABLE",
    title: "Seating for",
    italic: "one thousand.",
    sub: "Fully retractable, configurable for any event format.",
  },
  {
    src: "/rmasa/slider-4.jpg",
    eyebrow: "TRAINING ROOM",
    title: "A studio,",
    italic: "for rehearsals.",
    sub: "2,000 sqft of air-conditioned, mirrored studio space.",
  },
];

export function HeroSlider() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 5000);
    return () => window.clearInterval(t);
  }, []);

  const current = SLIDES[idx];

  return (
    <section aria-label="Royal MAS Arena highlights" className="ac-hero">
      {SLIDES.map((slide, i) => (
        <div
          aria-hidden={i !== idx}
          className={`ac-hero-slide ${i === idx ? "is-visible" : ""}`}
          key={slide.src}
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(6,17,46,0.25) 0%, rgba(6,17,46,0.95) 95%), url(${slide.src})`,
          }}
        />
      ))}

      <div className="ac-hero-stamp">EST · 2016 · COLOMBO 07</div>

      <div className="ac-hero-overlay">
        <span className="ac-hero-eyebrow">{`// ${current.eyebrow}`}</span>

        <div className="ac-hero-title">
          <span className="ac-display">
            {current.title}
            <span className="punct">.</span>
          </span>
        </div>
        <div className="ac-hero-italic">
          <span className="ac-italic">{current.italic}</span>
        </div>

        <p className="ac-hero-sub">{current.sub}</p>

        <div className="ac-hero-ctas">
          <Link className="ac-btn-primary" href="/bookings">
            Start Booking <span aria-hidden="true">↗</span>
          </Link>
          <Link className="ac-btn-ghost" href="/facilities">
            Explore Facilities
          </Link>
        </div>
      </div>

      <div className="ac-hero-dots">
        <span className="counter">
          {String(idx + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
        </span>
        {SLIDES.map((slide, i) => (
          <button
            aria-current={i === idx ? "true" : undefined}
            aria-label={`Go to slide ${i + 1}`}
            className={i === idx ? "active" : undefined}
            key={`dot-${slide.src}`}
            onClick={() => setIdx(i)}
            type="button"
          />
        ))}
      </div>
    </section>
  );
}
