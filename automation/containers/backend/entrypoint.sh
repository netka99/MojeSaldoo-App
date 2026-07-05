#!/bin/sh
# Apply database migrations before serving, then exec the given command (gunicorn)
# so it becomes PID 1 and receives signals directly.
set -e

echo "Running database migrations..."
python3.12 manage.py migrate --noinput

# When invoked with "--test", run the test suite (equivalent to the Makefile
# "test" target) instead of serving. Any arguments after "--test" are forwarded
# to pytest, e.g. "--test --ds=config.settings_production -k invoices".
if [ "$1" = "--test" ]; then
	shift
	echo "Running test suite..."
	exec python3.12 -m pytest apps "$@"
fi

exec "$@"
