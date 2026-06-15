# Contributing

Thanks for contributing to the Bright Data CLI. This is a TypeScript project that
compiles to a Node CLI (`brightdata` / `bdata`).

## Prerequisites

- **Node.js 20+** (CI builds on Node 24 — matching the current LTS avoids surprises).
- **pnpm** — pinned via the `packageManager` field. Let Corepack provide it:
  ```bash
  corepack enable
  ```

## Setup

```bash
pnpm install
pnpm run build           # compile src/ → dist/
node dist/index.js --help   # run your build (or: pnpm start)
```

## Common commands

| Command | What it does |
|---|---|
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm run dev` | Compile in watch mode |
| `pnpm run type-check` | Type-check only, no emit (`tsc --noEmit`) |
| `pnpm test` | Run the test suite once (Vitest) |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm start` | Run the built CLI (`node dist/index.js`) |
| `pnpm run clean` | Remove `dist/` |

## Project layout

```
src/
  index.ts        # entry point / bin (wires up all commands)
  commands/       # one file per CLI command (scrape, search, browser, …)
  browser/        # local browser-daemon: lifecycle, ipc, connection, interaction
  utils/          # shared helpers (client, config, auth, output, polling, …)
  types/          # shared type definitions
  __tests__/      # Vitest tests, mirroring the src/ layout
install.sh        # curl | sh installer
```

## Testing

- Tests live in `src/__tests__/**/*.test.ts`, mirroring the source tree, and run on
  **Vitest** (`pnpm test`). Add a test alongside any behavior change.
- **CI does not run the suite** — `release.yml` only builds and publishes on release
  tags. Please run `pnpm run type-check` **and** `pnpm test` locally before opening a
  PR; that's the only safety net.
- A few browser/daemon tests depend on a real browser environment and may not pass on
  every machine — note in your PR if a failure is pre-existing/environmental rather
  than caused by your change.

## Code style

Match the surrounding file. The house style is:

- **`snake_case`** for functions and variables (`handle_scrape`, `ensure_authenticated`).
- **Allman braces** — opening brace on its own line for blocks:
  ```ts
  if (!zone)
  {
      fail('...');
      return;
  }
  ```
- 4-space indentation, single quotes, arrow functions assigned to `const`, and
  **named exports** grouped at the bottom of the file.
- Keep diffs minimal and consistent with the file you're editing.

## Commits & pull requests

- Use **Conventional Commits**: `feat(scraper): …`, `fix(browser): …`,
  `docs(readme): …`, `refactor: …`, `chore: …`.
- Branch off `main` and open your PR against `main`.
- Before pushing: `pnpm run type-check && pnpm test && pnpm run build` should all pass.
- Keep PRs focused; describe what changed and how you verified it.

## Releases

Maintainers cut releases by bumping the version and pushing a `v*` tag, which triggers
the `release.yml` workflow to build and `npm publish`.
