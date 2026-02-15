"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <header className="site-header" id="masthead">
      <div className="container header-row">
        <Link aria-label="Royal MAS Arena home" className="logo-link" href="/">
          <Image alt="Royal Mas Arena" className="logo" height={64} priority src="/rmasa/logo.png" unoptimized width={599} />
        </Link>

        <div className="header-contact">
          <p>
            Phone: <a href="tel:+94704421590">+94 (0) 70 442 1590</a>
          </p>
          <p>
            E-Mail: <a href="mailto:info@royalmasarena.lk">info@royalmasarena.lk</a>
          </p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="site-nav">
        <div className="container">
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
        </div>
      </nav>
    </header>
  );
}
