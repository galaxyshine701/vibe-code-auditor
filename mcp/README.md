# vca MCP server

A small MCP server for Vibe Code Auditor. It lets Claude Code start an audit, read the report, re-test and ask for the result record. It calls the audit API (Railway or local) over HTTP and does not import the backend.

The result covers table data access only: read, update and delete as another signed-in user, and read as a visitor. It is not a statement that an app is secure.

## Tools

| Tool | Input | What it does |
|---|---|---|
| `start_audit` | `label?` | Starts an audit of the configured test project |
| `get_audit` | `id`, `waitSeconds?` (0 to 30) | Status, progress, counts, cleanup |
| `get_report` | `id` | Findings in English, suggested fix SQL, what the checks cover |
| `request_retest` | `id` | Runs the same checks again |
| `get_certificate` | `id` | The result record, or why none can be issued yet |

There is no tool to approve a fix. That stays a human decision.

## Keys never go through the model

The model can pass only an audit id, a label and a wait time. Every input schema is strict, so a key, an address, an access code or `confirmTestProject` in a tool call is rejected. Keys and addresses are read from environment variables when the server starts. Every result and every error text has those values replaced with `[REDACTED]` before it leaves the server. Logs go to stderr, never to stdout.

## Settings (`mcp/.env`)

1. Copy `mcp/.env.example` to `mcp/.env` and fill it in. `mcp/.env` is git-ignored. Do not paste its values into the chat.
2. Put **only the keys of a throwaway test project** in `mcp/.env`. Never keys of a real or production project.
3. Use a long random access code (at least 8 characters, better 24 or more). The server warns on stderr if `VCA_ACCESS_CODE` is shorter than 8 characters. The warning never prints the value.

| Variable | Meaning |
|---|---|
| `VCA_API_URL` | Address of the audit API (Railway, or `http://localhost:4000`) |
| `VCA_ACCESS_CODE` | The API's access code |
| `SUPABASE_URL` | The test project's address |
| `SUPABASE_PUBLISHABLE_KEY` | The test project's publishable key |
| `SUPABASE_SECRET_KEY` | The test project's secret key |
| `VCA_CONFIRM_TEST_PROJECT` | Set to `yes` only for a test project. Without it `start_audit` and `request_retest` refuse |

If `mcp/.env` is missing, or a variable is missing, the server stops with a message that names the file or the variable. It never prints a value.

## Run it from Claude Code

You need Node 22.9.0 or newer. The server is started with `--env-file-if-exists`, which was added in Node 22.9.0 (checked in the Node docs). From Node 24.10.0 it is no longer marked experimental.

```
cd mcp
npm install
npm run build
```

The repo root has a `.mcp.json` that starts the server with `mcp/.env`. Open Claude Code in the repo root, approve the `vca` server when it asks, then check `/mcp`: `vca` should be listed with five tools. The skill in `.claude/skills/vibe-code-auditor/SKILL.md` tells Claude when to use the tools and how to word results.

## Tests

```
cd mcp
npm test
```

`npm test` builds first. The tests use a fake `fetch`, so they need no network, no real keys and no Supabase project. They cover the request each tool sends, strict inputs, the refusal without `VCA_CONFIRM_TEST_PROJECT=yes`, redaction of seeded fake keys, the error messages, and starting the built server with a missing `mcp/.env`.

Not covered by tests: `/mcp` in a real Claude Code, a real Railway server, and a real Supabase project.
