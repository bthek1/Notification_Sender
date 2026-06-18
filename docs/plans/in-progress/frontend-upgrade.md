# Plan: Frontend Upgrade — Styling, Forms, State, Testing & Utilities

**Status:** Complete  
**Date:** 2026-03-14  

---

## Goal

Upgrade the frontend stack with production-ready tooling across styling, forms, global state, testing, utilities, and data visualisation. Each phase is independently deliverable so work can be merged incrementally without blocking the running application.

## Background

The current frontend (`frontend/`) is a minimal React 18 + TypeScript + Vite SPA with TanStack Router and TanStack Query for routing and server state. It has no styling system, no form library, no global state solution, no test suite, and no utility belt. This plan brings the stack up to a production baseline.

---

## Phases

### Phase 1 — Styling: Tailwind CSS + shadcn/ui

**Goal:** Establish a consistent design system. All new components use Tailwind utility classes. shadcn/ui components are copied into `src/components/ui/` as needed.

- [x] Install and configure Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- [x] Replace `App.css` / `index.css` base styles with Tailwind's `@import "tailwindcss"` directive
- [x] Install `clsx` and `tailwind-merge`, create `src/lib/utils.ts` with `cn()` helper
- [x] Initialise shadcn/ui (`npx shadcn@latest init`) — select Vite + TypeScript, neutral base colour
- [x] Add path alias `@/` → `src/` in `vite.config.ts` and `tsconfig.app.json` (required by shadcn/ui)
- [x] Install first shadcn/ui components needed immediately: `Button`, `Input`, `Form`, `Card`
- [x] Apply Tailwind + shadcn/ui to existing `login.tsx` route as a smoke test
- [x] Update `docs/standards/` with Tailwind / shadcn usage conventions

**Packages added:**
```
tailwindcss @tailwindcss/vite
clsx tailwind-merge
```
*(shadcn/ui itself is copy-paste, not an npm install)*

---

### Phase 2 — Forms: React Hook Form + Zod

**Goal:** Standardise form handling across the app with validation co-located with the form schema.

- [x] Install `react-hook-form` and `zod`
- [x] Install `@hookform/resolvers` for the Zod resolver
- [x] Define Zod schemas in `src/schemas/` (one file per domain, e.g. `auth.ts`)
- [x] Refactor the login form in `login.tsx` to use `useForm` + `zodResolver`
- [x] Wire shadcn/ui `Form`, `FormField`, `FormItem`, `FormMessage` components to RHF (shadcn's `Form` primitive wraps RHF)
- [x] Document RHF + Zod pattern in `docs/standards/`

**Packages added:**
```
react-hook-form zod @hookform/resolvers
```

---

### Phase 3 — Global State: Zustand

**Goal:** Provide a lightweight global store for UI state that does not belong in TanStack Query (e.g. sidebar open/close, theme preference, notification toasts).

- [x] Install `zustand`
- [x] Create `src/store/` directory with one slice per concern:
  - `src/store/ui.ts` — UI flags (sidebar collapsed, active modal, etc.)
  - `src/store/auth.ts` — client-side auth flags that mirror/extend the JWT context (keep server state in TanStack Query)
- [x] Document store conventions: slices use `immer` middleware for mutations; never store server data in Zustand
- [x] Optionally install `immer` if mutation ergonomics are needed immediately

**Packages added:**
```
zustand
immer (optional)
```

---

### Phase 4 — Testing: Vitest + React Testing Library

**Goal:** A working test suite that runs in CI with no additional setup.

- [x] Install `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
- [x] Configure Vitest in `vite.config.ts` (`test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] }`)
- [x] Create `src/test/setup.ts` — import `@testing-library/jest-dom`
- [x] Add `test` and `test:ui` scripts to `package.json`
- [x] Write first smoke tests:
  - `src/components/ui/Button.test.tsx` — renders, responds to click
  - `src/hooks/useAuth.test.ts` — mocks Axios, asserts login mutation shape
- [x] Add `just fe-test` and `just fe-test-ui` commands to `justfile`
- [x] Document testing conventions in `docs/standards/`

**Packages added (devDependencies):**
```
vitest @vitest/ui jsdom
@testing-library/react @testing-library/user-event @testing-library/jest-dom
```

---

### Phase 5 — Utilities: date-fns

**Goal:** Provide a tree-shakable date utility library. `clsx` + `tailwind-merge` are already installed in Phase 1.

- [x] Install `date-fns`
- [x] Create `src/lib/date.ts` with project-specific wrappers (e.g. `formatDate`, `formatRelative`) so the import path is stable if the library is ever swapped
- [x] Document date formatting conventions (locale, format strings) in `docs/standards/`

**Packages added:**
```
date-fns
```

---

### Phase 6 — Charts / Data Viz: Plotly.js

**Goal:** Integrate Plotly.js for data visualisation with correct TypeScript types.

- [x] Install `plotly.js-dist-min` (smaller bundle than full `plotly.js`) and `@types/plotly.js`
- [x] Create a thin `src/components/charts/PlotlyChart.tsx` wrapper that accepts `data`, `layout`, and `config` props with correct types
- [x] Lazy-load the wrapper via `React.lazy` + `Suspense` to keep initial bundle small
- [x] Add a demo chart route (`/demo/chart`) to verify integration during development
- [x] Document chart conventions in `docs/standards/`

**Packages added:**
```
plotly.js-dist-min
@types/plotly.js (devDependency)
```

---

## Testing

### Unit tests (Phase 4 baseline)
- Each shadcn/ui wrapper component has a render test
- Each custom hook has a test with mocked Axios/TanStack Query
- Zustand store slices have isolated unit tests (no DOM required)
- Form schemas (Zod) have pure unit tests for valid and invalid input shapes

### Integration tests
- Login flow: fill form → submit → assert JWT stored → assert redirect
- Protected route: unauthenticated user is redirected to `/login`

### Manual verification steps
1. `just fe-dev` — dev server starts without errors
2. `just fe-build` — production build completes with no TypeScript errors
3. `just fe-test` — all tests pass
4. Login page renders with shadcn/ui components and Tailwind styles
5. Form shows inline validation errors on empty submit
6. Date formatting utility returns expected string for a known timestamp
7. Plotly chart renders to canvas on the demo route

---

## Risks & Notes

- **shadcn/ui requires `@/` path alias** — must be set in both `vite.config.ts` and `tsconfig.app.json` before initialising shadcn. Doing this first in Phase 1 avoids import churn later.
- **Tailwind CSS v4** uses a different configuration approach (CSS-first, no `tailwind.config.js` by default). Verify `@tailwindcss/vite` plugin version compatibility with the installed Vite version before proceeding.
- **Plotly bundle size** — even `plotly.js-dist-min` is ~1 MB. Lazy loading (Phase 6) is mandatory, not optional.
- **RHF vs TanStack Form** — React Hook Form chosen for maturity and ecosystem (resolvers, DevTools, shadcn/ui integration). Revisit if TanStack Form reaches stable v1.
- **Zustand vs Jotai** — Zustand chosen for its slice pattern which maps cleanly to the domain structure already used in the backend. Jotai is fine if atomic state becomes preferable in a future iteration.
- Phases 1–3 can be done in parallel by different developers. Phases 4–6 depend only on Phase 1 being complete (Vitest needs Vite config updated).
