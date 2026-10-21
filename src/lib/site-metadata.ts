import type { Metadata } from "next";

export const SITE_NAME = "Royal MAS Arena";

export const SITE_DESCRIPTION =
  "Indoor sports and event venue at Rajakeeya Mawatha, Colombo 07. Book the Main Arena or Studio Room online for tournaments, training, seminars and performances.";

const OG_IMAGE = {
  url: "/og/royal-mas-arena.jpg",
  width: 1200,
  height: 630,
  alt: "Royal MAS Arena main hall with retractable blue seating",
};

/**
 * Absolute origin used to resolve Open Graph image URLs. Share previews
 * (WhatsApp, Facebook) need absolute URLs; without a base Next.js falls back to
 * localhost. NEXTAUTH_URL is the public origin and is present at build time on
 * Amplify, which is when static page metadata is rendered.
 */
export function siteUrl(): URL {
  const fallback = "http://localhost:3000";
  try {
    return new URL(process.env.NEXTAUTH_URL || fallback);
  } catch {
    // A malformed env value must not take down every page's render.
    return new URL(fallback);
  }
}

/**
 * Per-page metadata. Next.js replaces (does not merge) a parent's `openGraph`
 * object when a page sets its own, so every page re-declares the share image
 * through this helper.
 */
export function pageMetadata(params: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: params.title,
    description: params.description,
    alternates: { canonical: params.path },
    openGraph: {
      title: `${params.title} · ${SITE_NAME}`,
      description: params.description,
      url: params.path,
      siteName: SITE_NAME,
      type: "website",
      images: [OG_IMAGE],
    },
  };
}

/** Root-layout defaults; pages override title/description via `pageMetadata`. */
export const rootMetadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: `${SITE_NAME} — Indoor Sports & Event Venue, Colombo 07`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image" },
};
