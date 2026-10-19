#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-cookie-consent-audit",
  version: pkg.version,
});

// Cookie Consent Audit (immutable actor ID TrKyOS0KBoGC35nbr). Every buyer facing input of the actor
// is exposed. The actor accepts numbers and booleans as strings, so those inputs are strings here too.
server.registerTool(
  "audit_cookie_consent",
  {
    title: "Audit cookie consent",
    description:
      "Audit one or more websites for cookie consent behavior from an EU address. Each domain is loaded in fresh browser sessions: once before any consent click, once after clicking the reject control on the first layer of the banner, and once with Global Privacy Control on. Returns one row per domain: the consent management platform found (TCF __tcfapi, OneTrust, Cookiebot, Usercentrics, Didomi, and others), whether accept and reject controls sit on the first layer, tracking cookies and requests to known tracker hosts before consent and after the reject, Google Consent Mode denied pings, the GPC comparison and /.well-known/gpc.json, a list of signals, and the version of the fixed tracker list used. Signals for review, not legal findings. Cookie values are never returned. A run that does not succeed is returned as an error with its run ID. Read-only on the audited sites; requires an APIFY_TOKEN and consumes Apify credits per audited domain.",
    annotations: {
      title: "Audit cookie consent",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      domain: z.string()
        .optional()
        .describe("The website to audit, for example example.de or https://www.example.de/. The homepage is audited. Give domain or domains."),
      domains: z.array(z.string())
        .optional()
        .describe("More domains or URLs to audit in the same run. Duplicates are skipped. Up to 500 per run."),
      proxy_country: z.enum(["DE", "FR", "NL", "IE", "IT", "ES", "SE", "PL", "AT", "BE", "DK", "FI", "none"])
        .optional()
        .describe("The EU country the browser connects from. Consent banners change by visitor region. none connects without a proxy, which is not an EU vantage point. Default DE."),
      check_gpc: z.enum(["true", "false"])
        .optional()
        .describe("Load the site once more with the Global Privacy Control signal on and compare trackers with the plain visit; also reads /.well-known/gpc.json. Default true."),
      max_charge_usd: z.string()
        .optional()
        .describe("Optional. Stop the run before the audit charges would pass this amount."),
      skip_cache: z.enum(["true", "false"])
        .optional()
        .describe("A domain audited in the last 24 hours with the same settings is returned from cache at no charge. true audits it again. Default false."),
    },
  },
  async (args) => runActor("TrKyOS0KBoGC35nbr", "Cookie Consent Audit", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
