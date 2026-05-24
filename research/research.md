# MHI WF-RAC Wi-Fi Adapter — Unofficial API Documentation

> Reverse-engineered from the SmartM-Air Android app (jp.co.mhi_mth.smartmair).  
> Device: Mitsubishi Heavy Industries AC with WF-RAC-HTTPS Wi-Fi adapter.

---

## Transport

### Local Wi-Fi (device direct)

| Property     | Value                                                |
| ------------ | ---------------------------------------------------- |
| Protocol     | HTTPS (with HTTP fallback for older adapters)        |
| Port         | 51443                                                |
| Base URL     | `https://<device-ip>:51443/beaver/command/<command>` |
| Method       | POST                                                 |
| Content-Type | `application/json`                                   |
| TLS          | Self-signed cert — disable verification              |

> Some older adapters do not support HTTPS. The app checks a `canHttps()` flag per device and falls back to `http://<ip>:51443/beaver/command/<command>` if needed. During initial discovery (before capability is known), the app tries HTTPS first, then HTTP.

Discovery is via mDNS (Android NSD). The device advertises itself on the local network as service type `_beaver._tcp.`

### Cloud API

| Property | Value                        |
| -------- | ---------------------------- |
| Protocol | HTTPS                        |
| Base URL | `https://spa.smartmair.com/` |
| Method   | POST                         |

The cloud API is a separate system used for remote access and push notification features. Most commands documented here are local Wi-Fi only. Cloud-only commands are marked accordingly.

---

## Authentication

### How it works

The AC maintains a list of registered operators (max ~4–5). Before any command will work, your `operatorId` must be registered via `updateAccountInfo`. The app does this on first setup.

- `operatorId` — a UUID you generate once and store permanently. Registered on the AC via `updateAccountInfo`.
- `deviceId` — any consistent string identifying your client (the app uses the Android device ID, but any string works e.g. `"kazembridge"`).
- `result: 1` on any command means your `operatorId` is not registered or was evicted.

### Registering a new operatorId

Generate a UUID and call `updateAccountInfo` before using any other command:

```json
POST /beaver/command/updateAccountInfo
{
  "apiVer": "1.0",
  "operatorId": "<your-new-uuid>",
  "deviceId": "<your-device-id>",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "<airconId>",
    "accountId": "<your-new-uuid>",
    "remote": 0,
    "timezone": "Europe/Amsterdam"
  }
}
```

`remote: 0` = local mode. `result: 0` = registered successfully.

### What happens when the operator list is full

When `updateAccountInfo` returns `result: 2`, the operator list is full. The official app's handling of this is, to put it charitably, minimal:

- It shows the user a dialog: _"Unable to register because the maximum number of registered users."_
- **Yes** → navigates to the WiFi setup instruction screen (just shows a picture guide, does nothing programmatic)
- **No** → resumes normal operation

In other words, **the app has no automatic solution**. It just tells the user to go set it up again manually.

For KazeMBridge, handle this properly by calling `deleteAccountInfo` to free a slot before retrying:

```
result: 2 → deleteAccountInfo (remove oldest/unknown operator) → retry updateAccountInfo
```

Note: there is currently no known way to list which operatorIds are registered on the AC — `remoteList` in the `getAirconStat` response returns empty strings. So tracking your own operatorId carefully is important.

### Request fields (required on every request)

```json
{
  "apiVer": "1.0",
  "deviceId": "<your-device-id>",
  "operatorId": "<your-registered-uuid>",
  "timestamp": <unix seconds>
}
```

| Field        | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `apiVer`     | Always `"1.0"` (exception: `setOptionSetting` uses `"1.1"`) |
| `deviceId`   | Any consistent string identifying your client               |
| `operatorId` | Your registered UUID                                        |
| `timestamp`  | Unix timestamp (seconds)                                    |

---

## Local Wi-Fi Commands

These commands are sent directly to the device over the local network.

| Command             | Description                      | Status        |
| ------------------- | -------------------------------- | ------------- |
| `getDeviceInfo`     | Returns device metadata          | ✅            |
| `getAirconStat`     | Returns current AC state         | ✅            |
| `setAirconStat`     | Sets AC state                    | ✅            |
| `updateAccountInfo` | Register an operatorId on the AC | ✅            |
| `deleteAccountInfo` | Remove a registered operatorId   | ✅            |
| `setNetworkInfo`    | Configure network/WiFi settings  | ⚠️ Setup only |
| `updateFirmware`    | Trigger firmware update          | ⚠️ Do not use |

---

## getDeviceInfo

Returns device metadata including MAC address and aircon ID.

### Request

```json
{
  "apiVer": "1.0",
  "deviceId": "kazembridge",
  "operatorId": "<uuid>",
  "timestamp": 1713000000
}
```

### Response

```json
{
  "result": 0,
  "command": "getDeviceInfo",
  "apiVer": "1.0",
  "contents": {
    "airconId": "348e89a28855",
    "macAddress": "348e89a28855",
    "apMode": 0
  }
}
```

| Field        | Description                                         |
| ------------ | --------------------------------------------------- |
| `airconId`   | Unique AC identifier — needed for all stat commands |
| `macAddress` | Device MAC address (same as airconId)               |
| `apMode`     | `0` = normal mode, `1` = AP/setup mode              |

---

## updateAccountInfo

Registers an operatorId on the AC. Must be called before any other command will work with a new operatorId. The AC stores a limited number of operators (`numOfAccount` tracks current count, max ~4–5).

### Request

```json
{
  "apiVer": "1.0",
  "operatorId": "<uuid-to-register>",
  "deviceId": "kazembridge",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "348e89a28855",
    "accountId": "<uuid-to-register>",
    "remote": 0,
    "timezone": "Europe/Amsterdam"
  }
}
```

| Field       | Description                               |
| ----------- | ----------------------------------------- |
| `accountId` | Same value as `operatorId`                |
| `remote`    | `0` = local mode, `1` = remote/cloud mode |
| `timezone`  | IANA timezone string                      |

### Response

```json
{
  "result": 0,
  "command": "updateAccountInfo",
  "apiVer": "1.0",
  "operatorId": "<uuid>",
  "deviceId": "kazembridge",
  "timestamp": 1713000000
}
```

### Result codes

| Code  | Meaning                  |
| ----- | ------------------------ |
| `0`   | Registered successfully  |
| `2`   | Operator list full       |
| `20`  | Firmware update required |
| `429` | Too many requests        |

---

## deleteAccountInfo

Removes a registered operatorId from the AC. Use to clean up old registrations or free a slot when the list is full.

### Request

```json
{
  "apiVer": "1.0",
  "operatorId": "<uuid-of-caller>",
  "deviceId": "kazembridge",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "348e89a28855",
    "accountId": "<uuid-to-delete>"
  }
}
```

> Note: `operatorId` is the caller making the request (must already be registered). `accountId` in contents is the operator to delete — can be the same or different.

### Response

```json
{
  "result": 0
}
```

---

## getAirconStat

Returns the current AC state. Exists in two variants — local Wi-Fi direct and cloud — with different request/response shapes.

### Local Wi-Fi request

Single `airconId` string in contents.

```json
{
  "apiVer": "1.0",
  "deviceId": "kazembridge",
  "operatorId": "<uuid>",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "348e89a28855"
  }
}
```

### Cloud request

`airconId` is a **list** — multiple ACs can be queried in one call.

```json
{
  "apiVer": "1.0",
  "operatorId": "<uuid>",
  "timestamp": 1713000000,
  "command": "getAirconStat",
  "contents": {
    "airconId": ["348e89a28855", "..."]
  }
}
```

### Local Wi-Fi response

Flat `contents` object for the single queried device.

```json
{
  "result": 0,
  "contents": {
    "airconId": "348e89a28855",
    "airconStat": "<base64>",
    "logStat": 0,
    "updatedBy": "aircon",
    "expires": 1779547164,
    "ledStat": 1,
    "autoHeating": 0,
    "highTemp": "AB",
    "lowTemp": "66",
    "numOfAccount": 4,
    "remoteList": ["", "", "", ""],
    "timezone": "Europe/Amsterdam",
    "firmType": "WF-RAC-HTTPS",
    "wireless": { "firmVer": "025" },
    "mcu": { "firmVer": "200" }
  }
}
```

> `indoorTemp` and `outdoorTemp` are **not** JSON fields in the local response. They are embedded in the `airconStat` blob as receive half extension tuples — see Aircon Stat Encoding.

````

### Cloud response

`contents` is a **map keyed by `airconId`**, one entry per queried device. Each entry contains the decoded AC state fields — the binary blob is already parsed server-side.

```json
{
  "result": 0,
  "contents": {
    "348e89a28855": {
      "operation": 1,
      "operationMode": 1,
      "coolTemp": 22.0,
      "hotTemp": 20.0,
      "autoTemp": 25.0,
      "dryTemp": 24.0,
      "airFlow": 2,
      "windDirectionUD": 0,
      "windDirectionLR": 3,
      "indoorTemp": 21.5,
      "outdoorTemp": 8.0,
      "entrust": 0,
      "firmType": "WF-RAC-HTTPS",
      "statReceiveDate": 1713001234567,
      "isPresetTempAutoForAuto": false,
      "isPresetTempAutoForCool": false,
      "isPresetTempAutoForHot": false,
      "isPresetTempAutoForDry": false,
      "wireless": { "firmVer": "025" },
      "mcu": { "firmVer": "200" }
    }
  }
}
````

> Note: the cloud response returns decoded scalar fields (`operation`, `operationMode`, per-mode temps, etc.) rather than the raw `airconStat` base64 blob. The local Wi-Fi response returns the raw blob which must be decoded client-side.

````

### Local Wi-Fi response fields

| Field | Description |
|---|---|
| `airconStat` | Base64-encoded binary state blob — see Aircon Stat Encoding |
| `ledStat` | `1` = LED on, `0` = off (integer) |
| `autoHeating` | `1` = frost protection on, `0` = off (integer) |
| `highTemp` | Upper alert threshold — **hex string** e.g. `"AB"` = 0xAB = 171. Parse with `int(v, 16)` |
| `lowTemp` | Lower alert threshold — same hex string encoding |
| `numOfAccount` | Number of operatorIds currently registered |
| `remoteList` | Always empty strings — registered operatorIds are not exposed |
| `logStat` | Log status flag |
| `updatedBy` | Who last updated state — `"local"` or `"aircon"` |
| `expires` | Unix timestamp (seconds) when state expires |
| `timezone` | IANA timezone string |
| `firmType` | Adapter firmware type string |
| `wireless.firmVer` | Wi-Fi adapter firmware version |
| `mcu.firmVer` | AC MCU firmware version |

> `indoorTemp` and `outdoorTemp` are embedded in the `airconStat` blob extension tuples, not separate JSON fields. See Aircon Stat Encoding → Receive half extension tuples.

### Cloud response fields (per AC entry)

| Field | Type | Description |
|---|---|---|
| `operation` | Integer | `1` = on, `0` = off |
| `operationMode` | Integer | `0`=auto, `1`=cool, `2`=heat, `3`=fan, `4`=dry |
| `coolTemp` | Double | Cool mode setpoint °C |
| `hotTemp` | Double | Heat mode setpoint °C |
| `autoTemp` | Double | Auto mode setpoint °C |
| `dryTemp` | Double | Dry mode setpoint °C |
| `airFlow` | Integer | `0`=auto, `1`–`4`=speeds |
| `windDirectionUD` | Integer | `0`=swing, `1`–`4`=positions |
| `windDirectionLR` | Integer | `0`=swing, `1`–`7`=positions |
| `indoorTemp` | Double | Indoor temperature °C |
| `outdoorTemp` | Double | Outdoor temperature °C |
| `entrust` | Integer | `0`=off, `1`=on |
| `statReceiveDate` | Long | Unix ms timestamp of last state report |
| `isPresetTempAutoForAuto/Cool/Hot/Dry` | Boolean | Per-mode preset temp auto flag |
| `firmType` | String | Adapter firmware type |
| `wireless.firmVer` | String | Wi-Fi adapter firmware version |
| `mcu.firmVer` | String | AC MCU firmware version |

---

## setAirconStat

Sets the AC state. Takes the same base64-encoded binary blob returned by `getAirconStat`, with modified bytes.

### Request

```json
{
  "apiVer": "1.0",
  "deviceId": "kazembridge",
  "operatorId": "<uuid>",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "348e89a28855",
    "airconStat": "<base64>"
  }
}
````

### Response

```json
{
  "result": 0,
  "contents": {
    "airconId": "348e89a28855",
    "airconStat": "<base64>"
  }
}
```

`result: 0` = AC accepted the command. `result: 99` = AC did not confirm within 30s.

> The app polls `getAirconStat` for up to 30 seconds after `setAirconStat` to confirm the AC accepted the new state.

---

## setNetworkInfo

Configures WiFi network settings on the adapter. Used during initial setup only.

### Request (inferred from source)

```json
{
  "apiVer": "1.0",
  "operatorId": "<uuid>",
  "deviceId": "kazembridge",
  "timestamp": 1713000000,
  "contents": {
    "ssid": "<wifi-ssid>",
    "netPass": "<wifi-password>"
  }
}
```

> ⚠️ Not needed for normal operation — only used during WiFi pairing setup.

---

## Cloud API Commands

These commands go to `https://spa.smartmair.com/server/<command>`, not to the local device. They require cloud account authentication (not documented here). Listed for completeness.

| Command            | Path                      | Description                           |
| ------------------ | ------------------------- | ------------------------------------- |
| `setOptionSetting` | `server/setOptionSetting` | Set device options and alert settings |
| `getAirconSetting` | `server/getAirconSetting` | Get device options from cloud         |
| `setAirconStat`    | `command/setAirconStat`   | Set AC state via cloud relay          |
| `getAirconStat`    | `command/getAirconStat`   | Get AC state via cloud relay          |

---

## setOptionSetting (Cloud only)

> ☁️ **Cloud API only** — sends to `https://spa.smartmair.com/server/setOptionSetting`. Not available over local Wi-Fi.

Configures device options, alert/notification settings, and optionally pushes a new AC state in the same call.

### Request

```json
POST https://spa.smartmair.com/server/setOptionSetting
{
  "apiVer": "1.1",
  "operatorId": "<uuid>",
  "deviceId": "<device-id>",
  "timestamp": 1713000000,
  "contents": {
    "airconId": "348e89a28855",
    "accountId": "<uuid>",
    "airconName": "<base64-encoded-utf8-name>",
    "ledStat": 1,
    "autoHeating": 0,
    "errorInformation": 0,
    "forgottenInformation": 0,
    "tempInformation": 0,
    "watchSetting": 0,
    "highTemp": 40,
    "lowTemp": 10,
    "airconStat": "<base64, optional>"
  }
}
```

### Response

```json
{
  "result": 0
}
```

### Field reference

| Field                  | Type    | Nullable | Notes                                                                                                |
| ---------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `apiVer`               | String  | —        | **`"1.1"`** — differs from all other commands                                                        |
| `accountId`            | String  | no       | Same value as `operatorId`                                                                           |
| `airconName`           | String  | no       | `base64(utf8(name))`, newlines stripped                                                              |
| `ledStat`              | Integer | yes      | `1` = LED on, `0` = off. Only sent for models that support it                                        |
| `autoHeating`          | Integer | yes      | `1` = frost protection on. Only sent for models that support it                                      |
| `errorInformation`     | Integer | no       | `1` = enable error push notifications                                                                |
| `forgottenInformation` | Integer | no       | `1` = enable "left on" reminder. Requires GPS permission and cloud/remote mode — no-op in local mode |
| `tempInformation`      | Integer | no       | `1` = enable temperature alert notifications                                                         |
| `watchSetting`         | Integer | no       | Master push notification toggle — `1` = on                                                           |
| `highTemp`             | Integer | yes      | Upper alert threshold, raw value 0–52. Only sent for models that support `tempInformation`           |
| `lowTemp`              | Integer | yes      | Lower alert threshold, raw value 0–52. Only sent for models that support `tempInformation`           |
| `airconStat`           | String  | yes      | Optional base64 blob — include to update AC state atomically with options                            |

> **Note on `highTemp`/`lowTemp`:** the range 0–52 is a raw device encoding, not degrees. The app converts to/from °C or °F for display. The exact conversion is not yet confirmed.

> **Note on `airconName`:** must be Base64-encoded. Example: `"Living Room"` → `base64("Living Room".encode("utf-8"))` → `"TGl2aW5nIFJvb20="`.

### Result codes

| Code  | Meaning                                                  |
| ----- | -------------------------------------------------------- |
| `0`   | Success                                                  |
| `1`   | Conflict — another client modified settings concurrently |
| `10`  | AC internal error                                        |
| `11`  | AC internal error                                        |
| `12`  | Operation prohibited                                     |
| `20`  | Firmware update required                                 |
| `429` | Too many requests                                        |

---

## Aircon Stat Encoding

The `airconStat` base64 string encodes a command half and a receive half concatenated:

```
base64( [command_half] + [receive_half] )
```

### Command half structure (25 bytes minimum)

```
[18 bytes payload] + [variable trailer] + [2 bytes CRC16]
```

The trailer is `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]` for most models. For models with home leave mode the trailer is variable-length — see Encoder Notes below.

### Receive half structure (variable length)

The receive half returned by the **device** is longer than 25 bytes because the AC appends sensor extension data:

```
[18 bytes payload] + [1 byte count] + [count × 4 byte tuples] + [2 bytes CRC16]
```

Real device example (58 bytes total blob):

- Command half: 25 bytes (18 payload + `01 FF FF FF FF` trailer + 2 CRC)
- Receive half: 33 bytes (18 payload + 1 count + 3×4 tuples + 2 CRC)

### Receive half extension tuples

Each tuple is `[code, sub_code, value, 0xFF]`. Known codes from real device:

| Code   | Sub    | Meaning                                                                   |
| ------ | ------ | ------------------------------------------------------------------------- |
| `0x80` | `0x20` | Indoor temperature — `value` is index into `indoor_temp[]` lookup table   |
| `0x80` | `0x10` | Outdoor temperature — `value` is index into `outdoor_temp[]` lookup table |
| `0x94` | `0x10` | Unknown (possibly error/status code)                                      |

Example from real device: count=3, indoor=`0x99`→23.5°C, outdoor=`0xAB`→20.0°C.

> This is why `indoorTemp`/`outdoorTemp` are **not** separate JSON fields in the local Wi-Fi `getAirconStat` response — they're embedded in the blob extension data. Parse them from the receive half extension tuples, not the JSON envelope.

### highTemp / lowTemp encoding

In the `getAirconStat` response JSON, `highTemp` and `lowTemp` are **hex-encoded strings**, not integers:

```json
"highTemp": "AB",
"lowTemp": "66"
```

Parse with `int(value, 16)` to get the raw integer (0–255 range).

### CRC

CRC-16/CCITT (init `0xFFFF`, poly `0x1021`), covers all bytes before the CRC, appended little-endian (low byte first).

---

### Command half — byte map (18 bytes)

#### Byte 0 — Model type

| Value  | Model                   |
| ------ | ----------------------- |
| `0x00` | Separate 2021 (default) |
| `0x01` | Global 2022             |
| `0x02` | High-end Japanese 2023  |
| `0x03` | ZT 2025                 |
| `0x40` | FDT 2023                |

#### Byte 2 — Operation, mode, auto-swing

**Operation (bits 0–1):**

| Value  | Meaning |
| ------ | ------- |
| `0x02` | OFF     |
| `0x03` | ON      |

**Mode (bits 2–5):**

| Value  | Mode     |
| ------ | -------- |
| `0x20` | Auto     |
| `0x28` | Cool     |
| `0x30` | Heat     |
| `0x2C` | Fan only |
| `0x24` | Dry      |

**Auto-swing (bits 6–7):**

| Value  | Meaning            |
| ------ | ------------------ |
| `0xC0` | Vertical swing ON  |
| `0x80` | Vertical swing OFF |

#### Byte 3 — Fan speed + vertical position

**Fan speed (low nibble, bits 0–3):**

| Value  | Speed   |
| ------ | ------- |
| `0x0F` | Auto    |
| `0x08` | Speed 1 |
| `0x09` | Speed 2 |
| `0x0A` | Speed 3 |
| `0x0E` | Speed 4 |

**Vertical position (high nibble, bits 4–7) — only when swing is OFF:**

| Value  | Position   |
| ------ | ---------- |
| `0x80` | Position 1 |
| `0x90` | Position 2 |
| `0xA0` | Position 3 |
| `0xB0` | Position 4 |

#### Byte 4 — Temperature

```
byte = int(temp / 0.5) + 128
```

Examples: 20°C → `0xA8`, 22°C → `0xAC`, 25°C → `0xB2`

Range: 16.0°C – 31.0°C in 0.5° steps.

#### Byte 9 — Preset temp auto (command)

| Value  | Meaning             |
| ------ | ------------------- |
| `0x01` | Preset temp auto ON |
| `0x00` | OFF                 |

#### Byte 10 — Vacant property / self-clean

| Bit    | Meaning            |
| ------ | ------------------ |
| `0x01` | Vacant property ON |
| `0x04` | Self-clean reset   |

#### Byte 11 — Horizontal position

| Value  | Position   |
| ------ | ---------- |
| `0x10` | Position 1 |
| `0x11` | Position 2 |
| `0x12` | Position 3 |
| `0x13` | Position 4 |
| `0x14` | Position 5 |
| `0x15` | Position 6 |
| `0x16` | Position 7 |

#### Byte 12 — Horizontal swing + entrust + self-clean op

**Horizontal swing (bits 0–1):**

| Value  | Meaning              |
| ------ | -------------------- |
| `0x03` | Horizontal swing ON  |
| `0x02` | Horizontal swing OFF |

**Entrust (bits 2–3):**

| Value  | Meaning |
| ------ | ------- |
| `0x08` | OFF     |
| `0x0C` | ON      |

**Self-clean operation (bits 4–7):**

| Value  | Meaning |
| ------ | ------- |
| `0x80` | OFF     |
| `0x90` | ON      |

---

### Receive half — byte map (18 bytes)

#### Byte 2 — Operation + mode + vertical swing

**Operation (bit 0):**

| Value  | Meaning |
| ------ | ------- |
| `0x01` | ON      |
| `0x00` | OFF     |

**Mode (bits 2–4):**

| Value  | Mode     |
| ------ | -------- |
| `0x00` | Auto     |
| `0x08` | Cool     |
| `0x10` | Heat     |
| `0x0C` | Fan only |
| `0x04` | Dry      |

**Vertical swing (bit 6):**

| Value  | Meaning   |
| ------ | --------- |
| `0x40` | Swing ON  |
| `0x00` | Swing OFF |

#### Byte 3 — Fan speed + vertical position (receive)

**Fan speed (low nibble, bits 0–3) — different encoding from command half:**

| Value  | Speed   |
| ------ | ------- |
| `0x07` | Auto    |
| `0x00` | Speed 1 |
| `0x01` | Speed 2 |
| `0x02` | Speed 3 |
| `0x06` | Speed 4 |

**Vertical position (high nibble) — when swing OFF:**

| Value  | Position   |
| ------ | ---------- |
| `0x00` | Position 1 |
| `0x10` | Position 2 |
| `0x20` | Position 3 |
| `0x30` | Position 4 |

#### Byte 4 — Temperature (receive)

```
byte = int(temp / 0.5)
```

Examples: 20°C → `0x28`, 22°C → `0x2C`

#### Byte 7 — Preset temp auto (status)

| Value  | Meaning             |
| ------ | ------------------- |
| `0x80` | Preset temp auto ON |

#### Byte 11 — Horizontal position (receive)

`0x00`–`0x06` = positions 1–7

#### Byte 11 — Horizontal position (receive)

`0x00`–`0x06` = positions 1–7

#### Byte 12 — Horizontal swing + entrust (receive)

| Value  | Meaning              |
| ------ | -------------------- |
| `0x01` | Horizontal swing ON  |
| `0x00` | Horizontal swing OFF |
| `0x04` | Entrust ON           |
| `0x00` | Entrust OFF          |

> Note: swing and entrust occupy different bits and can be combined.

#### Byte 15 — Operation mode 2

| Value  | Meaning                 |
| ------ | ----------------------- |
| `0x01` | ON (self-clean running) |

---

### Encoder notes

**Fan mode (mode 3) temperature** — when `operationMode == 3` (fan only), the encoder ignores the actual preset temp and forces byte 4 to `25.0°C` in both command and receive halves.

**Horizontal swing is model-gated** — `windDirectionLR` is only encoded if `enabledWindDirectionLR()` is true for the model. If not supported, the encoder writes position 1 with swing off regardless of input.

**Entrust is model-gated** — only encoded if `enableEntrust()` is true. Otherwise entrust OFF is always written.

**Vacant property is model-gated** — byte 10 bit 0 only written if `enableVacantProperty()` is true.

**Self-clean is model-gated** — byte 10 bit 2 (reset) and byte 12 bits 4–7 (operation) only written if `enableSelfCleanOperation()` is true.

### Variable-length trailer (home leave mode)

For models that support home leave mode (`enableHomeLeaveMode()`), the command half trailer is not the fixed 5 bytes `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]`. Instead it carries home leave mode settings as a sequence of `(op_code, sub_code, value)` tuples:

```
[count, op1, sub1, val1, op2, sub2, val2, ...]
```

Where `count` = number of tuples / 4, and `op_code` is always `0xF8` (248). Sub-codes:

| Sub-code | Meaning                         |
| -------- | ------------------------------- |
| `27`     | Temp rule for cooling × 2       |
| `28`     | Temp rule for heating × 2       |
| `29`     | Temp setting for cooling × 2    |
| `30`     | Temp setting for heating × 2    |
| `31`     | Fan speed for cooling (encoded) |
| `32`     | Fan speed for heating (encoded) |

Fan speed encoding for home leave mode: `0`=auto, `3`=speed1, `5`=speed2, `7`=speed3, `14`=speed4.

When requesting home leave mode status (not setting it), `op_code = 0xF8` and `sub_code = 0xFF` for all 6 tuples with value `0`.

The receive half always uses the fixed `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]` trailer regardless of model.

---

## Model Capability Matrix

Features available depend on the model type byte (byte 0 of the command half). Fields gated by capability should be omitted or ignored if the model does not support them.

| Feature                         | Separate 2021 (0x00) | Global 2022 (0x01) | High-end Japanese 2023 (0x02) | ZT 2025 (0x03) | FDT 2023 (0x40) |
| ------------------------------- | -------------------- | ------------------ | ----------------------------- | -------------- | --------------- |
| Power consumption               | ✅                   | ✅                 | ✅                            | —              | —               |
| Vacant property                 | —                    | ✅                 | —                             | ✅             | —               |
| Self-clean                      | —                    | ✅                 | ✅                            | ✅             | —               |
| Horizontal swing                | ✅                   | ✅                 | ✅                            | ✅             | —               |
| Entrust (3D auto)               | ✅                   | ✅                 | ✅                            | ✅             | —               |
| LED stat                        | ✅                   | —                  | —                             | —              | ✅              |
| Auto heating (frost protection) | ✅                   | ✅                 | —                             | ✅             | —               |
| Home leave mode                 | —                    | ✅                 | —                             | ✅             | —               |
| Temp information alerts         | ✅                   | ✅                 | ✅                            | ✅             | —               |
| Indoor/outdoor temp display     | ✅                   | ✅                 | ✅                            | ✅             | ✅              |
| Preset temp auto                | —                    | —                  | —                             | —              | ✅              |
| Call center phone number        | —                    | —                  | ✅                            | —              | —               |
| Outdoor temp always show        | —                    | ✅                 | —                             | ✅             | ✅              |
| Outdoor temp show outside Tokyo | ✅                   | —                  | —                             | —              | —               |
| Cool/hot judge                  | ✅                   | ✅                 | ✅                            | ✅             | —               |
| Preset temp range 2             | —                    | —                  | —                             | ✅             | —               |
| Operation data                  | —                    | —                  | —                             | ✅             | —               |

---

## Indoor/Outdoor Temperature Encoding

`indoorTemp` and `outdoorTemp` in the `getAirconStat` response are **not** raw degree values. They are byte indices into fixed lookup tables defined in the app resources. The device returns a raw byte; the app uses it as an array index to look up the actual °C value.

### Indoor temp table (256 entries, index 0–255)

The table covers approximately **−30.0°C to +52.0°C** with non-uniform steps (coarser at extremes, ~0.2–0.5° steps in the normal range). Index 0–15 all map to −30.0°C (clamped). Selected values:

| Index | °C    | Index | °C   | Index | °C   |
| ----- | ----- | ----- | ---- | ----- | ---- |
| 0–15  | −30.0 | 100   | 9.7  | 170   | 25.5 |
| 69    | 0.0   | 120   | 15.0 | 180   | 28.0 |
| 80    | 3.0   | 130   | 18.0 | 190   | 31.0 |
| 90    | 6.0   | 140   | 20.5 | 200   | 33.5 |
| 95    | 8.0   | 150   | 22.5 | 215   | 38.0 |

### Outdoor temp table (256 entries, index 0–255)

Covers approximately **−50.0°C to +43.0°C**. Index 0–4 clamp to −50.0°C. Selected values:

| Index | °C    | Index | °C   | Index | °C   |
| ----- | ----- | ----- | ---- | ----- | ---- |
| 0–4   | −50.0 | 90    | 0.0  | 160   | 18.0 |
| 35    | −20.0 | 100   | 2.5  | 180   | 24.0 |
| 60    | −8.0  | 120   | 7.0  | 200   | 29.0 |
| 75    | −3.0  | 140   | 12.0 | 220   | 34.0 |

> The full lookup tables are embedded in the app as string arrays `indoor_temp` and `outdoor_temp` in `res/values/arrays.xml`. If you need exact values, use those arrays directly rather than the samples above.

---

## Result Codes

| Code  | Meaning                                                                                       |
| ----- | --------------------------------------------------------------------------------------------- |
| `0`   | Success                                                                                       |
| `1`   | Unauthorized — operatorId not registered (local); or concurrent modification conflict (cloud) |
| `2`   | Operator list full                                                                            |
| `10`  | AC internal error (cloud)                                                                     |
| `11`  | AC internal error (cloud)                                                                     |
| `12`  | Operation prohibited (cloud)                                                                  |
| `20`  | Firmware update required                                                                      |
| `99`  | AC did not confirm state update within 30s                                                    |
| `429` | Too many requests                                                                             |

---

## Notes

- The app supports two modes: **Wi-Fi direct** (local HTTPS/HTTP to device IP) and **cloud** (via `spa.smartmair.com`). The local Wi-Fi commands are documented fully above. Cloud commands are listed for reference only — cloud auth is not documented here.
- The `operatorId` must be registered with the device via `updateAccountInfo` before other commands will work.
- The app polls `getAirconStat` after `setAirconStat` for up to 30 seconds to confirm the AC accepted the new state.
- `indoorTemp` and `outdoorTemp` are **not** JSON fields in the local Wi-Fi response. They are embedded in the `airconStat` blob as receive half extension tuples (codes `0x80/0x20` and `0x80/0x10`). Values are lookup table indices — use the `indoor_temp[]` and `outdoor_temp[]` arrays from the app resources to convert to °C.
- `highTemp` and `lowTemp` in the JSON response are hex-encoded strings (e.g. `"AB"`), not integers. Parse with `int(v, 16)`.
- `numOfAccount` in the `getAirconStat` response tracks how many operatorIds are currently registered.
- `result: 1` on any local command means the operatorId is not registered — call `updateAccountInfo` first.
- There is no known way to list registered operatorIds — `remoteList` always returns empty strings. Store your operatorId carefully.
- `coolingOnly` visible in the app UI is stored locally in the app database only — it is not sent to the AC and has no wire representation.
