#!/bin/sh
set -e
# Railway assigns the port at runtime.
export PORT="${PORT:-8080}"
echo "Listen ${PORT}" > /etc/apache2/ports.conf

# mod_php needs exactly one MPM (prefork); Apache refuses to start if event/worker are also enabled.
rm -f /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.*
a2enmod mpm_prefork >/dev/null

# A mounted volume starts out owned by root; Apache (www-data) must be able to write to it.
mkdir -p /var/www/html/storage /var/www/html/uploads
chown -R www-data:www-data /var/www/html/storage /var/www/html/uploads

exec apache2-foreground
