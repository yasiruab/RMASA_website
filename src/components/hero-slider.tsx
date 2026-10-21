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
    src: "/home-sliders/home-slider-1.webp",
    eyebrow: "TOURNAMENT-GRADE",
    title: "The arena,",
    italic: "made for you.",
    sub: "Boxing, wrestling, gymnastics, fencing — built for crowds of 1,000.",
  },
  {
    src: "/home-sliders/home-slider-2.webp",
    eyebrow: "WORLD-CLASS",
    title: "A pit for",
    italic: "gymnastics.",
    sub: "Sri Lanka’s first purpose-built indoor gymnastics venue.",
  },
  {
    src: "/home-sliders/home-slider-4.webp",
    eyebrow: "RETRACTABLE",
    title: "Seating for",
    italic: "one thousand.",
    sub: "Fully retractable, configurable for any event format.",
  },
  {
    src: "/home-sliders/home-slider-3.webp",
    eyebrow: "TRAINING ROOM",
    title: "A studio,",
    italic: "for rehearsals.",
    sub: "2,000 sqft of air-conditioned, mirrored studio space.",
  },
];

const AUTOPLAY_INTERVAL_MS = 5000;

/**
 * Splits a trailing comma/full stop off a slide title so it can be rendered in
 * the gold accent. Titles without trailing punctuation (e.g. "A pit for") get
 * none — appending a gold "." unconditionally produced "The arena,." on the
 * live site.
 */
function splitTrailingPunct(title: string): { text: string; punct: string } {
  const match = /^(.*?)([,.])$/.exec(title);
  return match ? { text: match[1], punct: match[2] } : { text: title, punct: "" };
}

/** Tracks the OS-level "reduce motion" preference, updating live if it changes. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function HeroSlider() {
  const [idx, setIdx] = useState(0);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  // WCAG 2.2.2: auto-advancing content must be pausable. Autoplay stops while
  // the visitor hovers or tabs into the hero (so the headline doesn't change
  // mid-read), when they press pause, and entirely under reduced motion.
  const isAutoplaying = !pausedByUser && !prefersReducedMotion && !isHovered && !hasFocusWithin;

  useEffect(() => {
    if (!isAutoplaying) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % SLIDES.length),
      AUTOPLAY_INTERVAL_MS
    );
    return () => window.clearInterval(t);
  }, [isAutoplaying]);

  const current = SLIDES[idx];
  const title = splitTrailingPunct(current.title);
  const showPauseControl = !prefersReducedMotion;

  return (
    <section
      aria-label="Royal MAS Arena highlights"
      aria-roledescription="carousel"
      className="ac-hero"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocusWithin(false);
      }}
      onFocus={(e) => {
        // Keyboard focus only: a mouse click on Play also focuses the button,
        // and treating that as "reading" would keep the slideshow paused.
        if (e.target.matches(":focus-visible")) setHasFocusWithin(true);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
            {title.text}
            {title.punct ? <span className="punct">{title.punct}</span> : null}
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
        {showPauseControl ? (
          <button
            aria-label={pausedByUser ? "Play slideshow" : "Pause slideshow"}
            aria-pressed={pausedByUser}
            className="ac-hero-pause"
            onClick={() => setPausedByUser((p) => !p)}
            type="button"
          >
            <span aria-hidden="true">{pausedByUser ? "▶" : "❚❚"}</span>
          </button>
        ) : null}
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
