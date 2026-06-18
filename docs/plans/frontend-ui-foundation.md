# Plan: Frontend UI Foundation

**Status:** Complete  
**Date:** 2026-03-14

---

## Goal

Establish the core UI shell for the frontend — including navigation (navbar + sidebar), key pages (home, login, signup), a consistent colour palette, and full dark/light mode support. This creates the visual and structural foundation all future features will build on.

## Background

The current frontend has a minimal route setup and basic shadcn/ui components but lacks a cohesive UI shell. Users need a consistent navigation experience, accessible theming, and polished auth-facing pages before any domain-specific features are added.

---

## Phases

### Phase 1 — Colour Palette & Theme System

- [x] Define CSS custom properties for the design token set in `src/index.css`:
  - Primary, secondary, accent, destructive, muted, background, foreground, border, ring, card, popover
  - Both `:root` (light) and `.dark` overrides
- [x] Choose and document a base colour palette (e.g. slate/neutral greys + indigo primary)
- [x] Verify shadcn/ui CSS variable names align with chosen tokens (shadcn uses `--background`, `--foreground`, `--primary`, etc.)
- [x] Add `src/lib/theme.ts` — helper exports for colour token names (useful for Plotly chart theming)

### Phase 2 — Dark / Light Mode

- [x] Add `theme` slice to `src/store/ui.ts`: `'light' | 'dark' | 'system'`
- [x] Implement `useTheme` hook in `src/hooks/useTheme.ts`:
  - Reads from Zustand store + `localStorage`
  - Applies `dark` class to `<html>` element
  - Respects `prefers-color-scheme` when mode is `'system'`
- [x] Add `ThemeProvider` wrapper around the app in `src/main.tsx`
- [x] Add `ThemeToggle` button component in `src/components/ui/ThemeToggle.tsx` (sun/moon icon, cycles light → dark → system)
- [x] Test: `src/hooks/useTheme.test.ts` — verify class toggling, localStorage persistence, system fallback

### Phase 3 — Layout Shell (Navbar + Sidebar)

- [x] Create `src/components/layout/AppLayout.tsx` — root layout wrapper used by authenticated routes
- [x] Create `src/components/layout/Navbar.tsx`:
  - Logo / app name (left)
  - `ThemeToggle` (right)
  - User avatar / logout button (right, shown when authenticated)
  - Hamburger toggle for sidebar on mobile
- [x] Create `src/components/layout/Sidebar.tsx`:
  - Collapsible (desktop: icon-only ↔ full; mobile: off-canvas drawer)
  - Navigation links driven by a `navItems` config array
  - `sidebarOpen` state from `src/store/ui.ts`
  - Active link highlighting via TanStack Router's `useRouterState`
- [x] Wire `AppLayout` into `src/routes/__root.tsx` for authenticated routes
- [x] Responsive breakpoints: sidebar hidden on `< md`, collapsible on `>= md`
- [x] Tests:
  - `Navbar.test.tsx` — renders links, triggers theme toggle, shows/hides user controls
  - `Sidebar.test.tsx` — open/close state, active link class, nav items rendered

### Phase 4 — Home Page

- [x] Create `src/routes/index.tsx` (already exists — replace placeholder content):
  - Hero section: app name, one-line description, CTA buttons (Login / Sign Up)
  - Shown to unauthenticated users; redirect authenticated users to `/demo/chart`
- [x] Create `src/components/home/HeroBanner.tsx` — extracted hero component
- [x] Apply theme-aware colour tokens to hero background / gradient

### Phase 5 — Login Page

- [x] Update `src/routes/login.tsx`:
  - Centred card layout using shadcn/ui `Card`
  - Email + password fields using `Form`, `FormField`, `FormItem`, `FormMessage`
  - Submit calls `useAuth` → `login` mutation
  - Error state displayed inline (invalid credentials)
  - "Don't have an account? Sign up" link to `/signup`
  - `ThemeToggle` accessible from page (top-right corner)
- [x] Test: `src/__tests__/routes/login.test.tsx` — form validation, submit behaviour, error display

### Phase 6 — Signup Page

- [x] Create `src/routes/signup.tsx`:
  - Centred card layout matching login page style
  - Fields: email, password, confirm password
  - `signupSchema` already in `src/schemas/auth.ts`
  - `register` mutation from `src/api/auth.ts`
  - On success: redirect to `/login`
  - "Already have an account? Log in" link to `/login`
- [x] Register route in TanStack Router route tree
- [x] Test: `src/__tests__/routes/signup.test.tsx` — password match validation, submit behaviour, redirect

---

## Testing

**Unit tests:**
- `useTheme.test.ts` — theme switching logic, localStorage, system media query
- `Navbar.test.tsx` — rendering, theme toggle, auth-conditional items
- `Sidebar.test.tsx` — open/close, active link, nav config rendering

**Integration tests (RTL + MSW or mocked Axios):**
- `login.test.tsx` — form submission, API error handling, redirect on success
- `signup.test.tsx` — validation (password mismatch), submit, success redirect
- `index.test.tsx` — unauthenticated view vs. authenticated redirect

**Manual verification steps:**
1. Toggle dark/light mode — verify all pages update instantly with no flash
2. System mode follows OS preference when set
3. Theme preference persists across page refresh
4. Sidebar collapses to icon-only on desktop at `md` breakpoint
5. Sidebar becomes an off-canvas drawer on mobile
6. Login: submit with wrong credentials → inline error shown
7. Signup: password mismatch → inline validation error
8. Signup success → redirect to `/login` with toast
9. Authenticated user visiting `/` → redirected correctly
10. All pages pass axe accessibility audit (no critical violations)

---

## File Summary

| File | Action |
|------|--------|
| `src/index.css` | Add full CSS variable token set (light + dark) |
| `src/lib/theme.ts` | New — colour token helpers |
| `src/store/ui.ts` | Add `theme` state + `setTheme` action |
| `src/hooks/useTheme.ts` | New — theme hook |
| `src/components/ui/ThemeToggle.tsx` | New — toggle button |
| `src/components/layout/AppLayout.tsx` | New — layout shell |
| `src/components/layout/Navbar.tsx` | New — top navbar |
| `src/components/layout/Sidebar.tsx` | New — collapsible sidebar |
| `src/routes/__root.tsx` | Integrate `AppLayout` |
| `src/routes/index.tsx` | Replace placeholder with home/hero |
| `src/routes/login.tsx` | Full login form UI |
| `src/routes/signup.tsx` | New — signup form |
| `src/schemas/auth.ts` | Add `signupSchema` |
| `src/api/auth.ts` | Add `register` API call |
| `src/api/queryKeys.ts` | Add register mutation key |

---

## Risks & Notes

- **shadcn/ui CSS variables:** The existing `src/index.css` may already define some tokens from initial shadcn setup — audit before overwriting to avoid conflicts.
- **TanStack Router route tree:** Adding `signup.tsx` requires regenerating `routeTree.gen.ts` (`npm run dev` triggers this automatically via Vite plugin).
- **Flash of unstyled theme (FOUT):** Apply the `dark` class synchronously in an inline `<script>` before React hydrates if SSR is ever added; for now, the `useTheme` hook in `main.tsx` is sufficient.
- **Sidebar nav items config:** Keep nav items as a typed array in `src/components/layout/navItems.ts` so they can be conditionally filtered by role/permission later without touching the component.
- **Mobile drawer:** Use shadcn/ui `Sheet` component for the mobile sidebar off-canvas drawer — avoids building a custom focus trap.
