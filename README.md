# Cookie Consent Audit MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-cookie-consent-audit)](https://smithery.ai/servers/mambabuilt/mcp-cookie-consent-audit) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-cookie-consent-audit/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-cookie-consent-audit) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-cookie-consent-audit%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-cookie-consent-audit&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-cookie-consent-audit)](https://www.npmjs.com/package/@mambalabsdev/mcp-cookie-consent-audit) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-cookie-consent-audit)](https://www.npmjs.com/package/@mambalabsdev/mcp-cookie-consent-audit) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-cookie-consent-audit)](https://github.com/mambalabsdev/mcp-cookie-consent-audit/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-cookie-consent-audit)

An MCP server for the Mamba Labs Cookie Consent Audit actor on Apify. Send a domain or a list of domains. Each one is loaded from an EU address in fresh browser sessions, and you get back one row of consent signals per domain: the consent platform, reject on the first layer, trackers and tracking cookies before consent and after a reject, and the Global Privacy Control response.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Your keys](#your-keys)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Audit one or more websites for cookie consent behavior from an EU address. Each domain is loaded in fresh browser sessions: once before any consent click, once after clicking the reject control on the first layer of the banner, and once with Global Privacy Control on. Returns one row per domain: the consent management platform found (TCF __tcfapi, OneTrust, Cookiebot, Usercentrics, Didomi, and others), whether accept and reject controls sit on the first layer, tracking cookies and requests to known tracker hosts before consent and after the reject, Google Consent Mode denied pings, the GPC comparison and /.well-known/gpc.json, a list of signals, and the version of the fixed tracker list used. Signals for review, not legal findings. Cookie values are never returned. A run that does not succeed is returned as an error with its run ID. Read-only on the audited sites; requires an APIFY_TOKEN and consumes Apify credits per audited domain.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-cookie-consent-audit": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-cookie-consent-audit"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `audit_cookie_consent` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Audit example.de for cookie consent from Germany and tell me what fires before consent."
- "Check these five client sites from France: is there a reject button on the first layer, and does anything still track after a reject?"

## Tool

`audit_cookie_consent`. One tool. Example arguments:

```json
{
  "domains": ["example.de", "example.fr"],
  "proxy_country": "DE"
}
```

## Inputs

Every buyer facing input of the actor, unchanged. Omitted inputs take the actor's own defaults.

| Input | Type | Required | Description |
|---|---|---|---|
| `domain` | string | no | The website to audit, for example example.de or https://www.example.de/. The homepage is audited. Give domain or domains. |
| `domains` | array | no | More domains or URLs to audit in the same run. Duplicates are skipped. Up to 500 per run. |
| `proxy_country` | string | no | The EU country the browser connects from: DE, FR, NL, IE, IT, ES, SE, PL, AT, BE, DK, FI, or none. Default DE. none is not an EU vantage point. |
| `check_gpc` | string | no | Also run the Global Privacy Control session and read /.well-known/gpc.json. Default true. |
| `max_charge_usd` | string | no | Optional. Stop the run before the audit charges would pass this amount. |
| `skip_cache` | string | no | A domain audited in the last 24 hours with the same settings comes back from cache at no charge. true audits it again. Default false. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `domain-audited`, per fully audited domain | $0.05 | $0.0475 | $0.045 | $0.0425 |
| `apify-actor-start`, per run start | $0.001 | $0.001 | $0.001 | $0.001 |

Blocked, timed out, partial, cached, and invalid rows are never charged.

## Your keys

The actor needs no provider key. It loads public pages with the page and its banner deciding requests sent through the Apify proxy, and holds no key of its own.

## Full actor documentation

[apify.com/mambalabs/cookie-consent-audit](https://apify.com/mambalabs/cookie-consent-audit)

## License

MIT. See [LICENSE](LICENSE).
