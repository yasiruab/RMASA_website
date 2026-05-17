"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/facilities", label: "Facilities" },
  { href: "/activities", label: "Activities" },
  { href: "/events", label: "Events" },
  { href: "/bookings", label: "Bookings" },
  { href: "/contact", label: "Contact" },
  { href: "/admin/calendar", label: "Admin" },
];

function isLinkActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !menuRef.current) return;

      const focusable = menuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="site-header" id="masthead">
      <div className="ac-live-strip">
        <div className="ac-live-strip-left">
          <span className="ac-live-flag">
            <span className="ac-live-dot" aria-hidden="true" />
            <span className="live-label">LIVE</span>
            <span>BOOKINGS DESK · OPEN 08:00–18:00</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>RAJAKEEYA MAWATHA · COLOMBO 07</span>
        </div>
        <div className="ac-live-strip-right">
          <a href="tel:+94704421590">+94 (0) 70 442 1590</a>
          <a href="mailto:info@royalmasarena.lk">INFO@ROYALMASARENA.LK</a>
          <span className="ac-lang" aria-hidden="true">EN ▾</span>
        </div>
      </div>

      <div className="ac-nav-strip">
        <Link aria-label="Royal MAS Arena home" className="ac-logo-plaque" href="/">
          <Image
            alt="Royal MAS Arena"
            height={60}
            priority
            sizes="120px"
            src="/rmasa/logo.png"
            width={200}
          />
        </Link>

        <nav aria-label="Main navigation" className="ac-nav">
          {NAV_LINKS.map((link) => {
            const active = isLinkActive(pathname, link.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "active" : undefined}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <Link className="ac-header-cta" href="/bookings">
          Book Now <span aria-hidden="true">↗</span>
        </Link>

        <button
          aria-controls="mobile-menu"
          aria-expanded={menuOpen}
          className="ac-menu-toggle"
          onClick={() => setMenuOpen((current) => !current)}
          ref={toggleRef}
          type="button"
        >
          Menu
        </button>
      </div>

      <div
        aria-hidden={!menuOpen}
        className={`ac-mobile-menu ${menuOpen ? "is-open" : ""}`}
        id="mobile-menu"
        ref={menuRef}
      >
        <p className="ac-mobile-menu-title">Explore</p>
        <ul className="ac-mobile-menu-list">
          {NAV_LINKS.map((link) => {
            const active = isLinkActive(pathname, link.href);
            return (
              <li key={link.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "active" : undefined}
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="ac-mobile-menu-title">Reservations</p>
        <ul className="ac-mobile-menu-list">
          <li>
            <Link className="active" href="/bookings">
              Book Now ↗
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
