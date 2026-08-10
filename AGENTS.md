# Repository Guidelines

## Required Project Context

Before starting a task, read `context/AI_INSTRUCTIONS.md`, then follow the startup order in `context/README.md`. The canonical context and accepted ADRs define shared project knowledge across coding agents. Do not rely on chat history or this file alone, and always inspect task-relevant code before editing.

If a task explicitly changes an accepted decision, document the replacement ADR and update `context/DECISIONS.md`. Current user instructions still define the task; existing uncommitted changes belong to the user and must be preserved.

## Project Structure & Module Organization

This is a strict-TypeScript Next.js 15 application. Routes and API handlers live in `src/app/`; React components are in `src/components/`. Put calculations in `src/lib/engine/`, market adapters in `src/lib/market/`, unit tests in `src/test/`, and browser tests in `e2e/`. Prisma schemas, migrations, RLS policy, and seeds live in `prisma/`; operational utilities are under `scripts/`.

The transaction ledger is the source of truth. Derive positions, snapshots, and performance by replaying transactions rather than introducing mutable balance records.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies and generates the Prisma client.
- Only ever run `prisma generate` against the default `prisma/schema.prisma`. The generated client bakes in the schema's datasource URL; generating from `schema.test.prisma` (which exists only for `db push --skip-generate` in the Vitest global setup) silently repoints the dev app at `test.db`.
- `npm run db:migrate` updates the local SQLite database.
- `npm run db:init` creates an empty workspace (destructive, auto-backups first). Demo data exists only as an E2E fixture (`e2e/seed.ts`); there is no `db:seed` script.
- `npm run dev` starts the development server at `http://localhost:3000`.
- `npm test` runs Vitest once.
- `npm run build` builds production output and checks TypeScript.
- `npm run test:e2e` prepares an isolated seeded SQLite database, builds to `.next-e2e`, and runs Playwright on port 3200.

Development, production, and E2E use `.next-dev`, `.next`, and `.next-e2e` respectively. Keep their configured ports distinct; do not point two processes at the same dist directory. The webpack filesystem cache is disabled in `next.config.ts` (`config.cache = false`) because it repeatedly served stale CSS after edits — do not re-enable without verifying the fix.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Use `PascalCase` for components and types, `camelCase` for functions and variables, and kebab-case filenames such as `valuation-toggle.tsx`. Prefer `@/` imports from `src/`. Keep engine modules deterministic; validate external inputs with Zod. No formatter or linter is configured, so match surrounding code and run the build.

## Testing Guidelines

Vitest discovers `src/test/**/*.test.ts`; use descriptive, behavior-oriented names. Playwright specs use `e2e/*.spec.ts` for routes and workflows. There is no fixed coverage threshold, but behavioral changes should cover success paths and important edge cases. For UI or API changes, run `npm test`, `npm run build`, and `npm run test:e2e`.

## Commit & Pull Request Guidelines

History uses Conventional Commit prefixes, currently `feat:`, followed by a concise description. Continue with forms such as `fix: preserve cash settlement on reversal`. Keep commits narrowly scoped. Pull requests should explain user and data-model impact, link issues, list verification commands, and include screenshots for visual changes. Call out migrations, environment variables, and backup considerations.

## Security & Configuration

Never commit database files, backups, API keys, or connection strings. Pass configuration such as `DATABASE_URL`, `MARKET_PROVIDER`, and `BRAND_NAME` through the environment. Preserve family scoping, authorization checks, and audit-chain behavior when changing data access.
