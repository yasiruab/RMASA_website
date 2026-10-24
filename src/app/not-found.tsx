import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

// Replaces Next's default "404 | This page could not be found." screen, which
// had no way back into the site.
export default function NotFound() {
  return (
    <section aria-label="Page not found" className="ac-page-hero is-gradient ac-not-found">
      <div className="ac-page-hero-inner">
        <span className="ac-page-hero-eyebrow">{"// ERROR 404"}</span>
        <h1 className="ac-page-hero-title">
          <span className="ac-display">
            OUT OF BOUNDS<span className="punct">.</span>
          </span>
        </h1>
        <div className="ac-page-hero-italic">
          <span className="ac-italic">this page isn’t on the floor plan.</span>
        </div>
        <p className="ac-page-hero-lede">
          The link may be old or mistyped. Try the bookings calendar or head back to the home page.
        </p>
        <div className="ac-not-found-ctas">
          <Link className="ac-btn-primary" href="/bookings">
            Open the calendar <span aria-hidden="true">↗</span>
          </Link>
          <Link className="ac-btn-ghost" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
