#ifndef ENTRIVO_ACCESS_CACHE_FORMAT_H
#define ENTRIVO_ACCESS_CACHE_FORMAT_H

#include <stddef.h>
#include <stdint.h>

// The offline schedule copy (format 1), built by the backend's
// DoorAccessCacheService.php. Everything here is constexpr so that
// AccessCacheSelfTest.cpp checks it while compiling, against a copy the
// backend generated, at no flash or RAM cost.
//
// Little-endian. Header (40 bytes): "ENAC", u16 format, u16 header size,
// u32 version, u32 generated_at, u32 valid_from, u32 valid_until, u16 people,
// u16 credentials, u16 windows, u16 0, u32 payload CRC-32, u32 payload size.
// Then 12-byte records: people, credentials, windows (see the backend).
namespace DoorAccessCache {
    constexpr uint32_t HEADER_BYTES = 40;
    constexpr uint32_t RECORD_BYTES = 12;
    constexpr uint16_t FORMAT = 1;
    constexpr uint32_t DAY_SECONDS = 86400UL;
    constexpr uint16_t MAX_WINDOWS_PER_PERSON = 128;

    constexpr uint8_t ROLE_STUDENT = 1;
    constexpr uint8_t FLAG_ALWAYS = 1;
    constexpr uint8_t TYPE_FINGER = 1;
    constexpr uint8_t TYPE_CARD = 2;
    constexpr uint8_t KIND_REGULAR = 1;
    constexpr uint8_t KIND_OVERRIDE = 2;

    constexpr uint16_t u16(const uint8_t *p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
    constexpr uint32_t u32(const uint8_t *p) {
        return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8)
            | (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
    }

    // Standard CRC-32 (zlib, PHP crc32()). Bitwise: no table in flash. Chain
    // calls by passing the previous result; start with 0.
    constexpr uint32_t crc32(uint32_t crc, const uint8_t *data, size_t length) {
        crc = ~crc;
        for (size_t i = 0; i < length; ++i) {
            crc ^= data[i];
            for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1UL)));
        }
        return ~crc;
    }

    struct Header {
        bool valid = false;
        uint32_t version = 0;
        uint32_t generatedAt = 0;
        uint32_t validFrom = 0;
        uint32_t validUntil = 0;
        uint16_t people = 0;
        uint16_t credentials = 0;
        uint16_t windows = 0;
        uint32_t payloadCrc = 0;
        uint32_t payloadSize = 0;

        constexpr uint32_t peopleOffset() const { return HEADER_BYTES; }
        constexpr uint32_t credentialsOffset() const { return HEADER_BYTES + people * RECORD_BYTES; }
        constexpr uint32_t windowsOffset() const { return credentialsOffset() + credentials * RECORD_BYTES; }
        constexpr uint32_t totalBytes() const { return HEADER_BYTES + payloadSize; }
    };

    // The header, when its layout is sound and the copy fits maxBytes. The
    // payload CRC is checked separately (the copy is read from flash in parts).
    constexpr Header parseHeader(const uint8_t *b, size_t length, uint32_t maxBytes) {
        Header h{};
        if (length < HEADER_BYTES || b[0] != 'E' || b[1] != 'N' || b[2] != 'A' || b[3] != 'C') return h;
        if (u16(b + 4) != FORMAT || u16(b + 6) != HEADER_BYTES) return h;
        h.version = u32(b + 8);
        h.generatedAt = u32(b + 12);
        h.validFrom = u32(b + 16);
        h.validUntil = u32(b + 20);
        h.people = u16(b + 24);
        h.credentials = u16(b + 26);
        h.windows = u16(b + 28);
        h.payloadCrc = u32(b + 32);
        h.payloadSize = u32(b + 36);
        const uint32_t records = static_cast<uint32_t>(h.people) + h.credentials + h.windows;
        h.valid = h.payloadSize == records * RECORD_BYTES && h.totalBytes() <= maxBytes
            && h.validUntil > h.validFrom && (h.validUntil - h.validFrom) % DAY_SECONDS == 0;
        return h;
    }

    struct Person {
        uint32_t userId = 0;
        uint8_t role = 0;
        uint8_t flags = 0;
        uint16_t firstWindow = 0;
        uint16_t windowCount = 0;
    };

    constexpr Person parsePerson(const uint8_t *r) {
        Person p{};
        p.userId = u32(r);
        p.role = r[4];
        p.flags = r[5];
        p.firstWindow = u16(r + 6);
        p.windowCount = u16(r + 8);
        return p;
    }

    // A credential record matches a finger slot (type 1) or a card UID (type 2, 5 bytes).
    constexpr bool credentialMatches(const uint8_t *r, uint8_t type, uint16_t slot, const uint8_t *uid) {
        if (r[0] != type) return false;
        if (type == TYPE_FINGER) return u16(r + 2) == slot;
        for (int i = 0; i < 5; ++i) if (r[4 + i] != uid[i]) return false;
        return true;
    }
    constexpr uint8_t credentialFlags(const uint8_t *r) { return r[1]; }
    constexpr uint16_t credentialPerson(const uint8_t *r) { return u16(r + 10); }

    // A card UID as the readers report it ("1F0045F08B") to its 5 bytes.
    constexpr int hexDigit(char c) {
        return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
    }
    constexpr bool parseUid(const char *text, size_t length, uint8_t *out) {
        if (length != 10) return false;
        for (size_t i = 0; i < 5; ++i) {
            const int high = hexDigit(text[2 * i]);
            const int low = hexDigit(text[2 * i + 1]);
            if (high < 0 || low < 0) return false;
            out[i] = static_cast<uint8_t>((high << 4) | low);
        }
        return true;
    }

    enum class Mode : uint8_t { Auto, On, Off };
    enum class Reason : uint8_t { Granted, NoSchedule, NotStarted, Expired, OutOfRange };
    // Granted kinds: the same names the backend sends, for the voice prompt.
    enum class Kind : uint8_t { None, Regular, Override, PermanentOverride, ScheduleOff };

    struct Decision {
        bool granted = false;
        Reason reason = Reason::NoSchedule;
        Kind kind = Kind::None;
        uint32_t endEpoch = 0;      // schedule end (granted on a window), else 0
        long secondsRemaining = -1; // until that end, else -1
    };

    // Entry rule, as the backend's ScheduleAccessPolicy::evaluateEntry:
    //  - scheduling Off: any listed (usable) credential enters;
    //  - admins, super admins and emergency cards: any time;
    //  - students: an approved override window only;
    //  - faculty and staff: a regular or override window (regular first).
    // A window is [start, end). A refusal says whether today's windows have
    // not started yet or have all ended, like the backend.
    // windows: the person's windowCount records (12 bytes each).
    constexpr Decision decide(const Header &h, const Person &person, uint8_t credentialFlagBits,
        const uint8_t *windows, uint16_t count, uint32_t now, Mode mode) {
        Decision d{};
        if (now < h.validFrom || now >= h.validUntil) { d.reason = Reason::OutOfRange; return d; }
        if (mode == Mode::Off) { d.granted = true; d.reason = Reason::Granted; d.kind = Kind::ScheduleOff; return d; }
        if ((person.flags | credentialFlagBits) & FLAG_ALWAYS) {
            d.granted = true; d.reason = Reason::Granted; d.kind = Kind::PermanentOverride; return d;
        }
        const bool student = person.role == ROLE_STUDENT;
        const uint32_t dayStart = h.validFrom + ((now - h.validFrom) / DAY_SECONDS) * DAY_SECONDS;
        const uint32_t dayEnd = dayStart + DAY_SECONDS;
        bool futureToday = false;
        bool endedToday = false;
        uint32_t overrideEnd = 0;
        for (uint16_t i = 0; i < count; ++i) {
            const uint8_t *w = windows + i * RECORD_BYTES;
            const uint32_t start = u32(w);
            const uint32_t end = u32(w + 4);
            const uint8_t kind = w[8];
            if (end <= start || (student && kind != KIND_OVERRIDE)) continue;
            if (start >= dayStart && start < dayEnd) {
                futureToday = futureToday || now < start;
                endedToday = endedToday || now >= end;
            }
            if (now < start || now >= end) continue;
            if (kind == KIND_REGULAR) {
                d.granted = true; d.reason = Reason::Granted; d.kind = Kind::Regular;
                d.endEpoch = end; d.secondsRemaining = static_cast<long>(end - now);
                return d;
            }
            if (kind == KIND_OVERRIDE && overrideEnd == 0) overrideEnd = end;
        }
        if (overrideEnd != 0) {
            d.granted = true; d.reason = Reason::Granted; d.kind = Kind::Override;
            d.endEpoch = overrideEnd; d.secondsRemaining = static_cast<long>(overrideEnd - now);
            return d;
        }
        d.reason = futureToday ? Reason::NotStarted : endedToday ? Reason::Expired : Reason::NoSchedule;
        return d;
    }
}

#endif
