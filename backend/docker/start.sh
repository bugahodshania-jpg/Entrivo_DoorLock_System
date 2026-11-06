#!/bin/sh
set -e
# Railway assigns the port at runtime.
export PORT="${PORT:-8080}"
echo "Listen ${PORT}" > /etc/apache2/ports.conf
exec apache2-foreground
