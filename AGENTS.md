# Repository Guidelines

## Project Structure & Module Organization

This is a strict-TypeScript Next.js 15 application. Routes and API handlers live in `src/app/`; React components are in `src/components/`. Put calculations in `src/lib/engine/`, market adapters in `src/lib/market/`, unit tests in `src/test/`, and browser tests in `e2e/`. Prisma schemas, migrations, RLS policy, and seeds live in `prisma/`; operational utilities are under `scripts/`.

The transaction ledger is the source of truth. Derive positions, snapshots, and performance by replaying transactions rather than introducing mutable balance records.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies and generates the Prisma client.
- `npm run db:migrate` updates the local SQLite database.
- `npm run db:init` creates an empty workspace; `npm run db:seed` replaces it with demo data.
- `npm run dev` starts the development server at `http://localhost:3000`.
- `npm test` runs Vitest once.
- `npm run build` builds production output and checks TypeScript.
- `npm run test:e2e` runs Playwright on port 3200; build and seed first.

Do not run development, production, and E2E servers concurrently because they share `.next`.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Use `PascalCase` for components and types, `camelCase` for functions and variables, and kebab-case filenames such as `valuation-toggle.tsx`. Prefer `@/` imports from `src/`. Keep engine modules deterministic; validate external inputs with Zod. No formatter or linter is configured, so match surrounding code and run the build.

## Testing Guidelines

Vitest discovers `src/test/**/*.test.ts`; use descriptive, behavior-oriented names. Playwright specs use `e2e/*.spec.ts` for routes and workflows. There is no fixed coverage threshold, but behavioral changes should cover success paths and important edge cases. For UI or API changes, run `npm test` and `npm run build && npm run test:e2e`.

## Commit & Pull Request Guidelines

History uses Conventional Commit prefixes, currently `feat:`, followed by a concise description. Continue with forms such as `fix: preserve cash settlement on reversal`. Keep commits narrowly scoped. Pull requests should explain user and data-model impact, link issues, list verification commands, and include screenshots for visual changes. Call out migrations, environment variables, and backup considerations.

## Security & Configuration

Never commit database files, backups, API keys, or connection strings. Pass configuration such as `DATABASE_URL`, `MARKET_PROVIDER`, and `OPENAI_API_KEY` through the environment. Preserve family scoping, authorization checks, and audit-chain behavior when changing data access.
