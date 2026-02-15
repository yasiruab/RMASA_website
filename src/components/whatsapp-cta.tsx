import Link from "next/link";
import { buildWhatsAppUrl, contactConfig } from "@/config/contact";

type WhatsAppCtaProps = {
  className?: string;
  message?: string;
};

export function WhatsAppCta({ className, message }: WhatsAppCtaProps) {
  if (!contactConfig.whatsapp.enabled) {
    return null;
  }

  return (
    <Link
      aria-label="Chat on WhatsApp"
      className={className ?? "whatsapp-cta"}
      href={buildWhatsAppUrl(message)}
      rel="noopener noreferrer"
      target="_blank"
    >
      WhatsApp Enquiry
    </Link>
  );
}
