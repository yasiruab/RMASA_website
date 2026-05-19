import { NextResponse } from "next/server";

type ContactPayload = {
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  consent?: boolean;
};

function isEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value);
}

// Length and format caps — same shape as the booking endpoint. Phone allows only
// digits and '+', capped at 16 characters.
const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 254;
const MAX_PHONE_LEN = 16;
const MAX_MESSAGE_LEN = 1000;
const PHONE_PATTERN = /^[0-9+]{1,16}$/;

export async function POST(req: Request) {
  let payload: ContactPayload;

  try {
    payload = (await req.json()) as ContactPayload;
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const name = String(payload.name ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const consent = Boolean(payload.consent);

  if (!name || !phone || !email || !message || !consent) {
    return NextResponse.json(
      { message: "Please complete all fields and provide privacy consent." },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json({ message: `Name must be ${MAX_NAME_LEN} characters or fewer.` }, { status: 400 });
  }
  if (email.length > MAX_EMAIL_LEN) {
    return NextResponse.json({ message: `Email must be ${MAX_EMAIL_LEN} characters or fewer.` }, { status: 400 });
  }
  if (!PHONE_PATTERN.test(phone) || phone.length > MAX_PHONE_LEN) {
    return NextResponse.json(
      { message: `Phone must be ${MAX_PHONE_LEN} characters or fewer and contain only digits and '+'.` },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ message: `Message must be ${MAX_MESSAGE_LEN} characters or fewer.` }, { status: 400 });
  }

  if (!isEmail(email)) {
    return NextResponse.json({ message: "Please provide a valid email address." }, { status: 400 });
  }

  const webhookUrl = process.env.CONTACT_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("[contact-enquiry]", { name, phone, email, message, consent, receivedAt: new Date().toISOString() });
    return NextResponse.json({ message: "Enquiry captured in development mode." }, { status: 200 });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "rmasa-website",
        name,
        phone,
        email,
        message,
        consent,
        receivedAt: new Date().toISOString(),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ message: "Enquiry service is unavailable." }, { status: 502 });
    }

    return NextResponse.json({ message: "Enquiry sent successfully." }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Failed to send enquiry." }, { status: 502 });
  }
}
