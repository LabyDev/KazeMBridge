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

# Exact lookup tables from res/values/arrays.xml
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

def decode(b64: str) -> dict:
    raw = base64.b64decode(b64.replace('\n', ''))
    c = raw[:18]
    R_OFF = 25
    r = raw[R_OFF:R_OFF + 18]

    count_byte = raw[R_OFF + 18]
    indoor_temp = outdoor_temp = None
    for i in range(count_byte):
        base = R_OFF + 19 + i * 4
        code, sub, val = raw[base], raw[base + 1], raw[base + 2]
        if code == 0x80 and sub == 0x20:
            indoor_temp = INDOOR_TEMP[val]
        elif code == 0x80 and sub == 0x10:
            outdoor_temp = OUTDOOR_TEMP[val]

    operation = 'ON' if (r[2] & 0x01) else 'OFF'
    MODE_MAP_R = {0x00:'auto', 0x08:'cool', 0x10:'heat', 0x0C:'fan', 0x04:'dry'}
    mode = MODE_MAP_R.get(r[2] & 0x1C, f'?0x{r[2]&0x1C:02x}')
    vert_swing = bool(r[2] & 0x40)
    FAN_MAP_R = {0x07:'auto', 0x00:'1', 0x01:'2', 0x02:'3', 0x06:'4'}
    fan = FAN_MAP_R.get(r[3] & 0x0F, f'?0x{r[3]&0x0F:02x}')
    VPOS_MAP_R = {0x00:'1', 0x10:'2', 0x20:'3', 0x30:'4'}
    wind_ud = 'swing' if vert_swing else VPOS_MAP_R.get(r[3] & 0x30, f'?0x{r[3]&0x30:02x}')
    horiz_swing = bool(r[12] & 0x01)
    wind_lr = 'swing' if horiz_swing else str(r[11] + 1)
    temp = r[4] * 0.5
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
    MODES_C = {0:0x20, 1:0x28, 2:0x30, 3:0x2C, 4:0x24}
    MODES_R = {0:0x00, 1:0x08, 2:0x10, 3:0x0C, 4:0x04}
    FAN_C   = {0:0x0F, 1:0x08, 2:0x09, 3:0x0A, 4:0x0E}
    FAN_R   = {0:0x07, 1:0x00, 2:0x01, 3:0x02, 4:0x06}

    tval = 25.0 if mode == 3 else temp

    c = bytearray(18); c[5] = 0xFF
    c[2] |= 0x03 if operation else 0x02
    c[2] |= MODES_C[mode]
    c[3] |= FAN_C[fan]
    if wind_ud == 0:
        c[2] |= 0xC0
        c[3] |= 0x80
    else:
        c[2] |= 0x80
        c[3] |= {1:0x80, 2:0x90, 3:0xA0, 4:0xB0}[wind_ud]
    if wind_lr == 0:
        c[12] |= 0x03
        c[11] |= 0x10
    else:
        c[12] |= 0x02
        c[11] |= {1:0x10,2:0x11,3:0x12,4:0x13,5:0x14,6:0x15,7:0x16}[wind_lr]
    c[12] |= 0x08
    c[4]   = int(tval / 0.5) + 128

    r = bytearray(18); r[5] = 0xFF
    r[2] |= 0x01 if operation else 0x00
    r[2] |= MODES_R[mode]
    r[3] |= FAN_R[fan]
    if wind_ud == 0:
        r[2] |= 0x40
    else:
        r[3] |= {1:0x00, 2:0x10, 3:0x20, 4:0x30}[wind_ud]
    if wind_lr == 0:
        r[12] |= 0x01
    else:
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