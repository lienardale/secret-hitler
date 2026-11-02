/**
 * Node test projects (unit, integration): stable secrets so modules that read
 * them (rate-limit keys, Auth.js tokens) behave the same in every run, and a
 * cheap bcrypt cost so the suites are not dominated by hashing.
 */
process.env.AUTH_SECRET ??= "test-auth-secret-0123456789abcdefghijklmnop";
process.env.BCRYPT_COST ??= "4";
