const AMPLIFY_APP_ID = "d8k1nfzx3tpc7";
const AMPLIFY_BRANCH = "main";
const AWS_REGION = "ap-southeast-1";

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
    const { SSMClient, GetParametersByPathCommand } = await import(
      "@aws-sdk/client-ssm"
    );

    const ssm = new SSMClient({
      region: process.env.AWS_REGION ?? AWS_REGION,
    });

    const prefix = `/amplify/${AMPLIFY_APP_ID}/${AMPLIFY_BRANCH}/`;
    const result = await ssm.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        WithDecryption: true,
      })
    );

    const loadedKeys: string[] = [];
    for (const param of result.Parameters ?? []) {
      if (!param.Name || param.Value === undefined) continue;
      const key = param.Name.replace(prefix, "");
      if (key && !process.env[key]) {
        process.env[key] = param.Value;
        loadedKeys.push(key);
      }
    }

    state.ran = true;
    state.paramsLoaded = loadedKeys.length;
    state.paramKeys = loadedKeys;
    console.log(`[instrumentation] Loaded ${loadedKeys.length} SSM params`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    console.error("[instrumentation] Failed to load SSM params:", err);
  } finally {
    state.finishedAt = new Date().toISOString();
  }
}
