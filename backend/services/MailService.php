<?php

/** The SMTP server may have accepted DATA, so automatic retry could duplicate mail. */
class MailDeliveryUncertainException extends RuntimeException
{
}

class MailService
{
    public static function mailbox(string $name): array
    {
        $prefix = match ($name) {
            'credentials' => 'SMTP_CREDENTIALS',
            'otp' => 'SMTP_OTP',
            default => 'SMTP',
        };

        $username = trim((string) (getenv($prefix . '_USERNAME') ?: getenv('SMTP_USERNAME') ?: ''));
        $password = (string) (getenv($prefix . '_PASSWORD') ?: '');

        if ($password === '' && $prefix === 'SMTP') {
            $password = (string) (getenv('SMTP_PASSWORD') ?: '');
        }

        return [
            'username' => $username,
            'password' => $password,
            'from_name' => trim((string) (getenv('SMTP_FROM_NAME') ?: 'Entrivo')),
        ];
    }

    public function send(string $to, string $subject, string $text, ?array $account = null, ?string $html = null): void
    {
        $host = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
        $port = (int) (getenv('SMTP_PORT') ?: 587);
        $username = trim((string) ($account['username'] ?? getenv('SMTP_USERNAME') ?: ''));
        $password = str_replace(' ', '', (string) ($account['password'] ?? getenv('SMTP_PASSWORD') ?: ''));
        $fromName = trim((string) ($account['from_name'] ?? getenv('SMTP_FROM_NAME') ?: 'Entrivo'));

        // Hosts such as Railway (Free/Trial/Hobby) block outbound SMTP ports.
        // With BREVO_API_KEY set, mail goes over HTTPS (port 443) instead.
        $brevoKey = trim((string) (getenv('BREVO_API_KEY') ?: ''));
        if ($brevoKey !== '') {
            $fromEmail = trim((string) (getenv('MAIL_FROM_EMAIL') ?: $username));
            if ($fromEmail === '') {
                throw new RuntimeException('Email is not configured. Set MAIL_FROM_EMAIL to a sender verified in Brevo.');
            }
            $this->sendViaBrevo($brevoKey, $to, $subject, $text, $fromEmail, $fromName, $html);
            return;
        }

        if ($username === '' || $password === '') {
            throw new RuntimeException('Email is not configured. Set SMTP_USERNAME to the Gmail account that owns the app password.');
        }

        $socket = stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20);
        if (!$socket) {
            throw new RuntimeException('Could not reach the mail server.');
        }

        stream_set_timeout($socket, 20);

        $awaitingAcceptance = false;

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

            $message = self::formatMessage($to, $subject, $text, $username, $fromName, $html) ."\r\n.\r\n";
            $awaitingAcceptance = true;
            $offset = 0;
            while ($offset < strlen($message)) {
                $written = fwrite($socket, substr($message, $offset));
                if ($written === false || $written === 0) {
                    throw new RuntimeException('The mail server connection closed while sending the message.');
                }
                $offset += $written;
            }
            $this->expect($socket, [250]);
            $awaitingAcceptance = false;
            // DATA acceptance is authoritative. A failed QUIT must not trigger duplicate mail.
            try {
                $this->command($socket, 'QUIT', [221]);
            } catch (Throwable $ignored) {
            }
        } catch (Throwable $error) {
            if ($awaitingAcceptance && ($error->getCode() < 400 || $error->getCode() > 599)) {
                throw new MailDeliveryUncertainException('The mail server did not confirm whether the message was accepted.', 0, $error);
            }
            throw $error;
        } finally {
            fclose($socket);
        }
    }

    /** Brevo transactional email API: https://developers.brevo.com/reference/sendtransacemail */
    private function sendViaBrevo(string $apiKey, string $to, string $subject, string $text, string $fromEmail, string $fromName, ?string $html = null): void
    {
        $clean = static fn (string $value): string => str_replace(["\r", "\n"], '', $value);
        $fields = [
            'sender' => ['name' => $clean($fromName), 'email' => $clean($fromEmail)],
            'to' => [['email' => $clean($to)]],
            'subject' => $clean($subject),
            'textContent' => $text,
        ];
        if ($html !== null && $html !== '') {
            $fields['htmlContent'] = $html;
        }
        $payload = json_encode($fields, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

        $curl = curl_init('https://api.brevo.com/v3/smtp/email');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => [
                'accept: application/json',
                'content-type: application/json',
                'api-key: ' . $apiKey,
            ],
        ]);
        $body = curl_exec($curl);
        $errno = curl_errno($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);

        if ($errno !== 0) {
            // Before the request was sent nothing can have been delivered; after
            // it, a lost response means Brevo may already have queued the mail.
            if (in_array($errno, [CURLE_COULDNT_RESOLVE_HOST, CURLE_COULDNT_CONNECT, CURLE_SSL_CONNECT_ERROR], true)) {
                throw new RuntimeException('Could not reach the mail server.');
            }
            throw new MailDeliveryUncertainException('The mail server did not confirm whether the message was accepted.');
        }
        if ($status < 200 || $status >= 300) {
            $detail = is_string($body) ? (json_decode($body, true)['message'] ?? '') : '';
            error_log('Brevo send failed: HTTP ' . $status . ($detail !== '' ? ' - ' . $detail : ''));
            throw new RuntimeException('The email could not be sent.', $status);
        }
    }

    /**
     * SMTP DATA with a single CRLF per line and dot-stuffed body lines.
     * With $html, the message is multipart/alternative: plain text first, HTML second.
     */
    public static function formatMessage(string $to, string $subject, string $text, string $from, string $fromName, ?string $html = null): string
    {
        $clean = static fn (string $value): string => str_replace(["\r", "\n"], '', $value);
        $normalize = static fn (string $value): string => str_replace(["\r\n", "\r"], "\n", $value);
        $headers = [
            'From: ' . $clean($fromName) . ' <' . $clean($from) . '>',
            'To: <' . $clean($to) . '>',
            'Subject: ' . $clean($subject),
            'MIME-Version: 1.0',
        ];

        if ($html === null || $html === '') {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $body = $normalize($text);
        } else {
            $boundary = 'entrivo-' . bin2hex(random_bytes(12));
            $part = static fn (string $type, string $content): string => implode("\n", [
                '--' . $boundary,
                'Content-Type: ' . $type . '; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
                '',
                rtrim(chunk_split(base64_encode($normalize($content)), 76, "\n")),
            ]);
            $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
            $body = $part('text/plain', $text) . "\n" . $part('text/html', $html) . "\n--" . $boundary . '--';
        }

        $body = preg_replace('/^\./m', '..', $body);
        return implode("\r\n", $headers) . "\r\n\r\n" . str_replace("\n", "\r\n", $body);
    }

    /**
     * Verification-code email with the code shown digit by digit in boxes.
     * Pair it with a subject like "Your Entrivo verification code: 123456" so Gmail offers its Copy code button.
     *
     * @param string[] $paragraphs plain-text paragraphs shown under the code
     */
    public static function otpEmailHtml(string $heading, string $intro, string $code, array $paragraphs): string
    {
        $e = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $digits = '';
        foreach (str_split($code) as $digit) {
            $digits .= '<td style="padding:0 4px;"><div style="width:44px;height:54px;line-height:54px;'
                . 'background:#ffffff;border:1px solid #d7dee4;border-radius:8px;text-align:center;'
                . 'font-size:26px;font-weight:700;color:#0c4b2d;font-family:Consolas,Menlo,monospace;">'
                . $e($digit) . '</div></td>';
        }

        $extra = '';
        foreach ($paragraphs as $paragraph) {
            $extra .= '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3d4a44;">' . $e($paragraph) . '</p>';
        }

        $heading = $e($heading);
        $intro = $e($intro);
        $columns = max(1, strlen($code));

        return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' . $heading . '</title></head>'
            . '<body style="margin:0;padding:0;background:#f3f5f7;font-family:Segoe UI,Arial,Helvetica,sans-serif;">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:24px 12px;"><tr><td align="center">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e8ec;border-radius:12px;overflow:hidden;">'
            . '<tr><td style="background:#0c4b2d;padding:18px 28px;">'
            . '<div style="font-size:18px;font-weight:700;color:#ffffff;">Entrivo</div>'
            . '<div style="font-size:12px;color:#cfe3d8;">Door Lock System &middot; Caraga State University - Cabadbaran Campus</div>'
            . '</td></tr>'
            . '<tr><td style="padding:28px;">'
            . '<h1 style="margin:0 0 12px;font-size:20px;color:#18372b;">' . $heading . '</h1>'
            . '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3d4a44;">' . $intro . '</p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" style="background:#eef3f0;border-radius:10px;padding:18px 14px;margin:0 0 20px;">'
            . '<tr><td colspan="' . $columns . '" style="padding:0 4px 12px;font-size:13px;font-weight:600;color:#18372b;">Your verification code</td></tr>'
            . '<tr>' . $digits . '</tr></table>'
            . $extra
            . '</td></tr>'
            . '<tr><td style="padding:16px 28px;background:#f7f9fa;border-top:1px solid #e3e8ec;font-size:12px;color:#6b7280;">'
            . 'Never share this code with anyone. Entrivo staff will never ask for it.</td></tr>'
            . '</table></td></tr></table></body></html>';
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
                throw new RuntimeException('The email could not be sent.', (int) $matches[1]);
            }

            return;
        }

        throw new RuntimeException('The mail server closed the connection.');
    }
}
