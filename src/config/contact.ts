export const contactConfig = {
  // Single source for the bookings-desk number. International format without
  // the "(0)" trunk prefix so what people read is exactly what dials.
  desk: {
    phoneDisplay: "+94 70 442 1590",
    phoneHref: "tel:+94704421590",
  },
  whatsapp: {
    enabled: true,
    phoneE164: "+94704421590",
    defaultMessage: "Hi Royal MAS Arena, I would like to enquire about venue bookings.",
  },
} as const;

export function buildWhatsAppUrl(message?: string) {
  const phone = contactConfig.whatsapp.phoneE164.replace(/\D/g, "");
  const text = message?.trim() || contactConfig.whatsapp.defaultMessage;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
