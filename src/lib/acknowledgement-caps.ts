// Per-recipient daily caps on the courtesy emails the anonymous forms send.
// Pure (the counter is injected) so `npm test` can load it.
//
// The contact and booking forms email whatever address is typed in. Without a
// cap, anyone who solves Turnstile can use the venue's sending identity to
// deliver mail to a victim's inbox over and over. A real customer rarely needs
// more than a few acknowledgements a day, so the caps sit comfortably above that.

export type AcknowledgementType = "contact_acknowledgement" | "booking_acknowledgement";

export const ACKNOWLEDGEMENT_DAILY_CAPS: Record<AcknowledgementType, number> = {
  contact_acknowledgement: 3,
  booking_acknowledgement: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Counts emails of `type` already sent to `toEmail` (case-insensitive) since `since`. */
export type CountRecentEmails = (type: AcknowledgementType, toEmail: string, since: Date) => Promise<number>;

/** True when another acknowledgement of this type may go to this address in the rolling 24 h. */
export async function isAcknowledgementAllowed(
  type: AcknowledgementType,
  toEmail: string,
  countRecent: CountRecentEmails,
  now: Date = new Date(),
): Promise<boolean> {
  const sent = await countRecent(type, toEmail.trim().toLowerCase(), new Date(now.getTime() - DAY_MS));
  return sent < ACKNOWLEDGEMENT_DAILY_CAPS[type];
}
