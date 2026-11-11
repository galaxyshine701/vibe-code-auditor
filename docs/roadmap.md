# Roadmap (agreed 10 Nov 2026)

Only 5 days remain before the 15 Nov deadline, so modules are split into three tiers. A module is described as "built" in the documents only if it has a recorded run against the planted flaws; anything else is future work.

Note: the Prover is deliberately plain code, so its proof can be reproduced. The AI agents are the Report agent, the Fix agent and the Orchestrator.

## Tier A: required
1. Data Access Prover (live test).
2. Report agent and Fix agent (LLM API), and an Orchestrator that connects Prover, Report, Fix and Re-test (multi-agent).
3. Human "Approve fix" and Re-test (LEAKED to BLOCKED).
4. Jira ticket for each LEAKED finding (API integration; MCP use is shown here).
5. Frontend, 4 screens (Alishba) on Vercel; backend on Railway.
6. Small benchmark on the planted tables.
7. `SKILL.md`, README, Word document and market research.
8. MCP server (own small server: run_audit, get_findings, create_ticket; demo via Claude Code).

## Tier B: if Tier A works, in this order
1. Secrets Scanner: look for `sb_secret_` or `service_role` in a deployed site's JavaScript.
2. Package Checker: check that packages in `package.json` exist on the npm registry.
3. Sanity rules library (optional; not a course requirement).
4. GitHub Pull Request containing the fix.

## Tier C: future work (document only, do not build)
Deploy Config Checker, Code Quality Reviewer, GitHub Action that runs on every new repo, scheduled re-audits, dashboard, Prompt Planner (Alishba's idea), Firebase and other databases.

## Day plan
- 11 Nov: Prover result on `vca-test-target`; Alishba's Report screen branch.
- 12 Nov: backend on Railway; Report agent.
- 13 Nov: frontend and backend connected; Jira ticket; MCP server (after the Jira ticket); Re-test.
- 14 Nov: first Tier B module if time allows; Word document; demo; check the live URL.
- 15 Nov: submit only, no new work.