# KazeMBridge

Home Assistant custom integration for **Mitsubishi Heavy Industries ACs** with the **WF-RAC-HTTPS** Wi-Fi adapter. Controls the AC entirely over local Wi-Fi — no cloud, no account required.

## What it exposes

- **Climate entity** — on/off, modes (auto / cool / heat / fan / dry), temperature setpoint (16–31 °C in 0.5° steps), fan speed (auto / 1–4), vertical swing (swing / positions 1–4), horizontal vane (7 positions + swing), 3D Auto preset (entrust)
- **Indoor temperature sensor**
- **Outdoor temperature sensor**

## Installation

### Integration

1. Copy `integration/custom_components/kazembridge/` into your HA `config/custom_components/` directory.
2. Restart Home Assistant.
3. Go to **Settings → Integrations → Add Integration** and search for **KazeMBridge**.
4. Enter the local IP address of your AC's Wi-Fi adapter.

The integration auto-generates a UUID operator ID and registers it with the AC on first setup.

### Lovelace card (optional)

A custom card with visual vane controls is included:

1. Copy `lovelace/kazembridge-card.js` to your HA `config/www/` directory.
2. In **Settings → Dashboards → Resources**, add `/local/kazembridge-card.js` (type: JavaScript module).
3. Add a card to your dashboard:

```yaml
type: custom:kazembridge-card
entity: climate.mhi_ac
indoor_sensor: sensor.mhi_ac_indoor_temperature   # optional
outdoor_sensor: sensor.mhi_ac_outdoor_temperature # optional
```

The card shows mode buttons, temperature control, a live side-profile vane SVG, vertical and horizontal vane selectors with visual louver icons, fan speed, and a 3D Auto toggle. Clicking any control updates the UI immediately (optimistic state) with a loading indicator while the AC confirms (~5 seconds).

An example dashboard is at [`lovelace/dashboard.yaml`](lovelace/dashboard.yaml).

## Requirements

- MHI AC with a **WF-RAC-HTTPS** Wi-Fi adapter reachable on your local network
- The adapter's local IP address (recommended: assign a static DHCP lease via your router)

## Repo structure

```
integration/
  custom_components/
    kazembridge/        Install this into HA config/custom_components/
lovelace/
  kazembridge-card.js  Custom Lovelace card
  dashboard.yaml       Example dashboard
tools/                 Standalone CLI tools
research/
  research.md          Full reverse-engineered API documentation
```

## CLI codec tool

`tools/mhi_codec.py` decodes and encodes `airconStat` blobs for debugging:

```bash
python tools/mhi_codec.py
```

## How it works

The WF-RAC adapter exposes a local HTTPS API on port 51443. All AC state is packed into a binary blob (`airconStat`) encoded as base64. The integration decodes this blob to read state and re-encodes it to send commands. See [`research/research.md`](research/research.md) for the full API and encoding documentation.

## Known limitations

- **Hi / Eco / Silent / Allergy / Night setback / Timers** — these features appear in the SmartM-Air app UI but are not part of the local binary protocol. They are not controllable via this integration.
- **Horizontal vane** — exposed as a card-only control for now; HA's climate entity does not have a native horizontal swing attribute.
- The AC takes approximately 5 seconds to apply a command and confirm the new state.
