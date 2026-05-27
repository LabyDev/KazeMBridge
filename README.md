# KazeMBridge

Home Assistant custom integration for **Mitsubishi Heavy Industries ACs** with the **WF-RAC-HTTPS** Wi-Fi adapter. Controls the AC entirely over local Wi-Fi — no cloud, no account required.

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![GitHub release](https://img.shields.io/github/v/release/LabyDev/KazeMBridge)](https://github.com/LabyDev/KazeMBridge/releases)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-aperturecoffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/aperturecoffee)

---

## What it exposes

| Entity | Type | Description |
|---|---|---|
| `climate.<name>` | Climate | On/off, modes (auto/cool/heat/fan/dry), temp 16–31 °C (0.5° steps), fan auto/1–4, vertical swing (swing + 4 positions), 3D Auto preset |
| `select.<name>_horizontal_vane` | Select | Horizontal vane: normal / both\_left / left\_center / both\_center / center\_right / both\_right / wide / swing |
| `sensor.<name>_indoor_temperature` | Sensor | Indoor temperature (°C) — parsed from the airconStat blob |
| `sensor.<name>_outdoor_temperature` | Sensor | Outdoor temperature (°C) — parsed from the airconStat blob |

Extra state attributes on the climate entity: `indoor_temp`, `outdoor_temp`, `auto_heating` (frost protection, read-only), `led_stat`, `num_of_account`, `model_type`.

---

## Installation

### Via HACS (recommended)

1. Open HACS in Home Assistant.
2. Go to **Integrations → ⋮ → Custom repositories**.
3. Add `https://github.com/LabyDev/KazeMBridge` with category **Integration**.
4. Click **Download** on the KazeMBridge card.
5. Restart Home Assistant.

### Manual

1. Copy `integration/custom_components/kazembridge/` into your HA `config/custom_components/` directory.
2. Restart Home Assistant.

### Setup

- Go to **Settings → Integrations → Add Integration** and search for **KazeMBridge**.
- If your adapter is on the local network, Home Assistant may detect it automatically via **mDNS** and show a discovery notification — just confirm the IP address.
- Or add it manually by entering the adapter's local IP address.

The integration generates a UUID operator ID and registers it with the AC on first setup.

---

## Lovelace card

A custom Lovelace card with visual vane controls is bundled inside the integration and registered automatically — no manual resource installation needed.

```yaml
type: custom:kazembridge-card
entity: climate.mhi_ac
indoor_sensor: sensor.mhi_ac_indoor_temperature    # optional
outdoor_sensor: sensor.mhi_ac_outdoor_temperature  # optional
```

The card shows:
- Mode buttons (Off / Auto / Cool / Heat / Fan / Dry)
- Temperature control with optimistic UI (updates instantly, syncs to AC within ~5 s)
- Animated vane diagrams — front view (horizontal airflow) and side view (vertical airflow)
- Vertical and horizontal vane position selectors with visual louver icons
- Fan speed selector
- 3D Auto (Entrust) toggle
- Frost Protection badge (read-only) — shown when the adapter reports `autoHeating = 1`
- Presets — save/apply/delete named setting combinations, per-AC or global
- Indoor and outdoor temperature chips (when sensor entities are configured)
- Supports English and Dutch UI (follows your HA language setting)

---

## Auto-discovery

The WF-RAC adapter advertises itself on the local network as an mDNS service of type `_beaver._tcp.local.` Home Assistant detects this automatically when KazeMBridge is installed, and will show a notification in the Integrations panel. You only need to confirm the IP address — no manual search required.

---

## Requirements

- MHI AC with a **WF-RAC-HTTPS** Wi-Fi adapter reachable on your local network
- Home Assistant 2024.1.0 or newer
- Recommended: assign a static DHCP lease to the adapter via your router

---

## Repo structure

```
integration/
  custom_components/
    kazembridge/
      __init__.py       Entry point — sets up API, coordinator, platforms
      manifest.json     Integration metadata (includes zeroconf declaration)
      hacs.json         HACS metadata
      const.py          Domain constants and mode/position mappings
      config_flow.py    UI setup flow (manual IP entry + mDNS auto-discovery)
      api.py            aiohttp HTTPS client for the device API
      coordinator.py    DataUpdateCoordinator — polls every 30 s
      mhi_codec.py      Binary blob encoder/decoder
      climate.py        ClimateEntity
      sensor.py         Indoor + outdoor temperature SensorEntity
      select.py         Horizontal vane SelectEntity
      translations/
        en.json         English strings (config flow)
        nl.json         Dutch strings (config flow)
      www/
        kazembridge-card.js   Custom Lovelace card (auto-registered)
tools/
  mhi_codec.py    Standalone CLI codec — decode/encode blobs for debugging
research/
  research.md     Full reverse-engineered API and binary protocol documentation
```

---

## CLI codec tool

```bash
python tools/mhi_codec.py
```

Decodes a sample blob and shows a round-trip encode→decode result. Useful for verifying protocol changes before deploying.

---

## How it works

The WF-RAC adapter exposes a local HTTPS API on port 51443. All AC state is packed into a binary blob (`airconStat`) encoded as base64. The integration decodes this blob to read state and re-encodes it to send commands. See [`research/research.md`](research/research.md) for the full API and encoding documentation.

---

## License & legal

This project is licensed under the **GNU General Public License v3.0 or later**, see [`LICENSE`](LICENSE).

The MHI WF-RAC binary protocol documented in [`research/research.md`](research/research.md) was obtained through reverse engineering for the sole purpose of achieving interoperability with third-party software (Home Assistant). [EU Directive 2009/24/EC, Article 6](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009L0024#d1e530-23-1) permits decompilation and reverse engineering under these conditions; contractual provisions that purport to restrict this exception are unenforceable under EU law. The Netherlands implements this in the [*Auteurswet*, Article 45m](https://wetten.overheid.nl/BWBR0001886/#Artikel45m).

Mitsubishi Heavy Industries retains all rights to their firmware, protocol, and trademarks. This project is not affiliated with or endorsed by MHI.

---

## Known limitations

- **Hi / Eco / Silent / Allergy / Night setback / Timers** — present in the SmartM-Air app but absent from the local binary protocol. Not controllable via this integration.
- **Frost protection / LED / auto-heating** — readable from the local API but only writable via the cloud `setOptionSetting` endpoint. Shown as read-only attributes.
- The AC takes approximately 5 seconds to apply a command and report the new state back.
