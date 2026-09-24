<?php

class MailService
{
    public function send(string $to, string $subject, string $text): void
    {
        $host = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
        $port = (int) (getenv('SMTP_PORT') ?: 587);
        $username = trim((string) (getenv('SMTP_USERNAME') ?: ''));
        $password = str_replace(' ', '', (string) (getenv('SMTP_PASSWORD') ?: ''));
        $fromName = trim((string) (getenv('SMTP_FROM_NAME') ?: 'Entrivo'));

        if ($username === '' || $password === '') {
            throw new RuntimeException('Recovery email is not configured. Set SMTP_USERNAME to the Gmail account that owns the app password.');
        }

        $socket = stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20);
        if (!$socket) {
            throw new RuntimeException('Could not reach the mail server.');
        }

        stream_set_timeout($socket, 20);

        try {
            $this->expect($socket, [220]);
            $this->command($socket, 'EHLO entrivo.local', [250]);
            $this->command($socket, 'STARTTLS', [220]);

            $crypto = STREAM_CRYPTO_METHOD_TLS_CLIENT;
            if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
                $crypto |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
            }

            if (!stream_socket_enable_crypto($socket, true, $crypto)) {
                throw new RuntimeException('Could not start a secure mail connection.');
            }

            $this->command($socket, 'EHLO entrivo.local', [250]);
            $this->command($socket, 'AUTH LOGIN', [334]);
            $this->command($socket, base64_encode($username), [334]);
            $this->command($socket, base64_encode($password), [235]);
            $this->command($socket, 'MAIL FROM:<' . $username . '>', [250]);
            $this->command($socket, 'RCPT TO:<' . $to . '>', [250, 251]);
            $this->command($socket, 'DATA', [354]);

            $safeSubject = str_replace(["\r", "\n"], '', $subject);
            $message = "From: {$fromName} <{$username}>\r\n";
            $message .= "To: <{$to}>\r\n";
            $message .= "Subject: {$safeSubject}\r\n";
            $message .= "MIME-Version: 1.0\r\n";
            $message .= "Content-Type: text/plain; charset=UTF-8\r\n";
            $message .= "\r\n";
            $message .= str_replace("\n.", "\n..", str_replace(["\r\n", "\r"], "\n", $text));
            $message = str_replace("\n", "\r\n", $message);
            fwrite($socket, $message . "\r\n.\r\n");
            $this->expect($socket, [250]);
            $this->command($socket, 'QUIT', [221]);
        } finally {
            fclose($socket);
        }
    }

    private function command($socket, string $command, array $codes): void
    {
        fwrite($socket, $command . "\r\n");
        $this->expect($socket, $codes);
    }

    private function expect($socket, array $codes): void
    {
        $buffer = '';

        while (($line = fgets($socket, 515)) !== false) {
            $buffer .= $line;
            if (!preg_match('/^(\d{3})([\s-])/', $line, $matches)) {
                continue;
            }

            if ($matches[2] === '-') {
                continue;
            }

            if (!in_array((int) $matches[1], $codes, true)) {
                throw new RuntimeException('The recovery email could not be sent.');
            }

            return;
        }

        throw new RuntimeException('The mail server closed the connection.');
    }
}
