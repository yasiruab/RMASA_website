import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <h2>Royal MAS Arena</h2>
          <p>Sports Complex, Panagoda, Sri Lanka</p>
          <p>Website Phase 1 completed. Calendar automation is planned next.</p>
        </div>
        <div>
          <h2>Quick Links</h2>
          <ul className="footer-links">
            <li>
              <Link href="/facilities">Facilities</Link>
            </li>
            <li>
              <Link href="/activities">Activities</Link>
            </li>
            <li>
              <Link href="/bookings">Bookings</Link>
            </li>
            <li>
              <Link href="/contact">Contact</Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
