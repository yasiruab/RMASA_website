import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __instrumentationState:
    | {
        ran: boolean;
        startedAt: string | null;
        finishedAt: string | null;
        paramsLoaded: number;
        paramKeys: string[];
        error: string | null;
      }
    | undefined;
}

export async function GET() {
  return NextResponse.json({
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
    hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    nextAuthUrl: process.env.NEXTAUTH_URL ?? null,
    nodeEnv: process.env.NODE_ENV,
    instrumentation: globalThis.__instrumentationState ?? {
      ran: false,
      note: "instrumentation module never loaded",
    },
  });
}
