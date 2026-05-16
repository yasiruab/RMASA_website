import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY DIAGNOSTIC ENDPOINT. Delete after Cognito env-var pickup
// is verified in production. Returns only safe metadata (booleans,
// lengths, and the public issuer URL). No secret values are exposed.
export async function GET() {
  return NextResponse.json({
    runtime: process.env.NEXT_RUNTIME ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    cognitoIssuer: process.env.COGNITO_ISSUER || null,
    hasCognitoClientId: Boolean(process.env.COGNITO_CLIENT_ID),
    cognitoClientIdLength: (process.env.COGNITO_CLIENT_ID ?? "").length,
    hasCognitoClientSecret: Boolean(process.env.COGNITO_CLIENT_SECRET),
    cognitoClientSecretLength: (process.env.COGNITO_CLIENT_SECRET ?? "").length,
    hasNextAuthSecret: Boolean(process.env.NEXTAUTH_SECRET),
    nextAuthUrl: process.env.NEXTAUTH_URL || null,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    instrumentation: globalThis.__instrumentationState ?? null,
  });
}
