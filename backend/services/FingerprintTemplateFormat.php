<?php

/** Complete template sizes supported by the sensor transfer protocol. */
final class FingerprintTemplateFormat
{
    public const SUPPORTED_SIZES = [512, 768, 1024, 1536];

    public static function isSupportedSize(int $bytes): bool
    {
        return in_array($bytes, self::SUPPORTED_SIZES, true);
    }

    public static function describeSupportedSizes(): string
    {
        return implode(', ', self::SUPPORTED_SIZES);
    }

    /** A constant buffer is not a captured template, regardless of its hash. */
    public static function isUsableTemplate(string $binary): bool
    {
        return self::isSupportedSize(strlen($binary))
            && strspn($binary, $binary[0]) < strlen($binary);
    }

    /** Accept legacy base64 backups only when their hash proves the full bytes. */
    public static function verifiedBinary(mixed $data, mixed $hash): ?string
    {
        if (!is_string($data) || !is_string($hash)) return null;
        $hash = strtolower(trim($hash));
        if (preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1) return null;
        if (self::isUsableTemplate($data) && hash_equals($hash, hash('sha256', $data))) {
            return $data;
        }
        $decoded = base64_decode($data, true);
        return is_string($decoded) && self::isUsableTemplate($decoded)
            && hash_equals($hash, hash('sha256', $decoded)) ? $decoded : null;
    }
}
