# Third-party notices

This project depends on open-source packages that keep their own licenses
(mostly MIT, Apache-2.0 and ISC). The full list is in `package-lock.json`;
run `npx license-checker --summary` for a summary. Notable runtime dependencies:

| Package                | License           |
| ---------------------- | ----------------- |
| next, react, react-dom | MIT               |
| next-intl              | MIT               |
| zod                    | MIT               |
| wrangler (dev only)    | MIT OR Apache-2.0 |
| next-auth, @auth/*     | ISC               |
| prisma, @prisma/*      | Apache-2.0        |
| pg, bcryptjs           | MIT               |

## Vendored data

`apps/web/lib/auth/common-passwords.ts` holds the 10,000 most common passwords from
[SecLists](https://github.com/danielmiessler/SecLists)
(`Passwords/Common-Credentials/10k-most-common.txt`), © Daniel Miessler and contributors,
MIT License. It is used only to refuse those passwords at sign-up.
