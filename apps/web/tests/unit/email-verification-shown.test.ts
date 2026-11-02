import { describe, expect, it } from "vitest";

import { emailVerificationShown } from "../../lib/env";

describe("emailVerificationShown", () => {
  it("hides verification when no mail can arrive and public play does not need it", () => {
    expect(
      emailVerificationShown({ MAIL_TRANSPORT: "log", REQUIRE_EMAIL_VERIFICATION: false }),
    ).toBe(false);
  });

  it("shows it when mail is really sent or verification is required", () => {
    expect(
      emailVerificationShown({ MAIL_TRANSPORT: "resend", REQUIRE_EMAIL_VERIFICATION: false }),
    ).toBe(true);
    expect(
      emailVerificationShown({ MAIL_TRANSPORT: "log", REQUIRE_EMAIL_VERIFICATION: true }),
    ).toBe(true);
  });
});
