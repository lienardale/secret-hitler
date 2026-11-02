/** Integration tier, once per run: guard the target, wait for it, migrate, empty. */
import { prepareTestDatabase } from "../_db/test-db";

export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
