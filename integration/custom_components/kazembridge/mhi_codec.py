"""Binary codec for the MHI WF-RAC airconStat blob.

The AC communicates its state as a single chunk of bytes called a "blob".
It travels over HTTPS encoded as base64 so it can be embedded in JSON.

Blob layout after base64-decoding:

    bytes  0–24  : command half  — the settings we last sent to the AC
    bytes 25–49  : receive half  — what the AC is actually doing right now
    bytes 50+    : sensor extension records (temperature readings, etc.)

Each half is 18 bytes of settings + a trailer + a 2-byte CRC checksum.

We always READ state from the RECEIVE half (starting at byte 25) because
it reflects reality, not just our last command.

The command half and receive half use DIFFERENT encodings for the same
settings — do not mix them up. See the byte maps in encode() and decode().
"""

import base64


# ─── Background: binary arithmetic ────────────────────────────────────────────
#
# A "byte" holds 8 bits, so it can store values 0–255.  "Hex" (base-16) is a
# compact notation: 0xFF = 255 = 0b11111111 in binary.
#
# Bit shifting:
#   x >> 1  moves all bits one place right  = integer divide by 2
#   x << 1  moves all bits one place left   = multiply by 2
#
# Bitwise AND (&) — isolate ("mask") specific bits:
#   0b10110110 & 0b00001111 = 0b00000110   (keeps only the lower 4 bits)
#
# Bitwise OR (|) — merge bits from two values:
#   0b00000001 | 0b00000100 = 0b00000101
#
# Bitwise XOR (^) — 1 if the two input bits differ, 0 if they match.
#   Used in checksums because flipping any bit produces a completely
#   different output, making corruption easy to detect.


# ─── CRC-16/CCITT ─────────────────────────────────────────────────────────────
#
# When the AC receives a blob it recalculates this checksum and rejects the
# message if it doesn't match, catching any corruption in transit.
#
# The algorithm treats the whole message as a very large binary number and
# divides it by the fixed polynomial 0x1021.  The remainder is the checksum.
# The loop below does that division one bit at a time:
#
#   - Start with crc = 0xFFFF (all 1s) as the running remainder.
#   - For each bit in the data:
#       1. Shift the remainder left by 1 (advancing one "digit" in the division).
#       2. If the bit that dropped off the top differs from the incoming data bit,
#          XOR the polynomial into the remainder.  This is the "subtract divisor"
#          step in standard long division, done in binary.
#   - Whatever remains after all bits is the checksum.
#
# Worked example — first two iterations processing byte 0x01 (0b00000001):
#
#   crc starts as: 1111111111111111  (0xFFFF)
#
#   i=7:  data_bit = (0x01 >> 7) & 1 = 0       ← bit 7 of 0x01 is 0
#         top_bit  = (0xFFFF >> 15) & 1 = 1    ← top bit of crc is 1
#         crc = (0xFFFF << 1) & 0xFFFF = 0xFFFE
#         data_bit ^ top_bit = 0^1 = 1 → they differ, apply polynomial:
#         crc = 0xFFFE ^ 0x1021 = 0xEFDF
#
#   i=6:  data_bit = (0x01 >> 6) & 1 = 0
#         top_bit  = (0xEFDF >> 15) & 1 = 1
#         crc = (0xEFDF << 1) & 0xFFFF = 0xDFBE
#         crc = 0xDFBE ^ 0x1021 = 0xCF9F
#
#   …continues for all 8 bits of each byte, then repeats for every byte.
def crc16(data: bytes) -> int:
    """Calculate CRC-16/CCITT checksum over the given bytes."""
    crc = 0xFFFF
    for byte in data:
        for bit_index in range(7, -1, -1):          # MSB first
            data_bit = (byte >> bit_index) & 1      # extract one bit from this byte
            top_bit  = (crc >> 15) & 1              # top bit of the running checksum
            crc = (crc << 1) & 0xFFFF               # shift left, discard overflow past 16 bits
            if data_bit ^ top_bit:                  # if bits differ, mix in the polynomial
                crc ^= 0x1021
    return crc


# ─── Blob finalisation ─────────────────────────────────────────────────────────
#
# Each 18-byte half gets these 5 "magic" trailer bytes appended before the CRC.
# Their meaning is undocumented but the AC rejects any blob that omits them.
_TRAILER = bytes([0x01, 0xFF, 0xFF, 0xFF, 0xFF])


def _finalize_half(payload: bytearray) -> bytes:
    """Append the fixed trailer + little-endian CRC to a raw 18-byte payload.

    Returns the finished 25-byte half ready to be concatenated into the blob.
    The CRC covers all 23 bytes (payload + trailer) and is stored low-byte first.
    """
    data_with_trailer = bytes(payload) + _TRAILER
    checksum = crc16(data_with_trailer)
    return data_with_trailer + bytes([checksum & 0xFF, (checksum >> 8) & 0xFF])


# ─── Temperature lookup tables ─────────────────────────────────────────────────
#
# The AC does not send temperatures as plain numbers. It sends a single byte
# (0–255) which is an index into one of these tables. Look up the index to get
# the real temperature in °C.
#
# Example: if the AC sends index 150 for indoor temp, INDOOR_TEMP[150] = 22.7°C.
#
# These tables are copied verbatim from the official Android app (arrays.xml).
# The low end repeats (e.g. many entries are −30.0) because the sensor clamps
# there when the temperature is below its measurable range.
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


# ─── Decode ────────────────────────────────────────────────────────────────────

def decode(base64_blob: str) -> dict:
    """Decode a base64 airconStat blob into a plain Python dict.

    Reads exclusively from the RECEIVE half (bytes 25–42) because it
    reflects what the AC is actually doing, not what we last commanded.

    Sensor extension tuples (temperature readings) are parsed from the
    variable-length section that follows the receive half's 18-byte payload.

    Returns a dict with keys:
        operation     : bool — True = on
        mode          : int  — 0=auto 1=cool 2=heat 3=fan 4=dry
        temp_setpoint : float — °C
        fan           : int  — 0=auto 1-4=speeds
        wind_ud       : int  — 0=swing 1-4=positions
        wind_lr       : int  — 0=swing 1-7=positions
        entrust       : bool — True = 3D auto mode
        model_type    : int  — 0=Separate2021 1=Global2022 2=HighEndJP2023 …
        indoor_temp   : float | None
        outdoor_temp  : float | None
    """
    raw_bytes = base64.b64decode(base64_blob.replace('\n', ''))

    # The receive half starts at byte 25 and its settings payload is 18 bytes.
    RECEIVE_HALF_OFFSET = 25
    receive_half = raw_bytes[RECEIVE_HALF_OFFSET : RECEIVE_HALF_OFFSET + 18]

    # ── Sensor extension records ────────────────────────────────────────────
    # Immediately after the 18-byte receive payload comes a count byte, then
    # that many 4-byte sensor records: [type_code, sub_code, value, 0xFF].
    # We scan for temperature records by their type + sub_code combination.
    sensor_record_count = raw_bytes[RECEIVE_HALF_OFFSET + 18]
    indoor_temp = None
    outdoor_temp = None
    for sensor_index in range(sensor_record_count):
        record_offset  = RECEIVE_HALF_OFFSET + 19 + sensor_index * 4
        record_type    = raw_bytes[record_offset]
        record_subtype = raw_bytes[record_offset + 1]
        raw_value      = raw_bytes[record_offset + 2]
        if record_type == 0x80 and record_subtype == 0x20:   # indoor temperature
            indoor_temp = INDOOR_TEMP[raw_value]
        elif record_type == 0x80 and record_subtype == 0x10: # outdoor temperature
            outdoor_temp = OUTDOOR_TEMP[raw_value]

    # ── Receive half byte map ───────────────────────────────────────────────
    #
    # receive_half[0]  — model type (same constants as command half byte 0)
    # receive_half[2]  — packed: bit0=power, bits2-4=mode, bit6=vertical swing active
    # receive_half[3]  — packed: bits0-3=fan speed, bits4-7=vertical position
    # receive_half[4]  — temperature setpoint raw (divide by 2 for °C, no +128 offset)
    # receive_half[11] — horizontal position (0-based; command half is 1-based)
    # receive_half[12] — packed: bit0=horizontal swing active, bit2=entrust (3D auto)
    #
    # The receive half uses DIFFERENT bit values than the command half for
    # operation, mode, fan speed, and positions. Never use command-half
    # constants to decode the receive half.

    # Byte 0 — model type; bit 7 is a status flag, model ID is bits 0-6.
    model_type = receive_half[0] & 0x7F

    # Byte 2, bit 0 — power (1=ON, 0=OFF).
    is_on = bool(receive_half[2] & 0x01)

    # Byte 2, bits 2-4 — operation mode.
    # 0x1C = 0b00011100 isolates bits 4, 3, 2.
    RECEIVE_MODE_MAP = {0x00: 0, 0x08: 1, 0x10: 2, 0x0C: 3, 0x04: 4}
    mode = RECEIVE_MODE_MAP.get(receive_half[2] & 0x1C, 0)

    # Byte 2, bit 6 — vertical swing.  0x40 = 0b01000000.
    vertical_swing_active = bool(receive_half[2] & 0x40)

    # Byte 3, bits 0-3 — fan speed.  0x0F isolates the lower nibble.
    RECEIVE_FAN_MAP = {0x07: 0, 0x00: 1, 0x01: 2, 0x02: 3, 0x06: 4}
    fan_speed = RECEIVE_FAN_MAP.get(receive_half[3] & 0x0F, 0)

    # Byte 3, bits 4-7 — vertical vane position (when swing is off).
    # 0x30 = 0b00110000 isolates bits 5 and 4.
    RECEIVE_VPOS_MAP = {0x00: 1, 0x10: 2, 0x20: 3, 0x30: 4}
    vertical_position = 0 if vertical_swing_active else RECEIVE_VPOS_MAP.get(receive_half[3] & 0x30, 1)

    # Byte 4 — temperature setpoint.  No +128 offset here (only in command half).
    temp_setpoint = receive_half[4] * 0.5

    # Byte 11 — horizontal position, stored 0-based in receive half.
    # Byte 12, bit 0 — horizontal swing.
    horizontal_swing_active = bool(receive_half[12] & 0x01)
    horizontal_position = 0 if horizontal_swing_active else receive_half[11] + 1

    # Byte 12, bit 2 — entrust / 3D auto mode.
    entrust_active = bool(receive_half[12] & 0x04)

    return {
        "operation":     is_on,
        "mode":          mode,
        "temp_setpoint": temp_setpoint,
        "fan":           fan_speed,
        "wind_ud":       vertical_position,
        "wind_lr":       horizontal_position,
        "entrust":       entrust_active,
        "model_type":    model_type,
        "indoor_temp":   indoor_temp,
        "outdoor_temp":  outdoor_temp,
    }


# ─── Encode ────────────────────────────────────────────────────────────────────
#
# Why are there two halves (command and receive)?
#
# The AC protocol uses two parallel representations of the same settings with
# different bit layouts.  The AC validates both and rejects the blob if they
# disagree — this is a redundancy check built into the protocol.
#
# This function always builds a completely fresh blob from scratch using two
# empty 18-byte arrays.  It does NOT read an existing blob and patch it.
# That approach avoids accidentally preserving stale bits from a previous state.

def encode(
    operation: int,
    mode: int,
    temp: float,
    fan: int,
    wind_ud: int,
    wind_lr: int = 1,
    entrust: int = 0,
    model_type: int = 0,
) -> str:
    """Encode AC settings into a base64 airconStat blob.

    Parameters
    ----------
    operation  : 1 = ON, 0 = OFF
    mode       : 0=auto 1=cool 2=heat 3=fan_only 4=dry
    temp       : setpoint °C, 16.0–31.0 in 0.5° steps
                 (fan_only forces 25.0 regardless of this value)
    fan        : 0=auto 1-4=speeds
    wind_ud    : 0=swing 1-4=fixed positions (top to bottom)
    wind_lr    : 0=swing 1-7=fixed positions (left to right)
    entrust    : 1 = 3D auto mode on, 0 = off
    model_type : adapter model constant (0=Separate2021, 1=Global2022, …)
                 Read from the last receive half and echoed back so the AC
                 recognises its own model.  The command half byte 0 is always
                 0x00 regardless of model (per protocol spec).

    Returns
    -------
    str — base64-encoded blob ready to send to setAirconStat.
    """

    # ── Command half encoding tables ────────────────────────────────────────
    # Each dict maps from our simple integer to the byte value the AC expects
    # in the COMMAND half.  The receive half uses completely different values.
    COMMAND_MODE_MAP = {0: 0x20, 1: 0x28, 2: 0x30, 3: 0x2C, 4: 0x24}
    COMMAND_FAN_MAP  = {0: 0x0F, 1: 0x08, 2: 0x09, 3: 0x0A, 4: 0x0E}

    # Fan-only mode has no meaningful temperature concept.  The AC requires
    # exactly 25.0°C in that case; any other value produces odd behaviour.
    effective_temp = 25.0 if mode == 3 else temp

    # ── Build the command half ──────────────────────────────────────────────
    # bytearray(18) starts as 18 zero bytes.
    # Byte 5 is a fixed protocol marker (always 0xFF).
    # Byte 0 is always 0x00 in the command half regardless of model type.
    # Use |= (OR-assign) to set bits without disturbing bits set by earlier lines.
    command_half = bytearray(18)
    command_half[5] = 0xFF   # fixed protocol marker

    # Byte 2 — power (bits 0-1).
    # ON sets both bits (0x03 = 0b00000011); OFF sets only bit 1 (0x02 = 0b00000010).
    command_half[2] |= 0x03 if operation else 0x02
    # Byte 2 — mode (bits 2-5).
    command_half[2] |= COMMAND_MODE_MAP[mode]
    # Byte 3 — fan speed (lower nibble).
    command_half[3] |= COMMAND_FAN_MAP[fan]

    # Vertical vane.
    # Swing ON: set bits 7 and 6 in byte 2 (0xC0), then also write position 1
    # (0x80) into byte 3.  The AC requires the position bits even during swing —
    # omitting them causes result=12 (operation prohibited).
    # Swing OFF: set only bit 7 in byte 2 (0x80), then write the position into
    # the upper nibble of byte 3.
    if wind_ud == 0:   # swing
        command_half[2] |= 0xC0
        command_half[3] |= 0x80   # position 1 alongside swing-on flag (required)
    else:
        COMMAND_VPOS_MAP = {1: 0x80, 2: 0x90, 3: 0xA0, 4: 0xB0}
        command_half[2] |= 0x80
        command_half[3] |= COMMAND_VPOS_MAP[wind_ud]

    # Horizontal vane.
    # Swing ON: bits 0-1 in byte 12 = 0x03, also write position 1 (0x10) into
    # byte 11.  Same "position required alongside swing" rule as vertical.
    # Swing OFF: bits 0-1 in byte 12 = 0x02, write the position into byte 11.
    if wind_lr == 0:   # swing
        command_half[12] |= 0x03
        command_half[11] |= 0x10   # position 1 alongside swing-on flag (required)
    else:
        COMMAND_HPOS_MAP = {1: 0x10, 2: 0x11, 3: 0x12, 4: 0x13, 5: 0x14, 6: 0x15, 7: 0x16}
        command_half[12] |= 0x02
        command_half[11] |= COMMAND_HPOS_MAP[wind_lr]

    # Entrust (3D auto).  Command half: 0x0C = on, 0x08 = off.
    command_half[12] |= 0x0C if entrust else 0x08

    # Temperature: multiply °C by 2 (one step = 0.5°C), then add 128.
    # The +128 offset is specific to the command half; receive half omits it.
    command_half[4] = int(effective_temp / 0.5) + 128

    # ── Build the receive half ──────────────────────────────────────────────
    # Same settings, different bit layouts.  See decode() comments for the map.
    RECEIVE_MODE_MAP = {0: 0x00, 1: 0x08, 2: 0x10, 3: 0x0C, 4: 0x04}
    RECEIVE_FAN_MAP  = {0: 0x07, 1: 0x00, 2: 0x01, 3: 0x02, 4: 0x06}

    receive_half = bytearray(18)
    receive_half[5] = 0xFF

    # Byte 0 — model type.  Echoed from the last known receive half so the AC
    # recognises its own model and enables the right features.
    receive_half[0] = model_type

    # Byte 2 — power (bit 0 only; the command half uses two bits for this).
    receive_half[2] |= 0x01 if operation else 0x00
    receive_half[2] |= RECEIVE_MODE_MAP[mode]
    receive_half[3] |= RECEIVE_FAN_MAP[fan]

    if wind_ud == 0:   # swing
        receive_half[2] |= 0x40   # bit 6 = vertical swing active
    else:
        RECEIVE_VPOS_MAP = {1: 0x00, 2: 0x10, 3: 0x20, 4: 0x30}
        receive_half[3] |= RECEIVE_VPOS_MAP[wind_ud]

    if wind_lr == 0:   # swing
        receive_half[12] |= 0x01   # bit 0 = horizontal swing active
    else:
        receive_half[11] |= wind_lr - 1   # 0-based: position 1 → 0, position 7 → 6

    # Entrust (3D auto).  Receive half: 0x04 = on, 0x00 = off.
    # Note: different encoding from the command half (0x0C/0x08).
    receive_half[12] |= 0x04 if entrust else 0x00

    # Temperature: no +128 offset in the receive half.
    receive_half[4] = int(effective_temp / 0.5)

    # ── Assemble and encode ─────────────────────────────────────────────────
    encoded_blob = base64.b64encode(_finalize_half(command_half) + _finalize_half(receive_half))
    return encoded_blob.decode()
