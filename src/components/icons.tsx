import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

/* ─── Contact channels ─────────────────────────────────────────── */

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 1-2z" />
    </svg>
  );
}

export function EnvelopeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 6l9 7 9-7" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h-2a3 3 0 0 0-3 3v3H6v3h3v8h3v-8h2.5l.5-3H12V7a1 1 0 0 1 1-1h1.5V4z" />
    </svg>
  );
}

export function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20l1.4-4A8 8 0 1 1 8 19.5L4 20z" />
      <path d="M9 9.5c.4 1.4 1.6 3 3 3.7 1.1.5 1.6.4 2-.1l.5-.6a.6.6 0 0 1 .8-.1l1.4.8a.6.6 0 0 1 .2.8 2.5 2.5 0 0 1-2.4 1.4 7 7 0 0 1-6.7-6.7 2.5 2.5 0 0 1 1.4-2.4.6.6 0 0 1 .8.2l.8 1.4a.6.6 0 0 1-.1.8l-.6.5c-.5.4-.6.9-.1 2z" />
    </svg>
  );
}

/* ─── Activities ───────────────────────────────────────────────── */

export function BoxingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 11V8a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2.5l-1 4h-4l-1-4A3 3 0 0 1 7 11z" />
      <path d="M15 8h2" />
    </svg>
  );
}

export function WrestlingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M6 12c1 2 2 3 4 3h4c2 0 3-1 4-3" />
      <path d="M8 15v5M16 15v5M10 18h4" />
    </svg>
  );
}

export function KarateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="5" r="2" />
      <path d="M10 7v5l5-1" />
      <path d="M10 12l-3 5M10 12l3 8" />
    </svg>
  );
}

export function WushuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l16 16" />
      <path d="M20 4l-16 16" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function FencingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20l14-14" />
      <path d="M6 18l-2 2 2 2" />
      <path d="M18 6l2-2-2-2" />
      <path d="M17 5l2 2" />
    </svg>
  );
}

export function GrapplingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="12" r="4" />
      <circle cx="15" cy="12" r="4" />
    </svg>
  );
}

export function GymnasticsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h16" />
      <path d="M8 5v3a4 4 0 0 0 8 0V5" />
      <circle cx="12" cy="14" r="1.5" />
      <path d="M12 15.5L9 21M12 15.5L15 21" />
    </svg>
  );
}

export function BadmintonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 14l6-6" />
      <path d="M8 16l-3 3" />
      <path d="M14 8l1 3 3 1" />
      <path d="M11 11l-1 3 3-1" />
      <path d="M13 9l-1 3 3-1" />
    </svg>
  );
}

export function SeminarsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="9" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
      <path d="M9 21h6" />
    </svg>
  );
}

export function MeetingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="12" rx="8" ry="4" />
      <circle cx="6" cy="9" r="1.5" />
      <circle cx="12" cy="7" r="1.5" />
      <circle cx="18" cy="9" r="1.5" />
      <circle cx="9" cy="16" r="1.5" />
      <circle cx="15" cy="16" r="1.5" />
    </svg>
  );
}

export function PerformingArtsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5c0 6 3 11 7 11s7-5 7-11z" />
      <circle cx="9" cy="9" r="0.6" fill="currentColor" />
      <circle cx="15" cy="9" r="0.6" fill="currentColor" />
      <path d="M9.5 13c1 1 4 1 5 0" />
    </svg>
  );
}
