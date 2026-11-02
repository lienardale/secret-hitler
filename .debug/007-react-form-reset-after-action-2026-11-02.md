# 007 — A refused form came back empty

**Observed.** On the sign-up page, a refused submission (name taken, weak password) showed its
errors but every field was empty again, so the visitor had to retype everything. Found by
`tests/e2e/accounts.spec.ts` ("sign-up refusals are decided on the server").

**Cause.** React 19 resets a `<form action={…}>` after its action completes: uncontrolled inputs
go back to their `defaultValue`.

**Fix.** The auth actions return what was typed (`values`, never the password) with the error,
and the inputs use it as `defaultValue` (`components/auth/AuthForms.tsx`). The reset then
restores the typed values. Checkboxes (the age confirmation) and passwords reset by design.

**Check.** The e2e test asserts the name field still holds the refused name.
