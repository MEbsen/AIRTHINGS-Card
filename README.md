# Airthings Card

A responsive Home Assistant card for one Airthings device. Each measurement
combines its current value, health colour and recent history in one glance.

> **Status:** early development preview. The YAML API can change before v1.0.

![Two responsive Airthings Card concepts](docs/concepts.svg)

## Design goals

- One card per physical Airthings device.
- SVG history graphs that stay sharp at every dashboard size.
- Current values and graph segments share the same threshold colours.
- Responsive layout without horizontal scrolling.
- Home Assistant theme colours, entity dialogs and history API.
- Any numeric HA sensor can be used; no dependency on one integration.

## Install with HACS

Until this repository is included in HACS defaults:

1. Open **HACS → Frontend**.
2. Add https://github.com/MEbsen/AIRTHINGS-Card as a custom repository with
   category **Dashboard**.
3. Install **Airthings Card** and reload the browser.

If HACS has not created the resource, add:

~~~text
/hacsfiles/AIRTHINGS-Card/airthings-card.js
~~~

Resource type: **JavaScript module**.

## First configuration

~~~yaml
type: custom:airthings-card
title: Bedroom
hours: 24
columns: auto
entities:
  - entity: sensor.bedroom_radon
    type: radon
  - entity: sensor.bedroom_co2
    type: co2
  - entity: sensor.bedroom_voc
    type: voc
  - entity: sensor.bedroom_temperature
    type: temperature
  - entity: sensor.bedroom_humidity
    type: humidity
  - entity: sensor.bedroom_pressure
    type: pressure
~~~

Preview presets: radon, co2, voc, temperature, humidity and pressure.

## Current preview

- Responsive card and SVG sparklines.
- History from Home Assistant recorder API.
- Threshold colour on current value and individual graph segments.
- Measurement click opens the Home Assistant more-info dialog.
- Graceful unavailable sensor and missing history states.

## Planned before v1.0

- Visual editor with entity picker.
- Automatic grouping/discovery from an Airthings HA device.
- Editor controls for time range, thresholds and graph detail.
- Optional compact layout and per-device summary.
- Localised labels, including Danish.
- Desktop, tablet and mobile test matrix.

## Development

The preview is a dependency-free JavaScript module so HACS can load it directly.

~~~bash
npm run check
~~~
