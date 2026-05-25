import base64, json

# --- Background: how numbers are stored in binary ---
#
# Every number in a computer is stored as bits (0s and 1s).
# A "byte" is 8 bits, so it can hold values 0–255.
# "Hex" (base-16) is just a compact way to write binary: 0xFF = 255 = 11111111 in binary.
#
# Bit shifting:
#   x >> 1  means "move all bits one place to the right" = divide by 2
#   x << 1  means "move all bits one place to the left"  = multiply by 2
#   Example: 0b00001100 >> 1 = 0b00000110  (12 >> 1 = 6)
#
# Bitwise AND (&):
#   Compares two numbers bit by bit. Output bit is 1 only if BOTH input bits are 1.
#   Used to isolate (mask) specific bits:
#   Example: 0b10110110 & 0b00001111 = 0b00000110  (keeps only the lower 4 bits)
#
# Bitwise XOR (^):
#   Output bit is 1 if the two input bits are DIFFERENT, 0 if they are the same.
#   Used heavily in checksums because it's a cheap way to detect changed bits.
#
# Bitwise OR (|):
#   Output bit is 1 if EITHER input bit is 1.
#   Used to combine (merge) bits from two values.

# --- What is a CRC checksum? ---
#
# When the AC receives a blob, it needs to know whether the bytes arrived
# correctly and weren't corrupted. A checksum is a small number calculated
# from all the bytes in the message. The sender calculates it and appends it;
# the receiver recalculates it and checks it matches.
#
# CRC-16/CCITT is the specific algorithm the AC uses. It works by treating
# the whole message as one very large binary number, then dividing it by a
# fixed "magic number" called the polynomial (0x1021). The remainder of that
# division is the checksum. If even one bit changes, the remainder changes too.
#
# The loop below does that division one bit at a time:
#   - Start with crc = 0xFFFF (all 1s) as the running remainder.
#   - For each bit in the data, shift the remainder left by 1 (like long division)
#     and if the bit we just dropped off the top doesn't match the incoming bit,
#     XOR (mix in) the polynomial. That XOR step is equivalent to subtracting
#     the polynomial in binary arithmetic, which is what long division does.
#   - Whatever is left after processing every bit is the checksum.
#
# Worked example — first two iterations processing byte 0x01 (0b00000001):
#
#   crc starts as: 1111111111111111  (0xFFFF)
#
#   i=7:  bit = (0x01 >> 7) & 1 = 0       ← bit 7 of 0x01 is 0
#         top = (0xFFFF >> 15) & 1 = 1    ← top bit of crc is 1
#         crc = 0xFFFF << 1 = 1111111111111110  (0xFFFE)
#         bit ^ top = 0^1 = 1  → they differ, so apply polynomial:
#         crc = 0xFFFE ^ 0x1021 = 1110111111011111  (0xEFDF)
#
#   i=6:  bit = (0x01 >> 6) & 1 = 0       ← bit 6 of 0x01 is also 0
#         top = (0xEFDF >> 15) & 1 = 1    ← top bit of 0xEFDF is still 1
#         crc = 0xEFDF << 1 = 1101111110111110  (0xDFBE)
#         bit ^ top = 1 → apply polynomial:
#         crc = 0xDFBE ^ 0x1021 = 1100111110011111  (0xCF9F)
#
#   ...this continues for all 8 bits of this byte, then repeats for every
#   subsequent byte in the data. The final crc after all bytes is the checksum.
#
# To show why this catches corruption — flipping just one bit gives a
# completely different result, which the AC will notice and reject.
def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        for i in range(7, -1, -1):       # process each bit, starting from the most significant
            bit = (byte >> i) & 1        # extract bit i from this byte (gives 0 or 1)
            top = (crc >> 15) & 1        # extract the top bit of the running checksum
            crc = (crc << 1) & 0xFFFF    # shift checksum left by 1, discard any overflow past 16 bits
            if bit ^ top:                # if the incoming bit differs from the bit we just shifted out...
                crc ^= 0x1021            # ...mix in the polynomial (the "division" step)
    return crc

# Every half-blob must end with these exact 5 bytes before the checksum.
# They were discovered by capturing real traffic from the AC; their meaning
# is not documented but the AC rejects any blob that doesn't have them.
TRAILER = bytes([0x01, 0xFF, 0xFF, 0xFF, 0xFF])

# The full blob sent to/from the AC is built from two "halves".
# Each half = 18 bytes of settings + 5 trailer bytes + 2 checksum bytes = 25 bytes total.
# This function takes a raw 18-byte half, glues on the trailer and checksum,
# and returns the finished 25-byte half.
# The checksum is stored low-byte first (called "little-endian").
def finalize(half: bytearray) -> bytes:
    data = bytes(half) + TRAILER
    crc = crc16(data)
    return data + bytes([crc & 0xFF, (crc >> 8) & 0xFF])

# --- Temperature lookup tables ---
#
# The AC doesn't send temperatures as plain numbers.
# Instead it sends a single byte (0–255) which is an index into one of
# these tables. To get the real temperature in °C, look up that index.
#
# Example: if the AC sends index 150 for indoor temp,
#   INDOOR_TEMP[150] = 25.2°C
#
# The tables were copied exactly from the official Android app source code.
# Values at the very low end repeat (e.g. many entries are -30.0) because
# the sensor can't measure below a certain point and just stays pinned there.
INDOOR_TEMP = [
    -30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,-30.0,
    -29.0,-28.0,-27.0,-26.0,-25.0,-24.0,-23.0,-22.5,-22.0,-21.0,-20.0,-19.5,-19.0,-18.0,-17.5,-17.0,
    -16.5,-16.0,-15.0,-14.5,-14.0,-13.5,-13.0,-12.5,-12.0,-11.5,-11.0,-10.5,-10.0,-9.5,-9.0,-8.6,
    -8.3,-8.0,-7.5,-7.0,-6.5,-6.0,-5.6,-5.3,-5.0,-4.5,-4.0,-3.6,-3.3,-3.0,-2.6,-2.3,
    -2.0,-1.6,-1.3,-1.0,-0.5,0.0,0.3,0.6,1.0,1.3,1.6,2.0,2.3,2.6,3.0,3.2,
    3.5,3.7,4.0,4.3,4.6,5.0,5.3,5.6,6.0,6.3,6.6,7.0,7.2,7.5,7.7,8.0,
    8.3,8.6,9.0,9.2,9.5,9.7,10.0,10.3,10.6,11.0,11.2,11.5,11.7,12.0,12.3,12.6,
    13.0,13.2,13.5,13.7,14.0,14.2,14.5,14.7,15.0,15.3,15.6,16.0,16.2,16.5,16.7,17.0,
    17.2,17.5,17.7,18.0,18.2,18.5,18.7,19.0,19.2,19.5,19.7,20.0,20.2,20.5,20.7,21.0,
    21.2,21.5,21.7,22.0,22.2,22.5,22.7,23.0,23.2,23.5,23.7,24.0,24.2,24.5,24.7,25.0,
    25.2,25.5,25.7,26.0,26.2,26.5,26.7,27.0,27.2,27.5,27.7,28.0,28.2,28.5,28.7,29.0,
    29.2,29.5,29.7,30.0,30.2,30.5,30.7,31.0,31.3,31.6,32.0,32.2,32.5,32.7,33.0,33.2,
    33.5,33.7,34.0,34.2,34.5,34.7,35.0,35.3,35.6,36.0,36.2,36.5,36.7,37.0,37.2,37.5,
    37.7,38.0,38.3,38.6,39.0,39.2,39.5,39.7,40.0,40.3,40.6,41.0,41.2,41.5,41.7,42.0,
    42.3,42.6,43.0,43.2,43.5,43.7,44.0,44.3,44.6,45.0,45.3,45.6,46.0,46.2,46.5,46.7,
    47.0,47.3,47.6,48.0,48.3,48.6,49.0,49.3,49.6,50.0,50.3,50.6,51.0,51.3,51.6,52.0,
]

OUTDOOR_TEMP = [
    -50.0,-50.0,-50.0,-50.0,-50.0,-48.9,-46.0,-44.0,-42.0,-41.0,-39.0,-38.0,-37.0,-36.0,-35.0,-34.0,
    -33.0,-32.0,-31.0,-30.0,-29.0,-28.5,-28.0,-27.0,-26.0,-25.5,-25.0,-24.0,-23.5,-23.0,-22.5,-22.0,
    -21.5,-21.0,-20.5,-20.0,-19.5,-19.0,-18.5,-18.0,-17.5,-17.0,-16.5,-16.0,-15.5,-15.0,-14.6,-14.3,
    -14.0,-13.5,-13.0,-12.6,-12.3,-12.0,-11.5,-11.0,-10.6,-10.3,-10.0,-9.6,-9.3,-9.0,-8.6,-8.3,
    -8.0,-7.6,-7.3,-7.0,-6.6,-6.3,-6.0,-5.6,-5.3,-5.0,-4.6,-4.3,-4.0,-3.7,-3.5,-3.2,
    -3.0,-2.6,-2.3,-2.0,-1.7,-1.5,-1.2,-1.0,-0.6,-0.3,0.0,0.2,0.5,0.7,1.0,1.3,
    1.6,2.0,2.2,2.5,2.7,3.0,3.2,3.5,3.7,4.0,4.2,4.5,4.7,5.0,5.2,5.5,
    5.7,6.0,6.2,6.5,6.7,7.0,7.2,7.5,7.7,8.0,8.2,8.5,8.7,9.0,9.2,9.5,
    9.7,10.0,10.2,10.5,10.7,11.0,11.2,11.5,11.7,12.0,12.2,12.5,12.7,13.0,13.2,13.5,
    13.7,14.0,14.2,14.4,14.6,14.8,15.0,15.2,15.5,15.7,16.0,16.2,16.5,16.7,17.0,17.2,
    17.5,17.7,18.0,18.2,18.5,18.7,19.0,19.2,19.4,19.6,19.8,20.0,20.2,20.5,20.7,21.0,
    21.2,21.5,21.7,22.0,22.2,22.5,22.7,23.0,23.2,23.5,23.7,24.0,24.2,24.5,24.7,25.0,
    25.2,25.5,25.7,26.0,26.2,26.5,26.7,27.0,27.2,27.5,27.7,28.0,28.2,28.5,28.7,29.0,
    29.2,29.5,29.7,30.0,30.2,30.5,30.7,31.0,31.3,31.6,32.0,32.2,32.5,32.7,33.0,33.2,
    33.5,33.7,34.0,34.3,34.6,35.0,35.2,35.5,35.7,36.0,36.3,36.6,37.0,37.2,37.5,37.7,
    38.0,38.3,38.6,39.0,39.3,39.6,40.0,40.3,40.6,41.0,41.3,41.6,42.0,42.3,42.6,43.0,
]

# --- What is the "blob"? ---
#
# The AC communicates its state as one big chunk of bytes called a "blob".
# It travels over the network encoded as base64, which is a way of turning
# arbitrary bytes into plain text characters so they can be sent in an HTTP request.
#
# After decoding from base64, the blob has this structure:
#
#   bytes  0–24  : "command half"  — what we last told the AC to do
#   bytes 25–49  : "receive half"  — what the AC is actually doing right now
#   bytes 50+    : optional sensor records (temperature readings, etc.)
#
# Each half is 18 bytes of settings + 5 trailer bytes + 2 checksum bytes = 25 bytes.
#
# We read the AC's current state from the RECEIVE half (starting at byte 25)
# because it reflects reality, not just our last command.
#
# Inside the 18-byte receive payload, each byte (or even individual bits within
# a byte) controls one setting. Here's the map:
#
#   r[2]  — packed byte containing:
#             bit 0       : power  (1 = ON, 0 = OFF)
#             bits 4,3,2  : mode   (0x00=auto, 0x08=cool, 0x10=heat, 0x0C=fan, 0x04=dry)
#             bit 6       : vertical swing is active
#   r[3]  — packed byte containing:
#             bits 3,2,1,0 : fan speed  (0x07=auto, 0x00=speed1 … 0x06=speed4)
#             bits 5,4     : vertical position when not swinging (0x00/0x10/0x20/0x30 = pos 1–4)
#   r[4]  — temperature setpoint raw value; divide by 2 to get °C
#             (e.g. raw value 44 → 44 * 0.5 = 22.0°C)
#   r[11] — horizontal position (stored as 0-based index; add 1 to display)
#   r[12] — packed byte containing:
#             bit 0 : horizontal swing is active
#             bit 2 : "entrust" mode (the AC controls everything automatically)

def decode(b64: str) -> dict:
    # base64 decode the blob into raw bytes, stripping any line breaks first
    raw = base64.b64decode(b64.replace('\n', ''))

    c = raw[:18]              # command half payload (18 bytes; not used here)
    R_OFF = 25                # receive half starts at byte 25
    r = raw[R_OFF:R_OFF + 18] # raw[25:43] — bytes 25,26,...,42 (start inclusive, end exclusive)

    # After the receive half's 18 bytes comes a count byte, then that many
    # sensor records. Each record is 4 bytes: [type_code, sub_code, value, padding].
    # We scan for the indoor and outdoor temperature records by their type codes.
    count_byte = raw[R_OFF + 18]   # how many sensor records follow
    indoor_temp = outdoor_temp = None
    for i in range(count_byte):
        base = R_OFF + 19 + i * 4              # start of this record, skip 4 bytes per sensor to grab starting byte.
        code, sub, val = raw[base], raw[base + 1], raw[base + 2]
        if code == 0x80 and sub == 0x20:       # 0x80/0x20 = indoor temp record
            indoor_temp = INDOOR_TEMP[val]     # val is an index into the lookup table
        elif code == 0x80 and sub == 0x10:     # 0x80/0x10 = outdoor temp record
            outdoor_temp = OUTDOOR_TEMP[val]

    # Extract each setting by masking the relevant bits out of the packed bytes.
    # & with a mask zeroes out all bits we don't care about, leaving only the ones we want.
    operation = 'ON' if (r[2] & 0x01) else 'OFF'   # isolate bit 0 of r[2]

    MODE_MAP_R = {0x00:'auto', 0x08:'cool', 0x10:'heat', 0x0C:'fan', 0x04:'dry'}
    mode = MODE_MAP_R.get(r[2] & 0x1C, f'?0x{r[2]&0x1C:02x}')   # 0x1C = 0b00011100 isolates bits 4,3,2

    vert_swing = bool(r[2] & 0x40)   # 0x40 = 0b01000000, isolates bit 6

    FAN_MAP_R = {0x07:'auto', 0x00:'1', 0x01:'2', 0x02:'3', 0x06:'4'}
    fan = FAN_MAP_R.get(r[3] & 0x0F, f'?0x{r[3]&0x0F:02x}')   # 0x0F = lower 4 bits

    VPOS_MAP_R = {0x00:'1', 0x10:'2', 0x20:'3', 0x30:'4'}
    wind_ud = 'swing' if vert_swing else VPOS_MAP_R.get(r[3] & 0x30, f'?0x{r[3]&0x30:02x}')

    horiz_swing = bool(r[12] & 0x01)
    wind_lr = 'swing' if horiz_swing else str(r[11] + 1)   # stored 0-based, display 1-based

    temp = r[4] * 0.5   # raw value encodes temp in 0.5°C steps
    entrust = bool(r[12] & 0x04)

    return {
        'operation'    : operation,
        'mode'         : mode,
        'temp_setpoint': f'{temp:.1f}°C',
        'fan'          : fan,
        'wind_ud'      : wind_ud,
        'wind_lr'      : wind_lr,
        'entrust'      : entrust,
        'indoor_temp'  : f'{indoor_temp:.1f}°C' if indoor_temp  is not None else '(not in blob)',
        'outdoor_temp' : f'{outdoor_temp:.1f}°C' if outdoor_temp is not None else '(not in blob)',
    }

# --- Why are there two halves (command and receive)? ---
#
# The AC protocol uses two parallel representations of the same settings.
# The "command half" uses one set of bit layouts, and the "receive half" uses
# a different set — same information, different encoding.
# The AC validates both and rejects the blob if they disagree.
# This is likely a redundancy check built into the original protocol design.
#
# This function always builds a completely fresh blob from scratch.
# It does NOT read an existing blob and patch it — it fills in two empty
# 18-byte arrays and sets every relevant bit from the parameters you pass in.
def encode(operation: int, mode: int, temp: float,
           fan: int, wind_ud: int, wind_lr: int = 1) -> str:
    """
    operation : 1=ON  0=OFF
    mode      : 0=auto 1=cool 2=heat 3=fan 4=dry
    temp      : setpoint °C (16.0-31.0 in 0.5 steps)
    fan       : 0=auto 1-4=speeds
    wind_ud   : 0=swing 1-4=positions
    wind_lr   : 0=swing 1-7=positions
    """
    # These dicts map from our simple 0–4 integers to the actual byte values
    # the AC expects in each half. The two halves use completely different codes
    # for the same settings, so there are separate tables for each.
    MODES_C = {0:0x20, 1:0x28, 2:0x30, 3:0x2C, 4:0x24}   # command half mode codes
    MODES_R = {0:0x00, 1:0x08, 2:0x10, 3:0x0C, 4:0x04}   # receive half mode codes
    FAN_C   = {0:0x0F, 1:0x08, 2:0x09, 3:0x0A, 4:0x0E}
    FAN_R   = {0:0x07, 1:0x00, 2:0x01, 3:0x02, 4:0x06}

    # Fan-only mode doesn't have a meaningful temperature, so the AC requires
    # exactly 25.0°C to be sent. Any other value causes it to behave oddly.
    tval = 25.0 if mode == 3 else temp

    # --- Build the command half ---
    # bytearray(18) creates 18 zero bytes we can fill in.
    # c[5] = 0xFF is a fixed marker byte required by the protocol.
    # We use |= (OR-assign) to set bits without clearing the ones already set.
    c = bytearray(18); c[5] = 0xFF

    # Set power bit: 0x03 = binary 11 (ON sets both bits 0 and 1), 0x02 = binary 10 (OFF)
    c[2] |= 0x03 if operation else 0x02
    c[2] |= MODES_C[mode]   # merge the mode bits into the same byte
    c[3] |= FAN_C[fan]

    # Vertical swing: 0xC0 = binary 11000000 sets bits 7 and 6 (swing on)
    # No swing: 0x80 = binary 10000000 sets only bit 7, then OR in the position code
    if wind_ud == 0:
        c[2] |= 0xC0
        c[3] |= 0x80
    else:
        c[2] |= 0x80
        c[3] |= {1:0x80, 2:0x90, 3:0xA0, 4:0xB0}[wind_ud]

    # Horizontal swing: set bits in c[12] and a base value in c[11]
    # No swing: c[11] gets a position offset (0x10 base + 0–6 for positions 1–7)
    if wind_lr == 0:
        c[12] |= 0x03
        c[11] |= 0x10
    else:
        c[12] |= 0x02
        c[11] |= {1:0x10,2:0x11,3:0x12,4:0x13,5:0x14,6:0x15,7:0x16}[wind_lr]

    c[12] |= 0x08   # fixed flag bit required in the command half

    # Temperature: multiply °C by 2 (since each step is 0.5°C), then add 128.
    # The +128 offset is specific to the command half; the receive half doesn't use it.
    c[4] = int(tval / 0.5) + 128

    # --- Build the receive half ---
    # Same settings, different bit layouts. See the decode() comments above for the map.
    r = bytearray(18); r[5] = 0xFF

    r[2] |= 0x01 if operation else 0x00   # power is just bit 0 here (no second bit)
    r[2] |= MODES_R[mode]
    r[3] |= FAN_R[fan]

    if wind_ud == 0:
        r[2] |= 0x40   # bit 6 = swing active
    else:
        r[3] |= {1:0x00, 2:0x10, 3:0x20, 4:0x30}[wind_ud]   # upper nibble of r[3]

    if wind_lr == 0:
        r[12] |= 0x01   # bit 0 = horizontal swing active
    else:
        r[11] |= (wind_lr - 1)   # 0-based index (position 1 → 0, position 7 → 6)

    r[4] = int(tval / 0.5)   # no +128 offset in the receive half

    # Finalize both halves (append trailer + checksum), concatenate them,
    # then base64-encode the result into a plain text string.
    return base64.b64encode(finalize(c) + finalize(r)).decode()


if __name__ == '__main__':
    blob = "AACij6r/AAAAAAATigAAAAAAAf////8ZR4EEAAcqogAAiAAAAwAAAAAAAAOAIKL/gBDP/5QQAAA2cg=="
    print("=== decode ===")
    print(json.dumps(decode(blob), indent=2))

    # encode(operation, mode, temp, fan, wind_ud, wind_lr)
    #
    # operation : 1=ON, 0=OFF
    # mode      : 0=auto, 1=cool, 2=heat, 3=fan, 4=dry
    # temp      : 16.0–31.0 in 0.5 steps (ignored in fan mode, forced to 25.0)
    # fan       : 0=auto, 1=slow, 2=med-slow, 3=med-fast, 4=fast
    # wind_ud   : 0=swing, 1=top, 2=mid-top, 3=mid-bot, 4=bottom
    # wind_lr   : 0=swing, 1–7=positions left to right
    #
    # Examples:
    #   encode(1, 0, 21.0, 0, 0, 0)   # ON, auto, 21°C, fan auto, both swing
    #   encode(0, 0, 21.0, 0, 0, 0)   # OFF, everything else same
    #   encode(1, 1, 22.0, 2, 3, 0)   # ON, cool, 22°C, fan med-slow, vert mid-bot, horiz swing
    #   encode(1, 2, 20.0, 1, 4, 4)   # ON, heat, 20°C, fan slow, vert bottom, horiz pos 4
    b64 = encode(operation=1, mode=0, temp=21.0, fan=0, wind_ud=1, wind_lr=4)
    print(b64)
    print(json.dumps(decode(b64), indent=2))
