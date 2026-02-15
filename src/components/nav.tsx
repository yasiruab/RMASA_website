"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/facilities", label: "Facilities" },
  { href: "/activities", label: "Activities" },
  { href: "/bookings", label: "Bookings" },
  { href: "/contact", label: "Contact" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <Link className="brand" href="/">
          Royal MAS Arena
        </Link>
        <nav aria-label="Main navigation">
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
        </nav>
      </div>
    </header>
  );
}
