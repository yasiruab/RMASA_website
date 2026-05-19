import Link from "next/link";

export type AdminBreadcrumbTrailItem = {
  label: string;
  href?: string;
};

type Props = {
  trail: AdminBreadcrumbTrailItem[];
};

// Geist Mono breadcrumb strip per the admin redesign mockup. Renders directly
// inside the page body — the public Nav already supplies the top live-strip +
// logo-nav-strip chrome. Trail items with `href` are gold links; the last
// (current) item is plain `--ac-text`.
export function AdminBreadcrumbs({ trail }: Props) {
  return (
    <nav aria-label="Breadcrumb" className="admin-breadcrumbs">
      <ol>
        {trail.map((item, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <li key={`${item.label}-${idx}`}>
              {item.href && !isLast ? (
                <Link className="admin-breadcrumbs-link" href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <span className="admin-breadcrumbs-current">{item.label}</span>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="admin-breadcrumbs-sep">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
