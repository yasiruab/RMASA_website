const AMPLIFY_APP_ID = "d8k1nfzx3tpc7";
const AMPLIFY_BRANCH = "main";
const AWS_REGION = "ap-southeast-1";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DATABASE_URL && process.env.NEXTAUTH_SECRET) return;

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

    let loaded = 0;
    for (const param of result.Parameters ?? []) {
      if (!param.Name || param.Value === undefined) continue;
      const key = param.Name.replace(prefix, "");
      if (key && !process.env[key]) {
        process.env[key] = param.Value;
        loaded += 1;
      }
    }

    console.log(`[instrumentation] Loaded ${loaded} SSM params`);
  } catch (err) {
    console.error("[instrumentation] Failed to load SSM params:", err);
  }
}
