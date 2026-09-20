# Airthings Card

[![Validate](https://github.com/MEbsen/AIRTHINGS-Card/actions/workflows/validate.yml/badge.svg)](https://github.com/MEbsen/AIRTHINGS-Card/actions/workflows/validate.yml)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?logo=home-assistant-community-store)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Home Assistant 2024.8+](https://img.shields.io/badge/Home%20Assistant-2024.8%2B-18BCF2.svg?logo=homeassistant&logoColor=white)](https://www.home-assistant.io/)
[![MIT License](https://img.shields.io/github/license/MEbsen/AIRTHINGS-Card)](LICENSE)

A responsive Home Assistant dashboard card for Airthings devices. Select one
device and the card automatically discovers its measurements, shows the current
values with quality colours, and draws colour-coded SVG history graphs.

> **Preview:** v0.4.0. Configuration may change before v1.0.

![Airthings Card desktop and mobile layouts](docs/concepts.svg)

## Highlights

- One card per physical Airthings device.
- Visual editor with automatic device and sensor discovery.
- Radon, CO₂, temperature, humidity, VOC, pressure, light, noise, PM2.5 and
  PM1 support when exposed by the selected model.
- Battery icon and exact percentage beside the device name.
- Stable, configurable measurement order across cards.
- Responsive one-to-many-column layout without horizontal scrolling.
- Sharp SVG sparklines using Home Assistant Recorder history.
- Matching quality colours on current values and individual graph segments.
- Click any measurement or the battery indicator to open HA's more-info dialog.
- Home Assistant theme colours and graceful unavailable states.

## Requirements

- Home Assistant 2024.8.0 or newer.
- An Airthings device already available in Home Assistant through an integration.
- Recorder history enabled for measurements that should display a graph.

## Installation with HACS

This repository is currently installed as a custom HACS repository:

[![Open your Home Assistant instance and add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=MEbsen&repository=AIRTHINGS-Card&category=plugin)

Use the button above for one-click setup, or add it manually:

1. Open **HACS → Frontend**.
2. Open the menu and choose **Custom repositories**.
3. Add `https://github.com/MEbsen/AIRTHINGS-Card`.
4. Select category **Dashboard** and add the repository.
5. Install **Airthings Card**.
6. Reload Home Assistant in the browser.

HACS normally creates the Lovelace resource automatically. If it does not,
add the following resource manually under **Settings → Dashboards → Resources**:

```text
/hacsfiles/AIRTHINGS-Card/airthings-card.js
```

Resource type: **JavaScript module**.

## Card configuration

Add **Custom: Airthings Card** from Home Assistant's card picker. In the visual
editor:

1. Select an Airthings device from the radio list.
2. Optionally change the title and history length.
3. Use the arrow buttons to change measurement order, or select **Reset order**
   to restore the default.

Only measurements exposed by the selected device are rendered. Missing sensor
types are skipped without changing the relative order of the remaining tiles.

### YAML example

The visual editor writes the device ID automatically. YAML remains available:

```yaml
type: custom:airthings-card
device_id: 0123456789abcdef
title: Bedroom
hours: 24
sensor_order:
  - radon
  - co2
  - temperature
  - humidity
  - voc
  - pressure
  - light
  - noise
  - pm25
  - pm1
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `device_id` | string | required | Home Assistant device registry ID. Use the visual editor to select it. |
| `title` | string | device name | Optional card title. |
| `hours` | number | `24` | Recorder history window, from 1 to 168 hours. |
| `sensor_order` | list | shown above | Relative order of supported measurements. Unknown and duplicate values are ignored. |

Existing configurations using the legacy manual `entities` list remain
supported as a fallback.

## Supported measurements

| Key | Measurement | Typical HA device class | Quality colours |
| --- | --- | --- | --- |
| `radon` | Radon | Entity-name detection | Yes |
| `co2` | Carbon dioxide | `carbon_dioxide` | Yes |
| `temperature` | Temperature | `temperature` | Yes |
| `humidity` | Relative humidity | `humidity` | Yes |
| `voc` | Volatile organic compounds | `volatile_organic_compounds*` | Yes |
| `pressure` | Atmospheric pressure | `atmospheric_pressure` | Neutral |
| `light` | Illuminance | `illuminance` | Neutral |
| `noise` | Sound pressure / noise | `sound_pressure` | Yes |
| `pm25` | Particulate matter 2.5 | `pm25` | Yes |
| `pm1` | Particulate matter 1 | `pm1` | Yes |

Battery is displayed in the header and signal strength is intentionally omitted.

## Default quality bands

These bands control both the current-value colour and every SVG history
segment. They are display bands for quick comparison, not medical alarm limits.

| Measurement | Good | Fair | Poor | High |
| --- | ---: | ---: | ---: | ---: |
| Radon (Bq/m³) | `<100` | `100–199` | `200–299` | `≥300` |
| CO₂ (ppm) | `<800` | `800–999` | `1000–1399` | `≥1400` |
| Temperature (°C) | `18–24.9` | `<18 or 25–27.9` | `≥28` | — |
| Humidity (%) | `40–59.9` | `30–39.9 or 60–69.9` | `<30 or ≥70` | — |
| VOC (ppb) | `<250` | `250–999` | `1000–1999` | `≥2000` |
| Noise (dB) | `<55` | `55–69.9` | `70–84.9` | `≥85` |
| PM2.5 (µg/m³) | `<10` | `10–24.9` | `25–34.9` | `≥35` |
| PM1 (µg/m³) | `<10` | `10–24.9` | `25–34.9` | `≥35` |
| Pressure / light | Neutral current-value colour; no universal quality band |

PM2.5 follows Airthings' published good/fair boundary values; the additional
red band is a card display tier. PM1 temporarily follows the same display bands
because no separate broadly accepted indoor PM1 standard exists. Noise depends
on room and time of day, while pressure and light are contextual measurements.

## Troubleshooting

### The card is not listed

- Confirm that the repository was added to HACS as category **Dashboard**.
- Confirm that the JavaScript module resource exists.
- Reload the browser without cache after installing or updating.

### The old version is still shown

The loaded version is displayed below the card title. If it has not changed:

1. Select **Redownload** on the Airthings Card page in HACS.
2. Reload Home Assistant without browser cache.
3. Restart the Home Assistant frontend only if the cached resource remains.

### A measurement is missing

- Confirm that the entity is enabled and available on the selected HA device.
- Confirm that its measurement type appears in the supported table above.
- Sensors not exposed by the physical Airthings model are intentionally skipped.

### No history graph is shown

The card needs at least two numeric Recorder history points. Check that Recorder
has not excluded the entity and wait for additional samples when the sensor was
recently added.

## Development

The card is a dependency-free JavaScript module that HACS loads directly.

```bash
npm run check
```

Pull requests and reproducible bug reports are welcome. Include the Home
Assistant version, card version, Airthings model and relevant entity IDs.

## Roadmap

- User-configurable quality thresholds.
- Optional compact layout and per-device summary.
- Localised labels, including Danish.
- Wider desktop, tablet and mobile test coverage.

## License

[MIT](LICENSE)
