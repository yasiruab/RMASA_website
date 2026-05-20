"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };

const DESK_OPEN_HOUR = 8;
const DESK_CLOSE_HOUR = 18;

function getColomboMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Colombo",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function getDeskStatus(now: Date): { open: boolean; label: string } {
  const minutes = getColomboMinutes(now);
  const openMins = DESK_OPEN_HOUR * 60;
  const closeMins = DESK_CLOSE_HOUR * 60;
  if (minutes >= openMins && minutes < closeMins) {
    return { open: true, label: `BOOKINGS DESK · OPEN UNTIL ${String(DESK_CLOSE_HOUR).padStart(2, "0")}:00` };
  }
  return { open: false, label: `BOOKINGS DESK · OPENS ${String(DESK_OPEN_HOUR).padStart(2, "0")}:00` };
}

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
  const [deskStatus, setDeskStatus] = useState<{ open: boolean; label: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const update = () => setDeskStatus(getDeskStatus(new Date()));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

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
          <span
            className={`ac-live-flag${deskStatus && !deskStatus.open ? " is-closed" : ""}`}
          >
            <span className="ac-live-dot" aria-hidden="true" />
            <span className="live-label">{deskStatus?.open === false ? "CLOSED" : "LIVE"}</span>
            <span>{deskStatus?.label ?? `BOOKINGS DESK · ${String(DESK_OPEN_HOUR).padStart(2, "0")}:00–${String(DESK_CLOSE_HOUR).padStart(2, "0")}:00`}</span>
          </span>
          <span aria-hidden="true" className="ac-live-strip-bullet">·</span>
          <span className="ac-live-strip-address">RAJAKEEYA MAWATHA · COLOMBO 07</span>
        </div>
        <div className="ac-live-strip-right">
          <a href="tel:+94704421590">+94 (0) 70 442 1590</a>
          <a className="ac-live-strip-email" href="mailto:info@royalmasarena.lk">INFO@ROYALMASARENA.LK</a>
        </div>
      </div>

      <div className="ac-nav-strip">
        <Link aria-label="Royal MAS Arena home" className="ac-logo-plaque" href="/">
          <Image
            alt="Royal MAS Arena"
            height={60}
            priority
            sizes="160px"
            src="/rmasa/royal-mas-arena-logo.png"
            width={158}
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
