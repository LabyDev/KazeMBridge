# KazeMBridge

Home Assistant custom integration for Mitsubishi Heavy Industries ACs with the WF-RAC-HTTPS Wi-Fi adapter. Local Wi-Fi only, no cloud.

## Key files

| Path | Purpose |
|------|---------|
| `integration/custom_components/kazembridge/` | The HA integration (install this into HA) |
| `tools/mhi_codec.py` | Standalone CLI codec for encode/decode testing |
| `research/research.md` | Full reverse-engineered API documentation |

## Integration structure

- `api.py` — aiohttp wrapper for the device HTTPS API on port 51443 (`ssl=False`)
- `coordinator.py` — `DataUpdateCoordinator` polling `getAirconStat` every 30 s
- `climate.py` — `ClimateEntity` (on/off, modes, temp, fan, swing)
- `sensor.py` — indoor + outdoor `SensorEntity` (parsed from the airconStat blob)
- `mhi_codec.py` — self-contained copy of the codec; `decode()` returns clean Python types, `encode()` builds a fresh blob from parameters
- `config_flow.py` — single-step UI flow: enter IP, auto-discover `airconId`, auto-register UUID operator

## The binary protocol

All AC state travels as a base64 blob (`airconStat`). The blob is `base64(command_half + receive_half)`. `encode()` always builds a fresh blob from the six parameters — it does not patch an existing blob. `decode()` reads from the receive half (offset 25). See `research/research.md` for the full byte map.

## Rules

- The integration is self-contained — never import from `tools/`.
- `tools/mhi_codec.py` keeps its `if __name__ == '__main__':` block for CLI use.
- Match HA patterns: `CoordinatorEntity`, `DataUpdateCoordinator`, config flow with `async_set_unique_id`.
- No comments unless the why is non-obvious.
