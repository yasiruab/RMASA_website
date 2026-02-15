"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const slides = [
  "/rmasa/slider-1.jpg",
  "/rmasa/slider-2.jpg",
  "/rmasa/slider-3.jpg",
  "/rmasa/slider-4.jpg",
];

export function HeroSlider() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 4500);

    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="hero-slider" aria-label="Royal MAS Arena highlights">
      <div className="hero-frame container">
        {slides.map((src, i) => (
          <Image
            alt="Royal MAS Arena"
            className={`hero-slide ${i === index ? "is-visible" : ""}`}
            fill
            key={src}
            priority={i === 0}
            sizes="(max-width: 1100px) 94vw, 1100px"
            src={src}
            unoptimized
          />
        ))}
        <div className="hero-controls" aria-hidden="true">
          {slides.map((_, i) => (
            <span className={i === index ? "dot active" : "dot"} key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
