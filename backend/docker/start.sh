#!/bin/sh
set -e
# Railway assigns the port at runtime.
export PORT="${PORT:-8080}"
echo "Listen ${PORT}" > /etc/apache2/ports.conf

# A mounted volume starts out owned by root; Apache (www-data) must be able to write to it.
mkdir -p /var/www/html/storage /var/www/html/uploads
chown -R www-data:www-data /var/www/html/storage /var/www/html/uploads

exec apache2-foreground
