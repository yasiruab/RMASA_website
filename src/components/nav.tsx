import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/facilities", label: "Facilities" },
  { href: "/activities", label: "Activities" },
  { href: "/bookings", label: "Bookings" },
  { href: "/contact", label: "Contact" },
];

export function Nav() {
  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <Link className="brand" href="/">
          Royal MAS Arena
        </Link>
        <nav>
          <ul className="nav-list">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
