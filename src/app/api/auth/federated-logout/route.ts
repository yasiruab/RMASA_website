import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

let cachedLogoutEndpoint: string | null = null;

async function getCognitoLogoutEndpoint(): Promise<string | null> {
  if (cachedLogoutEndpoint) return cachedLogoutEndpoint;
  const issuer = process.env.COGNITO_ISSUER;
  if (!issuer) return null;
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const config = (await res.json()) as { end_session_endpoint?: string };
    cachedLogoutEndpoint = config.end_session_endpoint ?? null;
    return cachedLogoutEndpoint;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const clientId = process.env.COGNITO_CLIENT_ID;
  const logoutEndpoint = await getCognitoLogoutEndpoint();

  // Behind Amplify's reverse proxy, req.url reflects the internal Node
  // host (localhost:3000), not the public domain. Use NEXTAUTH_URL as
  // the authoritative public origin instead.
  const publicOrigin = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  // If Cognito logout endpoint isn't reachable, fall back to local sign-in.
  // The NextAuth session cookie is already cleared by the caller before
  // hitting this route, so the user is at minimum signed out of the app.
  if (!clientId || !logoutEndpoint) {
    return NextResponse.redirect(`${publicOrigin}/admin/login`);
  }

  const logoutUri = `${publicOrigin}/admin/login`;
  const cognitoLogoutUrl =
    `${logoutEndpoint}` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&logout_uri=${encodeURIComponent(logoutUri)}`;

  return NextResponse.redirect(cognitoLogoutUrl);
}
