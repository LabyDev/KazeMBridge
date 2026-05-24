import base64, json

def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        for i in range(7, -1, -1):
            bit = (byte >> i) & 1
            top = (crc >> 15) & 1
            crc = (crc << 1) & 0xFFFF
            if bit ^ top:
                crc ^= 0x1021
    return crc

TRAILER = bytes([0x01, 0xFF, 0xFF, 0xFF, 0xFF])

def finalize(half: bytearray) -> bytes:
    data = bytes(half) + TRAILER
    crc = crc16(data)
    return data + bytes([crc & 0xFF, (crc >> 8) & 0xFF])

INDOOR_TEMP  = [-30.0] * 16 + [round(-30.0 + (i - 15) * 0.5, 1) for i in range(16, 256)]
OUTDOOR_TEMP = [-50.0] * 5  + [round(-50.0 + (i -  4) * 0.5, 1) for i in range(5,  256)]

def decode(b64: str) -> dict:
    raw = base64.b64decode(b64.replace('\n', ''))

    # Command half bytes 0-17
    c = raw[:18]
    # Receive half starts at byte 25
    R_OFF = 25
    r = raw[R_OFF:R_OFF + 18]

    # Extension tuples
    count_byte = raw[R_OFF + 18]
    indoor_temp = outdoor_temp = None
    for i in range(count_byte):
        base = R_OFF + 19 + i * 4
        code, sub, val = raw[base], raw[base + 1], raw[base + 2]
        if code == 0x80 and sub == 0x20:
            indoor_temp = INDOOR_TEMP[val]
        elif code == 0x80 and sub == 0x10:
            outdoor_temp = OUTDOOR_TEMP[val]

    # Decode from RECEIVE half (r) using receive-half maps from decompiled source
    # operation: r[2] bit 0
    operation = 'ON' if (r[2] & 0x01) else 'OFF'

    # mode: r[2] bits 2-4 (om_n_* arrays)
    MODE_MAP_R = {0x00:'auto', 0x08:'cool', 0x10:'heat', 0x0C:'fan', 0x04:'dry'}
    mode = MODE_MAP_R.get(r[2] & 0x1C, f'?0x{r[2]&0x1C:02x}')

    # vert swing: r[2] bit 6 (as_n_on = 64)
    vert_swing = bool(r[2] & 0x40)

    # fan: r[3] low nibble (af_n_* arrays)
    FAN_MAP_R = {0x07:'auto', 0x00:'1', 0x01:'2', 0x02:'3', 0x06:'4'}
    fan = FAN_MAP_R.get(r[3] & 0x0F, f'?0x{r[3]&0x0F:02x}')

    # vert position: r[3] high nibble (lv_n_* arrays)
    VPOS_MAP_R = {0x00:'1', 0x10:'2', 0x20:'3', 0x30:'4'}
    wind_ud = 'swing' if vert_swing else VPOS_MAP_R.get(r[3] & 0x30, f'?0x{r[3]&0x30:02x}')

    # horiz swing: r[12] bit 0 (av_n_on = {0,0,0,0,0,0,0,0,0,0,0,0,1,...})
    horiz_swing = bool(r[12] & 0x01)

    # horiz position: r[11] direct 0-6 = positions 1-7 (lh_n_* arrays)
    wind_lr = 'swing' if horiz_swing else str(r[11] + 1)

    # temp: r[4] = int(temp / 0.5) so temp = r[4] * 0.5
    temp = r[4] * 0.5

    # entrust: r[12] bit 2 (en_n_on = {0,0,0,0,0,0,0,0,0,0,0,0,4,...})
    entrust = bool(r[12] & 0x04)

    return {
        'operation'   : operation,
        'mode'        : mode,
        'temp_setpoint': f'{temp:.1f}°C',
        'fan'         : fan,
        'wind_ud'     : wind_ud,
        'wind_lr'     : wind_lr,
        'entrust'     : entrust,
        'indoor_temp' : f'{indoor_temp:.1f}°C' if indoor_temp is not None else '(not in blob)',
        'outdoor_temp': f'{outdoor_temp:.1f}°C' if outdoor_temp is not None else '(not in blob)',
    }

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
    # From commandToByte — om_p_* arrays
    MODES_C = {0:0x20, 1:0x28, 2:0x30, 3:0x2C, 4:0x24}
    # From receiveToByte — om_n_* arrays
    MODES_R = {0:0x00, 1:0x08, 2:0x10, 3:0x0C, 4:0x04}
    # af_p_* arrays
    FAN_C   = {0:0x0F, 1:0x08, 2:0x09, 3:0x0A, 4:0x0E}
    # af_n_* arrays
    FAN_R   = {0:0x07, 1:0x00, 2:0x01, 3:0x02, 4:0x06}

    tval = 25.0 if mode == 3 else temp

    # Command half — init from command_init: byte 5 = 0xFF
    c = bytearray(18); c[5] = 0xFF
    c[2] |= 0x03 if operation else 0x02   # op_p_on/of
    c[2] |= MODES_C[mode]
    c[3] |= FAN_C[fan]

    # wind_ud: as_p_on=192, as_p_of=128; lv_p_* in byte 3 high nibble
    if wind_ud == 0:
        c[2] |= 0xC0                       # as_p_on
        c[3] |= 0x80                       # lv_p_01 (default pos with swing)
    else:
        c[2] |= 0x80                       # as_p_of
        c[3] |= {1:0x80, 2:0x90, 3:0xA0, 4:0xB0}[wind_ud]

    # wind_lr: av_p_on=3, av_p_of=2 in byte 12; lh_p_* in byte 11
    if wind_lr == 0:
        c[12] |= 0x03                      # av_p_on
        c[11] |= 0x10                      # lh_p_01
    else:
        c[12] |= 0x02                      # av_p_of
        c[11] |= {1:0x10,2:0x11,3:0x12,4:0x13,5:0x14,6:0x15,7:0x16}[wind_lr]

    c[12] |= 0x08                          # en_p_of
    c[4]   = int(tval / 0.5) + 128

    # Receive half — init from receive_init: byte 5 = 0xFF
    r = bytearray(18); r[5] = 0xFF
    r[2] |= 0x01 if operation else 0x00   # op_n_on/of
    r[2] |= MODES_R[mode]
    r[3] |= FAN_R[fan]

    # wind_ud: as_n_on=64; lv_n_* in byte 3 high nibble
    if wind_ud == 0:
        r[2] |= 0x40                       # as_n_on
        r[3] |= 0x00                       # lv_n_01
    else:
        r[3] |= {1:0x00, 2:0x10, 3:0x20, 4:0x30}[wind_ud]

    # wind_lr: av_n_on byte12=1; lh_n_* in byte 11 (0-indexed)
    if wind_lr == 0:
        r[12] |= 0x01                      # av_n_on
        r[11] |= 0x00                      # lh_n_01
    else:
        r[12] |= 0x00
        r[11] |= (wind_lr - 1)

    r[4] = int(tval / 0.5)

    return base64.b64encode(finalize(c) + finalize(r)).decode()


if __name__ == '__main__':
    blob = "AAcAEjD/AACAAAACAAAAAAAAAf/////R/IEEAQcqowAAiAAAAwAAAAAAAAOAIKP/gBDT/5QQAADX/g=="
    print("=== decode ===")
    print(json.dumps(decode(blob), indent=2))

    print("\n=== encode (auto, 21°C, fan auto, swing vert, swing horiz) ===")
    b64 = encode(operation=1, mode=0, temp=21.0, fan=0, wind_ud=0, wind_lr=0)
    print(b64)
    print(json.dumps(decode(b64), indent=2))