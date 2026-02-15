"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/facilities", label: "Facilities" },
  { href: "/activities", label: "Activities" },
  { href: "/events", label: "Events" },
  { href: "/bookings", label: "Bookings" },
  { href: "/contact", label: "Contact" },
];

export function Nav() {
  const pathname = usePathname();
  const [isCompact, setIsCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => {
      setIsCompact(window.scrollY > 72);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    <header className={`site-header ${isCompact ? "is-compact" : ""}`} id="masthead">
      <div className="container header-row">
        <Link aria-label="Royal MAS Arena home" className="logo-link" href="/">
          <Image alt="Royal Mas Arena" className="logo" height={64} priority src="/rmasa/logo.png" unoptimized width={599} />
        </Link>

        <div className="header-right">
          <div className="header-contact">
            <p>
              Phone: <a href="tel:+94704421590">+94 (0) 70 442 1590</a>
            </p>
            <p>
              E-Mail: <a href="mailto:info@royalmasarena.lk">info@royalmasarena.lk</a>
            </p>
          </div>
          <Link className="header-cta" href="/bookings">
            Book Now
          </Link>
          <button
            aria-controls="mobile-menu"
            aria-expanded={menuOpen}
            className="menu-toggle"
            onClick={() => setMenuOpen((current) => !current)}
            ref={toggleRef}
            type="button"
          >
            Menu
          </button>
        </div>
      </div>

      <nav aria-label="Main navigation" className="site-nav">
        <div className="container nav-shell">
          <ul className="nav-list">
            {links.map((link) => {
              const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

              return (
                <li key={link.href}>
                  <Link aria-current={isActive ? "page" : undefined} className={isActive ? "active" : undefined} href={link.href}>
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div aria-hidden={!menuOpen} className={`mobile-menu ${menuOpen ? "is-open" : ""}`} id="mobile-menu" ref={menuRef}>
            <p className="mobile-menu-title">Explore</p>
            <ul className="mobile-menu-list">
              {links.slice(0, 5).map((link) => {
                const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return (
                  <li key={link.href}>
                    <Link aria-current={isActive ? "page" : undefined} className={isActive ? "active" : undefined} href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <p className="mobile-menu-title">Plan Your Visit</p>
            <ul className="mobile-menu-list">
              {links.slice(5).map((link) => {
                const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return (
                  <li key={link.href}>
                    <Link aria-current={isActive ? "page" : undefined} className={isActive ? "active" : undefined} href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Link className="header-cta mobile-cta" href="/bookings">
              Book Now
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
