# Entrivo PHP API for Railway (or any Docker host).
FROM php:8.5-apache

RUN docker-php-ext-install pdo_mysql \
    && a2enmod headers \
    && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY docker/apache-site.conf /etc/apache2/sites-available/000-default.conf
COPY docker/start.sh /usr/local/bin/entrivo-start
COPY . /var/www/html/

RUN chmod +x /usr/local/bin/entrivo-start \
    && mkdir -p /var/www/html/storage /var/www/html/uploads \
    && chown -R www-data:www-data /var/www/html/storage /var/www/html/uploads

CMD ["entrivo-start"]
