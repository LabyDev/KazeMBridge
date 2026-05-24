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

### Cloud response

`contents` is a **map keyed by `airconId`**, one entry per queried device.

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
```

### Local Wi-Fi response fields

| Field              | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `airconStat`       | Base64-encoded binary state blob — see Aircon Stat Encoding                              |
| `ledStat`          | `1` = LED on, `0` = off                                                                  |
| `autoHeating`      | `1` = frost protection on, `0` = off                                                     |
| `highTemp`         | Upper alert threshold — **hex string** e.g. `"AB"` = 0xAB = 171. Parse with `int(v, 16)` |
| `lowTemp`          | Lower alert threshold — same hex string encoding                                         |
| `numOfAccount`     | Number of operatorIds currently registered                                               |
| `remoteList`       | Always empty strings — registered operatorIds are not exposed                            |
| `logStat`          | Log status flag                                                                          |
| `updatedBy`        | Who last updated state — `"local"` or `"aircon"`                                         |
| `expires`          | Unix timestamp (seconds) when state expires                                              |
| `timezone`         | IANA timezone string                                                                     |
| `firmType`         | Adapter firmware type string                                                             |
| `wireless.firmVer` | Wi-Fi adapter firmware version                                                           |
| `mcu.firmVer`      | AC MCU firmware version                                                                  |

### Cloud response fields (per AC entry)

| Field                                  | Type    | Description                                    |
| -------------------------------------- | ------- | ---------------------------------------------- |
| `operation`                            | Integer | `1` = on, `0` = off                            |
| `operationMode`                        | Integer | `0`=auto, `1`=cool, `2`=heat, `3`=fan, `4`=dry |
| `coolTemp`                             | Double  | Cool mode setpoint °C                          |
| `hotTemp`                              | Double  | Heat mode setpoint °C                          |
| `autoTemp`                             | Double  | Auto mode setpoint °C                          |
| `dryTemp`                              | Double  | Dry mode setpoint °C                           |
| `airFlow`                              | Integer | `0`=auto, `1`–`4`=speeds                       |
| `windDirectionUD`                      | Integer | `0`=swing, `1`–`4`=positions                   |
| `windDirectionLR`                      | Integer | `0`=swing, `1`–`7`=positions                   |
| `indoorTemp`                           | Double  | Indoor temperature °C                          |
| `outdoorTemp`                          | Double  | Outdoor temperature °C                         |
| `entrust`                              | Integer | `0`=off, `1`=on                                |
| `statReceiveDate`                      | Long    | Unix ms timestamp of last state report         |
| `isPresetTempAutoForAuto/Cool/Hot/Dry` | Boolean | Per-mode preset temp auto flag                 |
| `firmType`                             | String  | Adapter firmware type                          |
| `wireless.firmVer`                     | String  | Wi-Fi adapter firmware version                 |
| `mcu.firmVer`                          | String  | AC MCU firmware version                        |

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
```

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

> ☁️ **Cloud API only** — sends to `https://spa.smartmair.com/server/setOptionSetting`.

```json
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

> **Note on `airconName`:** must be Base64-encoded. Example: `"Living Room"` → `"TGl2aW5nIFJvb20="`.

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

> **Source:** verified against decompiled `AirconStatCoder.java` from `jp.co.mhi_mth.smartmair`.

The `airconStat` base64 string encodes a command half and a receive half concatenated:

```
base64( [command_half] + [receive_half] )
```

### Command half structure

```
[18 bytes payload] + [variable trailer] + [2 bytes CRC16]
```

The trailer is `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]` for most models. For models with home leave mode the trailer is variable-length — see Encoder Notes below.

### Receive half structure

The receive half returned by the **device** is longer than 25 bytes because the AC appends sensor extension data:

```
[18 bytes payload] + [1 byte count] + [count × 4 byte tuples] + [2 bytes CRC16]
```

The receive half trailer written by the **app** (when encoding a command) is always the fixed `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]` regardless of model.

Real device example (58 bytes total blob):

- Command half: 25 bytes (18 payload + `01 FF FF FF FF` trailer + 2 CRC)
- Receive half: 33 bytes (18 payload + 1 count + 3×4 tuples + 2 CRC)

### Receive half extension tuples

Each tuple is `[code, sub_code, value, 0xFF]`. Known codes:

| Code   | Sub    | Meaning                                                                   |
| ------ | ------ | ------------------------------------------------------------------------- |
| `0x80` | `0x20` | Indoor temperature — `value` is index into `indoor_temp[]` lookup table   |
| `0x80` | `0x10` | Outdoor temperature — `value` is index into `outdoor_temp[]` lookup table |
| `0x94` | `0x10` | Unknown (possibly error/status code)                                      |

> `indoorTemp`/`outdoorTemp` are **not** JSON fields in the local response — they are only accessible by parsing these tuples from the receive half.

### CRC

CRC-16/CCITT (init `0xFFFF`, poly `0x1021`), covers all bytes before the CRC, appended little-endian (low byte first).

---

### Command half — byte map (18 bytes)

Initialised from `command_init = {0,0,0,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0}` — byte 5 is always `0xFF`.

#### Byte 0 — Model type

| Value  | Model                   | Source constant                                   |
| ------ | ----------------------- | ------------------------------------------------- |
| `0x00` | Separate 2021 (default) | `STATUS_MODEL_NO_TYPE_SEPARATE_2021`              |
| `0x01` | Global 2022             | `STATUS_MODEL_NO_TYPE_GLOBAL_2022`                |
| `0x02` | High-end Japanese 2023  | `STATUS_MODEL_NO_TYPE_HIGH_END_FOR_JAPANESE_2023` |
| `0x03` | ZT 2025                 | `STATUS_MODEL_NO_TYPE_ZT_2025`                    |
| `0x40` | FDT 2023                | `STATUS_MODEL_NO_TYPE_FDT_2023`                   |

#### Byte 2 — Operation + mode + vertical swing

**Operation (bits 0–1)** — from `op_p_on/op_p_of`:

| Value  | Meaning |
| ------ | ------- |
| `0x02` | OFF     |
| `0x03` | ON      |

**Mode (bits 2–5)** — from `om_p_*` arrays. Japanese abbreviations: re=冷房(cool), dn=暖房(heat), so=送風(fan), jo=除湿(dry):

| Value  | Mode     | Source    |
| ------ | -------- | --------- |
| `0x20` | Auto     | `om_p_au` |
| `0x28` | Cool     | `om_p_re` |
| `0x30` | Heat     | `om_p_dn` |
| `0x2C` | Fan only | `om_p_so` |
| `0x24` | Dry      | `om_p_jo` |

**Vertical swing (bits 6–7)** — from `as_p_on/as_p_of`:

| Value  | Meaning            |
| ------ | ------------------ |
| `0xC0` | Vertical swing ON  |
| `0x80` | Vertical swing OFF |

#### Byte 3 — Fan speed + vertical position

**Fan speed (low nibble, bits 0–3)** — from `af_p_*` arrays:

| Value  | Speed   | Source    |
| ------ | ------- | --------- |
| `0x0F` | Auto    | `af_p_00` |
| `0x08` | Speed 1 | `af_p_01` |
| `0x09` | Speed 2 | `af_p_02` |
| `0x0A` | Speed 3 | `af_p_03` |
| `0x0E` | Speed 4 | `af_p_04` |

**Vertical position (high nibble, bits 4–7)** — from `lv_p_*` arrays, only written when swing is OFF:

| Value  | Position   | Source    |
| ------ | ---------- | --------- |
| `0x80` | Position 1 | `lv_p_01` |
| `0x90` | Position 2 | `lv_p_02` |
| `0xA0` | Position 3 | `lv_p_03` |
| `0xB0` | Position 4 | `lv_p_04` |

> When swing is ON, `lv_p_01` (0x80) is still ORed in but has no effect since `as_p_on` already sets bits 6–7.

#### Byte 4 — Temperature

```
byte = int(temp / 0.5) + 128
```

Examples: 20°C → `0xA8`, 22°C → `0xAC`, 25°C → `0xB2`

Range: 16.0°C – 31.0°C in 0.5° steps. Fan mode always forces 25°C regardless of input.

#### Byte 9 — Preset temp auto (command)

From `PRESET_TEMP_AUTO_ON_COMMAND / PRESET_TEMP_AUTO_OFF_COMMAND`:

| Value  | Meaning             |
| ------ | ------------------- |
| `0x01` | Preset temp auto ON |
| `0x00` | OFF                 |

#### Byte 10 — Vacant property / self-clean reset

From `COMMAND_VACANT_PROPERTY_ON` and `COMMAND_SELF_CLEAN_RESET_ON`:

| Value  | Meaning                          |
| ------ | -------------------------------- |
| `0x01` | Vacant property ON (model-gated) |
| `0x04` | Self-clean reset (model-gated)   |

#### Byte 11 — Horizontal position

From `lh_p_*` arrays:

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

**Horizontal swing (bits 0–1)** — from `av_p_on/av_p_of`:

| Value  | Meaning              |
| ------ | -------------------- |
| `0x03` | Horizontal swing ON  |
| `0x02` | Horizontal swing OFF |

**Entrust (bits 2–3)** — from `en_p_on/en_p_of`:

| Value  | Meaning |
| ------ | ------- |
| `0x08` | OFF     |
| `0x0C` | ON      |

**Self-clean operation (bits 4–7)** — from `COMMAND_OPERATION_MODE2_ON/OFF`:

| Value  | Meaning |
| ------ | ------- |
| `0x80` | OFF     |
| `0x90` | ON      |

---

### Receive half — byte map (18 bytes)

Initialised from `receive_init = {0,0,0,0,0,255,0,0,0,0,0,0,0,0,0,0,0,0}` — byte 5 is always `0xFF`.

> **Important:** the receive half uses **different encodings** from the command half for operation, mode, fan speed, and positions. Do not mix them up when decoding.

#### Byte 0 — Model type

Same values as command half byte 0. The model type is ORed into byte 0 of the receive half by `receiveToByte` using the same `STATUS_MODEL_NO_TYPE_*` constants.

#### Byte 2 — Operation + mode + vertical swing

**Operation (bit 0)** — from `op_n_on/op_n_of`:

| Value  | Meaning |
| ------ | ------- |
| `0x01` | ON      |
| `0x00` | OFF     |

**Mode (bits 2–4)** — from `om_n_*` arrays. **Different encoding from command half:**

| Value  | Mode     | Source    |
| ------ | -------- | --------- |
| `0x00` | Auto     | `om_n_au` |
| `0x08` | Cool     | `om_n_re` |
| `0x10` | Heat     | `om_n_dn` |
| `0x0C` | Fan only | `om_n_so` |
| `0x04` | Dry      | `om_n_jo` |

**Vertical swing (bit 6)** — from `as_n_on/as_n_of`:

| Value  | Meaning   |
| ------ | --------- |
| `0x40` | Swing ON  |
| `0x00` | Swing OFF |

#### Byte 3 — Fan speed + vertical position

**Fan speed (low nibble, bits 0–3)** — from `af_n_*` arrays. **Different encoding from command half:**

| Value  | Speed   | Source    |
| ------ | ------- | --------- |
| `0x07` | Auto    | `af_n_00` |
| `0x00` | Speed 1 | `af_n_01` |
| `0x01` | Speed 2 | `af_n_02` |
| `0x02` | Speed 3 | `af_n_03` |
| `0x06` | Speed 4 | `af_n_04` |

**Vertical position (high nibble, bits 4–7)** — from `lv_n_*` arrays, when swing OFF:

| Value  | Position   | Source    |
| ------ | ---------- | --------- |
| `0x00` | Position 1 | `lv_n_01` |
| `0x10` | Position 2 | `lv_n_02` |
| `0x20` | Position 3 | `lv_n_03` |
| `0x30` | Position 4 | `lv_n_04` |

#### Byte 4 — Temperature

```
byte = int(temp / 0.5)
```

Examples: 20°C → `0x28`, 22°C → `0x2C`. Fan mode always forces 25°C.

#### Byte 7 — Preset temp auto (status)

From `PRESET_TEMP_AUTO_ON_STATUS`:

| Value  | Meaning             |
| ------ | ------------------- |
| `0x80` | Preset temp auto ON |
| `0x00` | OFF                 |

#### Byte 10 — Vacant property (status)

From `STATUS_VACANT_PROPERTY_ON/OFF` (model-gated):

| Value  | Meaning            |
| ------ | ------------------ |
| `0x01` | Vacant property ON |
| `0x00` | OFF                |

#### Byte 11 — Horizontal position

From `lh_n_*` arrays. **0-indexed** — different from command half:

| Value  | Position   | Source    |
| ------ | ---------- | --------- |
| `0x00` | Position 1 | `lh_n_01` |
| `0x01` | Position 2 | `lh_n_02` |
| `0x02` | Position 3 | `lh_n_03` |
| `0x03` | Position 4 | `lh_n_04` |
| `0x04` | Position 5 | `lh_n_05` |
| `0x05` | Position 6 | `lh_n_06` |
| `0x06` | Position 7 | `lh_n_07` |

#### Byte 12 — Horizontal swing + entrust

**Horizontal swing (bit 0)** — from `av_n_on/av_n_of`:

| Value  | Meaning              |
| ------ | -------------------- |
| `0x01` | Horizontal swing ON  |
| `0x00` | Horizontal swing OFF |

**Entrust (bit 2)** — from `en_n_on/en_n_of`:

| Value  | Meaning     |
| ------ | ----------- |
| `0x04` | Entrust ON  |
| `0x00` | Entrust OFF |

> Swing and entrust occupy different bits and can be combined.

#### Byte 15 — Self-clean operation status

From `STATUS_OPERATION_MODE2_ON/OFF`:

| Value  | Meaning                 |
| ------ | ----------------------- |
| `0x01` | ON (self-clean running) |
| `0x00` | OFF                     |

---

### Encoder notes

**Fan mode temperature** — when `operationMode == 3` (fan only), the encoder ignores the preset temp and forces byte 4 to `25.0°C` in both halves.

**Horizontal swing is model-gated** — `windDirectionLR` is only encoded if `enabledWindDirectionLR()` is true. Otherwise position 1 with swing off is always written.

**Entrust is model-gated** — only encoded if `enableEntrust()` is true.

**Vacant property is model-gated** — only encoded if `enableVacantProperty()` is true.

**Self-clean is model-gated** — only encoded if `enableSelfCleanOperation()` is true.

**`zeros` array mutation** — the Java source reuses the shared `zeros` array to set temp: `zeros[4] = int(temp/0.5) + 128`. This is a side-effect mutation of a shared static array. In practice it works because temp is always set before the array is passed to `toBytes()`, but it is technically a bug in the original code.

### Variable-length trailer (home leave mode)

For models that support home leave mode (`enableHomeLeaveMode()`), the command half trailer replaces the fixed 5 bytes with:

```
[count, op1, sub1, val1, op2, sub2, val2, ...]
```

Where `count = list.size() / 4` and `op_code` is always `0xF8` (248). Sub-codes:

| Sub-code | Meaning                         |
| -------- | ------------------------------- |
| `27`     | Temp rule for cooling × 2       |
| `28`     | Temp rule for heating × 2       |
| `29`     | Temp setting for cooling × 2    |
| `30`     | Temp setting for heating × 2    |
| `31`     | Fan speed for cooling (encoded) |
| `32`     | Fan speed for heating (encoded) |

Fan speed encoding: `0`=auto, `3`=speed1, `5`=speed2, `7`=speed3, `14`=speed4.

When requesting home leave mode status (not setting it), all 6 tuples use `sub_code = 0xFF` and `value = 0`.

The receive half always uses the fixed `[0x01, 0xFF, 0xFF, 0xFF, 0xFF]` trailer.

---

## Model Capability Matrix

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

`indoorTemp` and `outdoorTemp` are byte indices into fixed lookup tables in `res/values/arrays.xml`. The device returns a raw byte index; look up °C from the arrays.

### Indoor temp table (256 entries)

Covers **−30.0°C to +52.0°C**. Index 0–15 clamp to −30.0°C. Full table is in `INDOOR_TEMP` in `mhi_codec.py`. Selected values:

| Index | °C    | Index | °C   | Index | °C   |
| ----- | ----- | ----- | ---- | ----- | ---- |
| 0–15  | −30.0 | 100   | 9.5  | 160   | 25.2 |
| 69    | 0.0   | 120   | 15.0 | 170   | 27.7 |
| 80    | 3.5   | 130   | 17.7 | 180   | 30.2 |
| 90    | 6.6   | 140   | 20.2 | 190   | 33.0 |
| 95    | 8.0   | 150   | 22.7 | 255   | 52.0 |

### Outdoor temp table (256 entries)

Covers **−50.0°C to +43.0°C**. Index 0–4 clamp to −50.0°C. Full table is in `OUTDOOR_TEMP` in `mhi_codec.py`. Selected values:

| Index | °C    | Index | °C   | Index | °C   |
| ----- | ----- | ----- | ---- | ----- | ---- |
| 0–4   | −50.0 | 90    | 0.0  | 160   | 17.5 |
| 35    | −20.0 | 100   | 2.7  | 180   | 22.2 |
| 60    | −9.3  | 120   | 7.7  | 220   | 32.5 |
| 75    | −4.3  | 140   | 12.7 | 255   | 43.0 |

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

- The `operatorId` must be registered via `updateAccountInfo` before any other command will work.
- The app polls `getAirconStat` after `setAirconStat` for up to 30 seconds to confirm the AC accepted the new state.
- `indoorTemp` and `outdoorTemp` are embedded in the `airconStat` blob receive half extension tuples (codes `0x80/0x20` and `0x80/0x10`), not JSON fields.
- `highTemp` and `lowTemp` in the JSON response are hex-encoded strings (e.g. `"AB"`). Parse with `int(v, 16)`.
- `result: 1` on any local command means the operatorId is not registered.
- There is no way to list registered operatorIds — `remoteList` always returns empty strings.
- `coolingOnly` in the app UI is stored locally only — it has no wire representation.
- The command half and receive half use **different encodings** for mode, fan speed, and positions. Always decode from the receive half (bytes 25–42), not the command half.
