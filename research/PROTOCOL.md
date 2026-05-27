# MHI WF-RAC Local API — Protocol Reference

Extracted from decompiled SmartM-Air APK (`AirconStatCoder.smali`).  
Source: `research/captures/smartmair_decoded/smali_classes2/jp/co/mhi_mth/smartmair/util/AirconStatCoder.smali`

---

## Blob structure

`airconStat` (sent and received) is:

```
base64( command_half + receive_half )
```

Each half = 18-byte payload + 5-byte trailer + 2-byte CRC16 = **25 bytes**.

Full blob = 50 bytes → 68-character base64 string.

### Trailer

```
[0x01, 0xFF, 0xFF, 0xFF, 0xFF]
```

### CRC16

CCITT, init `0xFFFF`, poly `0x1021`, MSB-first bit order.  
Appended little-endian (low byte first, high byte second) after the trailer.

---

## Initialization

Both halves start from all-zeros **except byte 5 = `0xFF`**:

```
command_init = [0,0,0,0,0,0xFF,0,0,0,0,0,0,0,0,0,0,0,0]
receive_init = [0,0,0,0,0,0xFF,0,0,0,0,0,0,0,0,0,0,0,0]
```

All field masks are OR'd onto this base.

---

## Command half — byte map (18 bytes)

| Byte | Field               | Values (OR masks)                                                                                                             |
| ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0    | Model type          | See model table below                                                                                                         |
| 2    | Operation           | `0x03`=ON, `0x02`=OFF                                                                                                         |
| 2    | Mode                | `0x20`=Auto, `0x28`=Cool, `0x30`=Heat, `0x2C`=Fan, `0x24`=Dry                                                                 |
| 2    | Vertical swing      | `0xC0`=ON (swing active), `0x80`=OFF (position mode)                                                                          |
| 3    | Fan speed           | `0x0F`=Auto, `0x08`=Spd1, `0x09`=Spd2, `0x0A`=Spd3, `0x0E`=Spd4                                                               |
| 3    | Vertical position   | `0x80`=Pos1, `0x90`=Pos2, `0xA0`=Pos3, `0xB0`=Pos4 — **always write a position, even during swing** (use `0x80` when swing ON) |
| 4    | Temperature         | `int(temp_°C / 0.5) + 128` — range 16-31°C in 0.5° steps                                                                       |
| 5    | Always              | `0xFF` (from init)                                                                                                               |
| 9    | Preset temp auto    | `0x01`=ON, `0x00`=OFF (only FDT2023)                                                                                             |
| 10   | Vacant property     | `0x01`=ON (only Global2022, ZT2025)                                                                                              |
| 10   | Self-clean reset    | `0x04`=ON (only Global2022, HighEnd2023, ZT2025)                                                                                 |
| 11   | Horizontal position | `0x10`=Pos1(Normal), `0x11`=Pos2, `0x12`=Pos3, `0x13`=Pos4, `0x14`=Pos5, `0x15`=Pos6, `0x16`=Pos7 — **always write a position, even during h-swing** (use `0x10` when swing ON) |
| 12   | Horizontal swing    | `0x03`=ON (swing active), `0x02`=OFF (position mode)                                                                            |
| 12   | Entrust / 3D Auto   | `0x0C`=ON, `0x08`=OFF                                                                                                           |
| 12   | Self-clean op       | **Always OR `0x80`** (OFF state). `0x90`=ON (only Global2022, HighEnd2023, ZT2025)                                              |

> **Critical:** byte 12 bit 7 (`0x80`) must ALWAYS be set (it is the "self-clean OFF" pattern). Omitting it causes the AC to return result=12 (abnormal state).
>
> **Critical:** Always write a position value in byte 3 (vertical) and byte 11 (horizontal), even when swing is ON. When activating swing, write Pos1 (`0x80` for byte 3, `0x10` for byte 11). Confirmed by `AirconStatCoder.smali`: `commandToByte` always applies `lv_p_01` after `as_p_on`, and `lh_p_01` after `av_p_on`.

---

## Receive half — byte map (18 bytes)

Different encoding from command half. Decoded by reading `getAirconStat` response.

| Byte | Field               | Values                                                                                |
| ---- | ------------------- | ------------------------------------------------------------------------------------- |
| 0    | Model type          | Same as command half                                                                  |
| 2    | Operation           | bit 0: `0x01`=ON, `0x00`=OFF                                                          |
| 2    | Mode                | bits 2-4: `0x00`=Auto, `0x08`=Cool, `0x10`=Heat, `0x0C`=Fan, `0x04`=Dry               |
| 2    | Vertical swing      | bit 6: `0x40`=swing ON                                                                |
| 3    | Fan speed           | low nibble: `0x07`=Auto, `0x00`=Spd1, `0x01`=Spd2, `0x02`=Spd3, `0x06`=Spd4           |
| 3    | Vertical position   | high nibble: `0x00`=Pos1, `0x10`=Pos2, `0x20`=Pos3, `0x30`=Pos4 — only when swing OFF |
| 4    | Temperature         | `int(temp_°C / 0.5)` — no offset                                                      |
| 5    | Always              | `0xFF`                                                                                |
| 6    | Error code          | See error encoding below                                                              |
| 7    | Preset temp auto    | `0x80`=ON (only FDT2023)                                                              |
| 10   | Vacant property     | `0x01`=ON                                                                             |
| 11   | Horizontal position | 0-indexed: `0x00`=Pos1, `0x01`=Pos2, ... `0x06`=Pos7 — only when h-swing OFF          |
| 12   | Horizontal swing    | bit 0: `0x01`=swing ON                                                                |
| 12   | Entrust / 3D Auto   | bit 2: `0x04`=ON                                                                      |
| 15   | Self-clean status   | `0x01`=ON                                                                             |

### Error code encoding (receive byte 6)

- `0x00` → no error
- `0x01`–`0x7F` → `E##` normal error (value = error number)
- `0x80`–`0xFF` → `M##` maintenance error (value & 0x7F = error number)

---

## Extension tuples (receive half sensor data)

After the 18-byte receive payload, the blob continues with:

```
[count_byte] [tuple_0] [tuple_1] ... [tuple_N-1]
```

Each tuple = 4 bytes: `[code, sub_code, value, 0xFF]`

| Code   | Sub    | Meaning                                           |
| ------ | ------ | ------------------------------------------------- |
| `0x80` | `0x20` | Indoor temperature — index into `INDOOR_TEMP[]`   |
| `0x80` | `0x10` | Outdoor temperature — index into `OUTDOOR_TEMP[]` |

---

## Model type byte (byte 0)

### Receive half (decode only)

The device reports model type in byte 0 of the **receive half** only. The value must be AND-masked with `0x7F` to get the actual type — bit 7 is a device flag, not part of the model ID:

```
model_type = receive_byte_0 & 0x7F
```

| Value  | Model            |
| ------ | ---------------- |
| `0x00` | Separate 2021    |
| `0x01` | Global 2022      |
| `0x02` | High-end JP 2023 |
| `0x03` | ZT 2025          |
| `0x40` | FDT 2023         |

### Command half (encode)

> **Critical:** byte 0 of the **command half** must always be `0x00`. Do NOT write model type into it. The device rejects commands where command byte 0 ≠ 0x00 with result=12.
>
> **Receive half byte 0:** write the model type value here (e.g. `0x01` for Global 2022). Confirmed by `AirconStatCoder.smali`: `receiveToByte` starts from `receive_init` (all zeros) and ORs the model type constant into byte 0. For Separate 2021 (0x00) this is a no-op — which is why it was previously undocumented. For other models it must be set, or the AC returns result=12.
>
> When decoding, the device sets bit 7 of receive byte 0 as a device flag (`0x81` = Global 2022 with flag set). Always mask with `& 0x7F` to get the model type, and write only the masked value (not the raw byte) into the encode receive half.

### Feature availability by model

| Feature           | Sep2021 | Global2022 | HighEnd2023 | ZT2025 | FDT2023 |
| ----------------- | :-----: | :--------: | :---------: | :----: | :-----: |
| Entrust (3D Auto) |    ✓    |     ✓      |      ✓      |   ✓    |    —    |
| Horizontal swing  |    ✓    |     ✓      |      ✓      |   ✓    |    —    |
| Self-clean        |    —    |     ✓      |      ✓      |   ✓    |    —    |
| Vacant property   |    —    |     ✓      |      —      |   ✓    |    —    |
| Home leave mode   |    —    |     ✓      |      —      |   ✓    |    —    |
| Preset temp auto  |    —    |     —      |      —      |   —    |    ✓    |

---

## Local API — endpoints and payload

All requests: `POST https://<device-ip>:51443/beaver/command/<command>`  
SSL verification disabled (self-signed cert). Content-Type: application/json.

### Base payload (required on every request)

```json
{
  "apiVer": "1.0",
  "command": "<same as URL path>",
  "deviceId": "<fixed string, e.g. 'kazembridge'>",
  "operatorId": "<registered UUID>",
  "timestamp": <unix seconds>
}
```

### Commands

| Command             | Extra payload fields                                   | Notes                                                      |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `getDeviceInfo`     | —                                                      | Works without operatorId registered                        |
| `getAirconStat`     | `contents: {airconId}`                                 | Returns `contents.airconStat` (base64 blob)                |
| `setAirconStat`     | `contents: {airconId, airconStat}`                     | `airconStat` = encoded blob. Returns result code.          |
| `updateAccountInfo` | `contents: {airconId, accountId, remote: 0, timezone}` | Registers operatorId. `accountId` must equal `operatorId`. |
| `deleteAccountInfo` | `contents: {airconId, accountId}`                      | Removes an operator slot.                                  |

### Result codes

| Code  | Meaning                                         |
| ----- | ----------------------------------------------- |
| `0`   | Success                                         |
| `1`   | Unauthorized / concurrent modification conflict |
| `2`   | Operator list full (max ~4 slots)               |
| `10`  | AC internal error                               |
| `11`  | AC internal error                               |
| `12`  | Operation prohibited / AC abnormal state        |
| `20`  | Firmware update required                        |
| `99`  | AC did not confirm within 30 s                  |
| `429` | Too many requests                               |

---

## Temperature lookup tables

### Indoor (`INDOOR_TEMP[256]`, index → °C)

Covers −30.0 °C (indices 0–15) to +52.0 °C (index 255). Non-linear spacing.

### Outdoor (`OUTDOOR_TEMP[256]`, index → °C)

Covers −50.0 °C (indices 0–4) to +43.0 °C (index 255). Non-linear spacing.

Full tables are in `integration/custom_components/kazembridge/mhi_codec.py`.

---

## Bug history — result=12 crashes (confirmed fixed 2026-05-25)

### Symptoms
Sending `setAirconStat` via the local API caused the physical AC unit to enter an abnormal state (result=12), locking it on and requiring a circuit breaker reset to recover. The IR remote continued to work normally throughout.

### Root causes (all in `encode()` in `mhi_codec.py`)

#### Bug 1 — Missing self-clean OFF bit (byte 12 bit 7)
`c[12] |= 0x80` was absent. Per the protocol, bit 7 of command byte 12 must **always** be set — it signals "self-clean OFF". Without it the device returns result=12 immediately.

The remote control's blob has byte 12=`0x00` because it uses a different internal encoding (IR protocol translated by the AC unit). The app API requires `0x80`.

**Fix:** Added `c[12] |= 0x80`.

#### Bug 2 — Position bits NOT written during swing (overcorrection)
An earlier version set position bits in `c[3]` and `c[11]` during swing, which was wrong. They were removed entirely. This was an overcorrection.

**What the smali actually requires:** `commandToByte` always applies `lv_p_01` (`0x80`) to `c[3]` immediately after writing `as_p_on` (vertical swing ON), and `lh_p_01` (`0x10`) to `c[11]` immediately after writing `av_p_on` (horizontal swing ON). Position Pos1 must always be written — even during swing. When swing is OFF a specific position is written; when swing is ON Pos1 is the baseline.

**Fix:** `c[3] |= 0x80` when `wind_ud == 0`; `c[11] |= 0x10` when `wind_lr == 0`.

#### Bug 3 — Model type not written to receive half byte 0
`r[0]` was left at `0x00` (from `receive_init`). For Separate 2021 (model_type=0x00) this is correct. For Global 2022 and other models, `receiveToByte` ORs the model type constant into `r[0]`, so it must be `0x01`, `0x02`, etc.

**Why this matters:** The device's own `getAirconStat` blob has bit 7 set in receive byte 0 as a device flag (e.g. `0x81` for Global 2022). The app strips this with `& 0x7F` to get model ID `0x01`, then writes `0x01` into the encode receive half. Sending `0x00` when the AC is Global 2022 caused result=12 for swing commands.

**Note on command byte 0:** `commandToByte` never writes byte 0 — `c[0]` stays `0x00` regardless of model. An even earlier bug wrote the raw `0x81` device flag into `c[0]`, which also caused result=12.

**Fix:** Added `model_type` param to `encode()`. Set `r[0] = model_type` (the masked value, not the raw device byte). `c[0]` stays `0x00`. Read `model_type` from coordinator data (`r[0] & 0x7F` from decoded blob) and pass it through `_params()` → `encode()`.

### How it was debugged (2026-05-27)
1. Decoded AC blobs captured from physical remote: `r[0]=0x81` → model_type=0x01 (Global 2022).
2. Traced `AirconStatCoder.smali`: `commandToByte` never writes byte 0; `receiveToByte` ORs `STATUS_MODEL_NO_TYPE_*` into byte 0.
3. Found swing still fails: smali shows `lv_p_01` and `lh_p_01` are always applied alongside swing-ON bits.
4. Fixed `r[0] = model_type` and position-during-swing in `encode()`.
