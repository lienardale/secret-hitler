#!/bin/sh
# Runs once, on an EMPTY volume, from the postgres image's entrypoint.
#
# The integration and e2e tiers use `<db>_test` and empty it between files, so it
# must be a separate database from the developer's own data. The test setup
# refuses any URL whose database name does not end in `_test`.
set -e

TEST_DB="${POSTGRES_DB}_test"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE "${TEST_DB}" OWNER "${POSTGRES_USER}";
EOSQL

echo "initdb: created ${TEST_DB}"
