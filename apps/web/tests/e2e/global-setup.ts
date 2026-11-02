/**
 * Once per local e2e run: migrate and empty the `_test` database the web
 * server uses, and clear the dev mail sink. Not used against a deployed site.
 */
import { prepareTestDatabase } from "../_db/test-db";
import { clearMailSink } from "./accounts";

export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
  clearMailSink();
}
