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

globalThis.__instrumentationState = {
  ran: false,
  startedAt: null,
  finishedAt: null,
  paramsLoaded: 0,
  paramKeys: [],
  error: null,
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const state = globalThis.__instrumentationState!;
  state.startedAt = new Date().toISOString();

  try {
    // These dot-access references get inlined at build time by Next.js
    // from the `env` config in next.config.ts (values come from Amplify
    // build-time environment variables).
    const inlined: Record<string, string | undefined> = {
      DATABASE_URL: process.env._AMPLIFY_DATABASE_URL,
      NEXTAUTH_SECRET: process.env._AMPLIFY_NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env._AMPLIFY_NEXTAUTH_URL,
    };

    const loadedKeys: string[] = [];
    for (const [key, value] of Object.entries(inlined)) {
      // Dynamic-key access on process.env is NOT inlined, so this reads
      // and writes the real runtime environment.
      if (value && !process.env[key]) {
        process.env[key] = value;
        loadedKeys.push(key);
      }
    }

    state.ran = true;
    state.paramsLoaded = loadedKeys.length;
    state.paramKeys = loadedKeys;
    console.log(`[instrumentation] Populated ${loadedKeys.length} env vars`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    console.error("[instrumentation] Failed:", err);
  } finally {
    state.finishedAt = new Date().toISOString();
  }
}
