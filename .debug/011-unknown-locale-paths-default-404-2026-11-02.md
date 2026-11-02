# 011 — Unknown paths got Next's bare 404 (no `lang`), and their prefetches never settled

**Observed.** axe failed `html-has-lang` on any unknown URL such as `/fr/nope`: the page was
Next's default 404 with a bare `<html>`. While the footer linked to pages that did not exist yet,
`next start` also left the footer's prefetches of those 404 routes pending, so a Playwright
`waitForLoadState("networkidle")` never returned.

**Cause.** Nothing under `app/[locale]` matched an unknown path, so Next fell back to its
built-in not-found page outside the locale layout (no `<html lang>`, header or footer).

**Fix.** `app/[locale]/[...rest]/page.tsx` calls `notFound()`, which renders
`app/[locale]/not-found.tsx` inside the locale layout (strings `common.notFound.*`). The a11y spec
also caps its idle wait at 2 s instead of waiting for network idle.

**Check.** `curl -s http://localhost:3100/fr/nope | grep -o '<html lang="fr"'` and the 404 case in
`tests/e2e/a11y.spec.ts`.
