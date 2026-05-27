# KazeMBridge

Home Assistant custom integration for Mitsubishi Heavy Industries ACs with the WF-RAC-HTTPS Wi-Fi adapter. Local Wi-Fi only, no cloud.

## Key files

| Path | Purpose |
|------|---------|
| `integration/custom_components/kazembridge/` | The HA integration (install this into HA) |
| `integration/custom_components/kazembridge/manifest.json` | Integration metadata — includes zeroconf declaration |
| `integration/custom_components/kazembridge/www/kazembridge-card.js` | Custom Lovelace card (auto-registered by the integration) |
| `tools/mhi_codec.py` | Standalone CLI codec for encode/decode testing |
| `research/research.md` | Full reverse-engineered API documentation |

## Integration structure

- `api.py` — aiohttp wrapper for the device HTTPS API on port 51443 (`ssl=False`)
- `coordinator.py` — `DataUpdateCoordinator` polling `getAirconStat` every 30 s; parses blob and JSON fields (`auto_heating`, `led_stat`, `num_of_account`)
- `climate.py` — `ClimateEntity` (on/off, modes, temp, fan, swing, entrust); exposes `auto_heating`, `led_stat`, `num_of_account` as extra_state_attributes
- `sensor.py` — indoor + outdoor `SensorEntity` (parsed from the airconStat blob)
- `select.py` — horizontal vane `SelectEntity`
- `mhi_codec.py` — self-contained copy of the codec; `decode()` returns clean Python types, `encode()` builds a fresh blob from parameters
- `config_flow.py` — two entry points: `async_step_user` (manual IP) and `async_step_zeroconf` (mDNS auto-discovery via `_beaver._tcp.local.`)
- `translations/en.json` — English config-flow strings; `translations/nl.json` — Dutch

## The binary protocol

All AC state travels as a base64 blob (`airconStat`). The blob is `base64(command_half + receive_half)`. `encode()` always builds a fresh blob from parameters — it does not patch an existing blob. `decode()` reads from the receive half (offset 25). See `research/research.md` for the full byte map.

Key encoding rules (easy to get wrong):
- Command half byte 0 is always `0x00`; receive half byte 0 carries the `model_type` (echoed from last decode).
- Byte 3 (vertical position) and byte 11 (horizontal position) must always contain a valid position, even when swing is ON — omitting them causes `result=12`.
- Entrust encoding differs: command half uses `0x0C`/`0x08`; receive half uses `0x04`/`0x00`.

## Auto-discovery

The adapter advertises itself as `_beaver._tcp.local.` via mDNS. `manifest.json` declares this to HA, and `config_flow.py::async_step_zeroconf` handles the discovery event. The MAC address (= `airconId`) is extracted from the mDNS service name to set the unique ID early, preventing duplicate flows.

## Rules

- The integration is self-contained — never import from `tools/`.
- `tools/mhi_codec.py` keeps its `if __name__ == '__main__':` block for CLI use.
- Match HA patterns: `CoordinatorEntity`, `DataUpdateCoordinator`, config flow with `async_set_unique_id`.
- No comments unless the why is non-obvious.
