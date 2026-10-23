#include "RfidFrame.h"

static_assert(DoorRfidProtocol::validFrame("4300C46DDF35", 12), "Known RDM6300 frame must validate.");
static_assert(DoorRfidProtocol::validFrame("4300c46ddf35", 12), "Lowercase hex must validate.");
static_assert(!DoorRfidProtocol::validFrame("4300C46DDF34", 12), "Bad checksum must be rejected.");
static_assert(!DoorRfidProtocol::validFrame("4300Z46DDF35", 12), "Non-hex payload must be rejected.");
static_assert(!DoorRfidProtocol::validFrame("4300C46DDF35", 11), "Incomplete payload must be rejected.");

namespace {
    constexpr bool parserChecks() {
        DoorRfidProtocol::FrameParser parser;
        char uid[11] = {};
        const char payload[] = "4300c46ddf35";
        parser.feed(0x02, 0, uid);
        for (size_t index = 0; index < 12; ++index) {
            if (parser.feed(payload[index], static_cast<uint32_t>(index + 1), uid)) return false;
        }
        if (!parser.feed(0x03, 14, uid) || uid[4] != 'C' || uid[8] != 'D') return false;
        parser.feed(0x02, 20, uid);
        parser.feed('4', 21, uid);
        if (parser.feed(0x03, 22, uid)) return false;
        parser.feed(0x02, 30, uid);
        if (parser.feed('4', 131, uid) || parser.started) return false;
        // A new STX must recover from a partial previous frame.
        parser.feed(0x02, 140, uid);
        parser.feed('0', 141, uid);
        parser.feed(0x02, 142, uid);
        for (size_t index = 0; index < 12; ++index) parser.feed(payload[index], 143 + index, uid);
        return parser.feed(0x03, 156, uid);
    }
    static_assert(parserChecks(), "RDM6300 parser framing, timeout, normalization, and resync must work.");
}
