import Image from "next/image";
import Link from "next/link";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "VISIT",
    links: [
      { label: "Facilities tour", href: "/facilities" },
      { label: "Activities", href: "/activities" },
      { label: "Events", href: "/events" },
      { label: "Directions", href: "/contact" },
    ],
  },
  {
    heading: "BOOKING",
    links: [
      { label: "New reservation", href: "/bookings" },
      { label: "About the arena", href: "/about" },
      { label: "Pricing & rates", href: "/bookings" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    heading: "OFFICE",
    links: [
      { label: "Contact desk", href: "/contact" },
      { label: "Admin sign-in", href: "/admin/calendar" },
      { label: "Royal College Union", href: "http://www.rcu.lk/", external: true },
      { label: "Privacy policy", href: "/privacy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="ac-footer">
      <div className="ac-footer-top">
        <div className="ac-footer-brand">
          <Link aria-label="Royal MAS Arena home" className="ac-logo-plaque" href="/">
            <Image
              alt="Royal MAS Arena"
              height={60}
              sizes="120px"
              src="/rmasa/logo.png"
              width={200}
            />
          </Link>
          <p>
            A state-of-the-art, purpose-built indoor sports facility on Rajakeeya Mawatha,
            Colombo 07. Managed by the Royal College Union.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div className="ac-footer-col" key={column.heading}>
            <p className="ac-footer-col-heading">{column.heading}</p>
            <ul>
              {column.links.map((link) =>
                link.external ? (
                  <li key={`${column.heading}-${link.label}`}>
                    <a href={link.href} rel="noopener noreferrer" target="_blank">
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="ac-footer-meta-row">
        <div>
          <p className="ac-footer-col-heading">ADDRESS</p>
          <p className="ac-footer-address">
            Royal MAS Arena,
            <br />
            Rajakeeya Mawatha,
            <br />
            Colombo 007, Sri Lanka.
          </p>
        </div>
        <div className="ac-footer-contact">
          <p className="ac-footer-col-heading">CONTACT</p>
          <p>+94 (0) 70 442 1590</p>
          <p>info@royalmasarena.lk</p>
        </div>
        <div>
          <p className="ac-footer-col-heading">SOCIAL</p>
          <ul>
            <li>
              <a
                href="https://www.facebook.com/royalmasarena"
                rel="noopener noreferrer"
                target="_blank"
              >
                Facebook
              </a>
            </li>
            <li>
              <a
                href="https://www.instagram.com/"
                rel="noopener noreferrer"
                target="_blank"
              >
                Instagram
              </a>
            </li>
          </ul>
        </div>
      </div>

      <hr className="ac-footer-divider" />

      <div className="ac-footer-bottom">
        <span>© 2026 · ROYAL MAS ARENA · ALL RIGHTS RESERVED</span>
        <span>ARENA COURT EDITION · MMXXVI</span>
      </div>
    </footer>
  );
}
