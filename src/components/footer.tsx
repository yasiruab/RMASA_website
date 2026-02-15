import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-columns">
        <div>
          <p>
            <a href="https://www.facebook.com/royalmasarena" rel="noopener noreferrer" target="_blank">
              Facebook Page
            </a>
          </p>
          <p>
            <a href="http://www.rcu.lk/" rel="noopener noreferrer" target="_blank">
              Royal College Union
            </a>
          </p>
          <p>
            <Link href="/faq">FAQ</Link>
          </p>
          <p>
            <Link href="/privacy">Privacy Policy</Link>
          </p>
        </div>

        <div>
          <p>
            Address:
            <br />
            Royal MAS Arena,
            <br />
            Rajakeeya Mawatha,
            <br />
            Colombo 007,
            <br />
            Sri Lanka.
          </p>
        </div>

        <div>
          <p>
            Phone:
            <br />
            +94 (0) 70 442 1590
          </p>
          <p>
            E-Mail:
            <br />
            <a href="mailto:info@royalmasarena.lk">info@royalmasarena.lk</a>
          </p>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="container">
          <p>Copyright © 2026 Royal Mas Arena. All rights reserved.</p>
          <p className="footer-meta">Theme recreated in Next.js. Original visual language inspired by RMASA legacy site.</p>
        </div>
      </div>
    </footer>
  );
}
