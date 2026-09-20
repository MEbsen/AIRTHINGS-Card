# Airthings Card

A responsive Home Assistant card for one Airthings device. Each measurement
combines its current value, health colour and recent history in one glance.

> **Status:** v0.2.5 preview. The YAML API can change before v1.0.

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

Add **Custom: Airthings Card** from Home Assistant's card picker. The card starts
without a preselected device. Choose one from the **Airthings device** radio list;
the list contains devices exposing supported air-quality sensors, and the card
then discovers their sensors automatically.
YAML remains available:

~~~yaml
type: custom:airthings-card
device_id: 0123456789abcdef
title: Bedroom # optional
hours: 24
~~~

The visual editor writes the device ID for you. Existing configurations using
the manual entities list remain supported as a fallback.

## Current preview

- Visual editor with one Home Assistant device picker.
- Automatic Airthings sensor discovery through HA's device/entity registry.
- Responsive card and SVG sparklines.
- Automatic column count based on the width assigned by the dashboard layout.
- History from Home Assistant recorder API.
- Threshold colour on current value and individual graph segments.
- Measurement click opens the Home Assistant more-info dialog.
- Graceful unavailable sensor and missing history states.

## Planned before v1.0

- Editor controls for time range, thresholds and graph detail.
- Optional compact layout and per-device summary.
- Localised labels, including Danish.
- Desktop, tablet and mobile test matrix.

## Development

The preview is a dependency-free JavaScript module so HACS can load it directly.

~~~bash
npm run check
~~~
