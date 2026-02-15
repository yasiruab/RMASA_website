export const contactConfig = {
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
