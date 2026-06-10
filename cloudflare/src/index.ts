import { Container } from "@cloudflare/containers";

interface Env {
  CADENCE: DurableObjectNamespace<Cadence>;
  JIRA_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  CADENCE_AUTH_USER: string;
  CADENCE_AUTH_PASSWORD: string;
  R2_ENDPOINT: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
}

export class Cadence extends Container {
  defaultPort = 8000;
  sleepAfter = "2h";
  enableInternet = true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = env.CADENCE.getByName("singleton");
    await container.startAndWaitForPorts({
      startOptions: {
        envVars: {
          JIRA_URL: env.JIRA_URL,
          JIRA_EMAIL: env.JIRA_EMAIL,
          JIRA_API_TOKEN: env.JIRA_API_TOKEN,
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
          OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
          CADENCE_AUTH_USER: env.CADENCE_AUTH_USER ?? "",
          CADENCE_AUTH_PASSWORD: env.CADENCE_AUTH_PASSWORD ?? "",
          R2_ENDPOINT: env.R2_ENDPOINT ?? "",
          R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
          R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: env.R2_BUCKET_NAME,
        },
      },
    });
    return container.fetch(request);
  },
};
