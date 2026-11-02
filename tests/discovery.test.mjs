import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";

for (const file of process.argv.length > 2 ? process.argv.slice(2) : ["airthings-card.js", "snapshots/dev/airthings-card.js"]) {
  test(file + ": discovery recovers without reloading the page", async () => {
    let now = 1000000;
    const definitions = new Map();
    const context = vm.createContext({
      HTMLElement: class {}, window: {},
      customElements: { define: (name, value) => definitions.set(name, value) },
      Date: class extends Date { static now() { return now; } },
      console: { info() {}, warn() {} }
    });
    vm.runInContext(readFileSync(file, "utf8"), context);
    const Card = definitions.get("airthings-card");
    const card = new Card();
    card._render = card._renderSafely = card._refresh = card._loadHistory = () => {};
    card._config = { device_id: "a" };
    card._effectiveEntities = [];
    card._hass = { entities: {}, states: {} };
    await card._resolveDeviceEntities();
    assert.equal(card._effectiveEntities.length, 0);
    // HA delivers registry and state separately.
    card._hass.entities = { "sensor.room_co2": { device_id: "a" } };
    await card._resolveDeviceEntities();
    card._hass.states = { "sensor.room_co2": { state: "650", attributes: {} } };
    now += 5001;
    await card._resolveDeviceEntities();
    assert.equal(card._effectiveEntities[0].entity, "sensor.room_co2");
    // A transient registry/API failure must preserve discovered sensors.
    delete card._hass.entities;
    card._hass.callWS = async () => { throw Error("offline"); };
    await card._resolveDeviceEntities();
    assert.equal(card._effectiveEntities[0].entity, "sensor.room_co2");
    let calls = 0;
    card._hass.callWS = async () => {
      calls++;
      return [{ entity_id: "sensor.room_co2", device_id: "a" }];
    };
    now += 5001;
    await card._resolveDeviceEntities();
    assert.equal(calls, 1);
    assert.equal(card._resolvingDevice, "");
    // Empty transient state snapshots do not remove known sensors.
    now += 300001;
    card._hass.states = {};
    await card._resolveDeviceEntities();
    assert.equal(card._effectiveEntities[0].entity, "sensor.room_co2");
  });

  test(file + ": old lookup cannot overwrite a new device configuration", async () => {
    const definitions = new Map();
    const context = vm.createContext({
      HTMLElement: class { attachShadow() { this.shadowRoot = {}; } }, window: {},
      customElements: { define: (name, value) => definitions.set(name, value) },
      console: { info() {}, warn() {} }
    });
    vm.runInContext(readFileSync(file, "utf8"), context);
    const card = new (definitions.get("airthings-card"))();
    card._render = card._renderSafely = card._refresh = card._loadHistory = card._scheduleRefresh = () => {};
    card.setConfig({ device_id: "a" });
    let finish;
    card._hass = { states: {}, callWS: () => new Promise(resolve => { finish = resolve; }) };
    const oldLookup = card._resolveDeviceEntities();
    card.setConfig({ device_id: "b", entities: ["sensor.b_co2"] });
    finish([{ entity_id: "sensor.a_co2", device_id: "a" }]);
    await oldLookup;
    assert.equal(card._effectiveEntities[0], "sensor.b_co2");
  });
}
