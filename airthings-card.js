const VERSION = "0.4.0";
const COLORS = {
  good: "#20a464", fair: "#e8bd24", poor: "#ef7b22",
  high: "#d93645", neutral: "#4395c6", unavailable: "#7f8a93"
};
const PRESETS = {
  radon: { name: "Radon", icon: "mdi:radioactive", limits: [[100,"good","Good"],[200,"fair","Fair"],[300,"poor","Poor"],[null,"high","High"]] },
  pm25: { name: "PM2.5", icon: "mdi:blur", limits: [[10,"good","Good"],[25,"fair","Fair"],[35,"poor","Poor"],[null,"high","High"]] },
  pm1: { name: "PM1", icon: "mdi:dots-hexagon", limits: [[10,"good","Good"],[25,"fair","Fair"],[35,"poor","Poor"],[null,"high","High"]] },
  co2: { name: "CO₂", icon: "mdi:molecule-co2", limits: [[800,"good","Good"],[1000,"fair","Fair"],[1400,"poor","Poor"],[null,"high","High"]] },
  voc: { name: "VOC", icon: "mdi:weather-windy", limits: [[250,"good","Good"],[1000,"fair","Fair"],[2000,"poor","Poor"],[null,"high","High"]] },
  temperature: { name: "Temperature", icon: "mdi:thermometer", ranges: [[null,18,"fair","Cool"],[18,25,"good","Good"],[25,28,"fair","Warm"],[28,null,"poor","High"]] },
  humidity: { name: "Humidity", icon: "mdi:water-outline", ranges: [[null,30,"poor","Dry"],[30,40,"fair","Fair"],[40,60,"good","Good"],[60,70,"fair","Fair"],[70,null,"poor","High"]] },
  pressure: { name: "Pressure", icon: "mdi:gauge", limits: [[null,"neutral","Current"]] },
  noise: { name: "Noise", icon: "mdi:volume-medium", limits: [[55,"good","Quiet"],[70,"fair","Noticeable"],[85,"poor","Loud"],[null,"high","High"]] },
  light: { name: "Light", icon: "mdi:brightness-6", limits: [[null,"neutral","Current"]] }
};
const DEFAULT_SENSOR_ORDER = ["radon", "co2", "temperature", "humidity", "voc", "pressure", "light", "noise", "pm25", "pm1"];

function normalizedSensorOrder(value) {
  const configured = Array.isArray(value) ? value.filter((type, index, order) =>
    DEFAULT_SENSOR_ORDER.includes(type) && order.indexOf(type) === index) : [];
  return configured.concat(DEFAULT_SENSOR_ORDER.filter((type) => !configured.includes(type)));
}

function sensorType(entityId, state) {
  const id = String(entityId || "").toLowerCase();
  const deviceClass = String(state && state.attributes && state.attributes.device_class || "").toLowerCase();
  if (id.includes("radon")) return "radon";
  if (deviceClass === "pm25" || /(^|_)pm_?2_?5($|_)/.test(id)) return "pm25";
  if (deviceClass === "pm1" || /(^|_)pm_?1($|_)/.test(id)) return "pm1";
  if (deviceClass === "carbon_dioxide" || /(^|_)co2($|_)/.test(id)) return "co2";
  if (deviceClass === "volatile_organic_compounds" || deviceClass === "volatile_organic_compounds_parts" ||
      id.includes("voc")) return "voc";
  if (deviceClass === "temperature" || id.includes("temperature")) return "temperature";
  if (deviceClass === "humidity" || id.includes("humidity")) return "humidity";
  if (deviceClass === "atmospheric_pressure" || id.includes("pressure")) return "pressure";
  if (deviceClass === "sound_pressure" || id.includes("noise") || id.includes("sound_level")) return "noise";
  if (deviceClass === "illuminance" || id.includes("illuminance") || /(^|_)light($|_)/.test(id)) return "light";
  return null;
}

class AirthingsCard extends HTMLElement {
  static async getConfigElement() {
    return document.createElement("airthings-card-editor");
  }

  static getStubConfig(hass) {
    return { title: "Airthings", hours: 24 };
  }

  setConfig(config) {
    const previousDevice = this._config && this._config.device_id;
    this._config = Object.assign({ title: "Airthings", hours: 24 }, config);
    if (previousDevice !== this._config.device_id) {
      this._resolvingDevice = "";
      this._batteryEntity = "";
    }
    this._history = new Map();
    this._historyKey = "";
    this._effectiveEntities = Array.isArray(config.entities) ? config.entities : [];
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._resolveDeviceEntities();
    this._render();
    this._loadHistory();
  }

  getCardSize() {
    return Math.max(3, Math.ceil((this._effectiveEntities && this._effectiveEntities.length || 1) / 2) * 2);
  }

  async _resolveDeviceEntities() {
    const deviceId = this._config && this._config.device_id;
    if (!deviceId || !this._hass || this._resolvingDevice === deviceId) return;
    this._resolvingDevice = deviceId;
    try {
      let registry = this._hass.entities
        ? Object.entries(this._hass.entities).map(([entity_id, entry]) => Object.assign({ entity_id: entity_id }, entry))
        : null;
      if (!registry && this._hass.callWS) {
        registry = await this._hass.callWS({ type: "config/entity_registry/list" });
      }
      const candidates = (registry || []).filter((entry) =>
        entry.device_id === deviceId && entry.entity_id && entry.entity_id.startsWith("sensor.") &&
        !entry.disabled_by && this._hass.states[entry.entity_id]);
      const battery = candidates.find((entry) => {
        const state = this._hass.states[entry.entity_id];
        return String(state.attributes.device_class || "").toLowerCase() === "battery" ||
          /(^|_)battery(_level)?$/.test(entry.entity_id.toLowerCase());
      });
      this._batteryEntity = battery ? battery.entity_id : "";
      const selected = new Map();
      candidates.forEach((entry) => {
        const type = sensorType(entry.entity_id, this._hass.states[entry.entity_id]);
        if (!type) return;
        const score = this._sensorScore(type, entry.entity_id);
        if (!selected.has(type) || score > selected.get(type).score) {
          selected.set(type, { score: score, entity: entry.entity_id, type: type });
        }
      });
      this._effectiveEntities = this._sensorOrder().filter((type) => selected.has(type))
        .map((type) => ({ entity: selected.get(type).entity, type: type }));
      this._historyKey = "";
      this._render();
      this._loadHistory();
    } catch (error) {
      console.warn("Airthings Card could not inspect the entity registry", error);
      this._effectiveEntities = Array.isArray(this._config.entities) ? this._config.entities : [];
      this._render();
    }
  }

  _sensorScore(type, entityId) {
    const id = entityId.toLowerCase();
    let score = 10;
    if (type === "radon") {
      if (/short|1_day|24_hour|current/.test(id)) score += 20;
      if (/long|average|avg/.test(id)) score -= 10;
    }
    if (id.endsWith("_" + type) || id.endsWith("_co2")) score += 5;
    return score;
  }

  _sensorOrder() {
    return normalizedSensorOrder(this._config && this._config.sensor_order);
  }

  _orderedEntities() {
    const order = this._sensorOrder();
    return (this._effectiveEntities || []).slice().sort((left, right) => {
      const leftItem = typeof left === "string" ? { entity: left } : left;
      const rightItem = typeof right === "string" ? { entity: right } : right;
      const leftType = leftItem.type || sensorType(leftItem.entity, this._hass && this._hass.states[leftItem.entity]);
      const rightType = rightItem.type || sensorType(rightItem.entity, this._hass && this._hass.states[rightItem.entity]);
      const leftIndex = order.indexOf(leftType);
      const rightIndex = order.indexOf(rightType);
      return (leftIndex < 0 ? order.length : leftIndex) -
        (rightIndex < 0 ? order.length : rightIndex);
    });
  }

  _batteryModel() {
    const state = this._hass && this._hass.states[this._batteryEntity];
    const value = Number(state && state.state);
    if (!state || !Number.isFinite(value)) return null;
    const level = Math.max(0, Math.min(100, Math.round(value)));
    const icon = level <= 10 ? "mdi:battery-alert" : level >= 95 ? "mdi:battery" :
      "mdi:battery-" + Math.max(10, Math.round(level / 10) * 10);
    return { entity: this._batteryEntity, value: level, icon: icon };
  }

  async _loadHistory() {
    if (!this._hass || !this._config) return;
    const entities = this._orderedEntities().map((item) => typeof item === "string" ? item : item.entity).filter(Boolean);
    const key = Math.floor(Date.now() / 300000) + ":" + this._config.hours + ":" + entities.join(",");
    if (!entities.length || key === this._historyKey) return;
    this._historyKey = key;
    const start = new Date(Date.now() - this._config.hours * 3600000).toISOString();
    const path = "history/period/" + start + "?filter_entity_id=" + entities.join(",") + "&minimal_response&no_attributes";
    try {
      const result = await this._hass.callApi("GET", path);
      entities.forEach((entity, index) => {
        const points = (result[index] || []).map((entry) => ({
          time: Date.parse(entry.last_changed), value: Number(entry.state)
        })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
        this._history.set(entity, points);
      });
    } catch (error) {
      console.warn("Airthings Card could not load history", error);
    }
    this._render();
  }

  _status(value, item, preset) {
    const ranges = item.ranges || preset.ranges;
    if (Array.isArray(ranges)) {
      const match = ranges.find((range) =>
        (range[0] == null || value >= range[0]) && (range[1] == null || value < range[1]));
      return this._result(match && match[2], match && match[3], item);
    }
    const limits = item.thresholds || preset.limits || [[null,"neutral",""]];
    const match = limits.find((entry) => {
      const maximum = Array.isArray(entry) ? entry[0] : entry.value;
      return maximum == null || value < Number(maximum);
    });
    if (Array.isArray(match)) return this._result(match[1], match[2], item);
    return { color: match.color || COLORS.neutral, label: match.label || "" };
  }

  _result(key, label, item) {
    return { color: item.colors && item.colors[key] || COLORS[key] || key || COLORS.neutral, label: label || "" };
  }

  _model(raw) {
    const item = typeof raw === "string" ? { entity: raw } : raw;
    const state = this._hass && this._hass.states[item.entity];
    const preset = PRESETS[item.type] || {};
    const value = Number(state && state.state);
    const available = Boolean(state && Number.isFinite(value));
    return {
      item: item, preset: preset, value: value, available: available,
      name: item.name || preset.name || state && state.attributes.friendly_name || item.entity,
      icon: item.icon || preset.icon || state && state.attributes.icon || "mdi:chart-line",
      unit: item.unit != null ? item.unit : state && state.attributes.unit_of_measurement || "",
      status: available ? this._status(value, item, preset) : { color: COLORS.unavailable, label: "Unavailable" }
    };
  }

  _sparkline(model) {
    const points = this._history.get(model.item.entity) || [];
    if (points.length < 2) return '<div class="no-history">No history yet</div>';
    const values = points.map((point) => point.value);
    let minimum = Math.min.apply(null, values);
    let maximum = Math.max.apply(null, values);
    const padding = Math.max((maximum - minimum) * .18, Math.abs(maximum) * .02, 1);
    minimum -= padding;
    maximum += padding;
    const x = (index) => 3 + index / (points.length - 1) * 94;
    const y = (value) => 35 - (value - minimum) / (maximum - minimum || 1) * 30;
    const segments = points.slice(1).map((point, index) => {
      const previous = points[index];
      const color = this._status(point.value, model.item, model.preset).color;
      return '<line x1="' + x(index) + '" y1="' + y(previous.value) + '" x2="' + x(index + 1) + '" y2="' + y(point.value) + '" stroke="' + color + '"/>';
    }).join("");
    const last = points[points.length - 1];
    return '<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Recent history"><path class="guide" d="M3 35H97"/>' +
      segments + '<circle cx="' + x(points.length - 1) + '" cy="' + y(last.value) + '" r="2.3" fill="' + model.status.color + '"/></svg>';
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const entities = this._orderedEntities();
    const models = entities.map((item) => this._model(item));
    const rank = { [COLORS.high]: 4, [COLORS.poor]: 3, [COLORS.fair]: 2, [COLORS.good]: 1 };
    const overall = models.filter((model) => model.available)
      .sort((a,b) => (rank[b.status.color] || 0) - (rank[a.status.color] || 0))[0];
    const cards = models.map((model) =>
      '<button class="metric" data-entity="' + this._escape(model.item.entity) + '" style="--quality:' + model.status.color + '">' +
      '<div class="label"><ha-icon icon="' + this._escape(model.icon) + '"></ha-icon><span>' + this._escape(model.name) + '</span></div>' +
      '<div class="reading"><span class="value">' + (model.available ? this._format(model.value) : "—") + '</span><span class="unit">' + this._escape(model.unit) + '</span></div>' +
      '<div class="status">' + this._escape(model.status.label) + '</div>' + this._sparkline(model) + '</button>'
    ).join("");
    const badge = overall ? '<div class="badge" style="--quality:' + overall.status.color + '">' + this._escape(overall.status.label || "Current") + '</div>' : "";
    const battery = this._batteryModel();
    const batteryHtml = battery ? '<button class="battery" data-entity="' + this._escape(battery.entity) +
      '" title="Battery"><ha-icon icon="' + battery.icon + '"></ha-icon><span>' + battery.value + '%</span></button>' : "";
    const device = this._hass && this._hass.devices && this._hass.devices[this._config.device_id];
    const title = this._config.title && this._config.title !== "Airthings"
      ? this._config.title : device && (device.name_by_user || device.name) || this._config.title;
    const empty = !models.length
      ? '<div class="empty">' + (this._config.device_id
        ? 'No supported sensors found for this device.<br><small>Check that its entities are enabled in Home Assistant.</small>'
        : 'Select an Airthings device in the card configuration.') + '</div>'
      : '<div class="grid">' + cards + '</div>';
    this.shadowRoot.innerHTML = '<style>' +
      ':host{display:block;container-type:inline-size;--at-bg:var(--ha-card-background,var(--card-background-color,#1c252a));--at-tile:color-mix(in srgb,var(--primary-text-color,#fff) 6%,transparent)}' +
      'ha-card{overflow:hidden;background:var(--at-bg);color:var(--primary-text-color);padding:18px;border-radius:var(--ha-card-border-radius,12px)}' +
      '.head{display:flex;align-items:center;gap:12px;margin:0 2px 16px}.title{font-size:1.35rem;font-weight:600;min-width:0;flex:1}.title-line{display:flex;align-items:center;gap:9px;min-width:0}.title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subtitle{font-size:.78rem;color:var(--secondary-text-color);margin-top:2px}' +
      '.battery{display:flex;align-items:center;gap:3px;border:0;padding:2px 4px;background:transparent;color:var(--secondary-text-color);font:inherit;font-size:.75rem;cursor:pointer}.battery ha-icon{width:18px;height:18px}' +
      '.badge{border-radius:999px;padding:6px 11px;font-weight:650;font-size:.78rem;background:color-mix(in srgb,var(--quality) 20%,transparent);color:var(--quality)}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:10px}.metric{box-sizing:border-box;min-width:0;height:142px;border:0;border-radius:14px;padding:13px;background:var(--at-tile);color:inherit;text-align:left;position:relative;cursor:pointer;overflow:hidden}' +
      '.metric:hover{background:color-mix(in srgb,var(--primary-text-color,#fff) 10%,transparent)}.label{display:flex;align-items:center;gap:7px;font-size:.94rem;color:var(--secondary-text-color)}ha-icon{width:19px;height:19px}' +
      '.reading{margin-top:10px;line-height:1;color:var(--quality);white-space:nowrap}.value{font-size:1.9rem;font-weight:620;letter-spacing:-.04em}.unit{font-size:.82rem;margin-left:4px;color:var(--secondary-text-color)}' +
      '.status{font-size:.78rem;font-weight:650;color:var(--quality);margin-top:7px}.spark{position:absolute;left:11px;right:11px;bottom:8px;width:calc(100% - 22px);height:35px;overflow:visible}.spark line{stroke-width:2.4;stroke-linecap:round;vector-effect:non-scaling-stroke}.guide{stroke:var(--divider-color,rgba(128,128,128,.22));stroke-width:1;vector-effect:non-scaling-stroke}' +
      '.no-history{position:absolute;left:13px;bottom:12px;font-size:.7rem;color:var(--disabled-text-color)}@container (max-width:390px){.metric{height:128px}.value{font-size:1.65rem}}' +
      '.empty{padding:26px 10px;text-align:center;color:var(--secondary-text-color);line-height:1.5}' +
      '</style><ha-card><div class="head"><div class="title"><div class="title-line"><span class="title-text">' + this._escape(title) +
      '</span>' + batteryHtml + '</div><div class="subtitle">' + this._config.hours + ' hour history · v' + VERSION + '</div></div>' + badge +
      '</div>' + empty + '</ha-card>';
    this.shadowRoot.querySelectorAll(".metric").forEach((button) =>
      button.addEventListener("click", () => this.dispatchEvent(new CustomEvent("hass-more-info", {
        bubbles: true, composed: true, detail: { entityId: button.dataset.entity }
      }))));
    const batteryButton = this.shadowRoot.querySelector(".battery");
    if (batteryButton) batteryButton.addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        bubbles: true, composed: true, detail: { entityId: batteryButton.dataset.entity }
      })));
  }

  _format(value) {
    return new Intl.NumberFormat(this._hass && this._hass.locale.language || navigator.language,
      { maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0 }).format(value);
  }

  _escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g,
      (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]);
  }
}

class AirthingsCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({ title: "Airthings", hours: 24, entities: [] }, config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._renderEditor();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._editorRendered) {
      this._renderEditor();
      this._editorRendered = true;
    }
    this._loadDevices();
  }

  _change(patch) {
    this._config = Object.assign({}, this._config, patch);
    Object.keys(this._config).forEach((key) => {
      if (this._config[key] === undefined) delete this._config[key];
    });
    this.dispatchEvent(new CustomEvent("config-changed", {
      bubbles: true, composed: true, detail: { config: this._config }
    }));
    this._renderEditor();
  }

  _renderEditor() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.innerHTML = '<style>' +
      ':host{display:block}.form{display:grid;gap:14px;padding:8px 0}' +
      'ha-textfield{width:100%}.device-field{display:grid;gap:7px}.device-title{font-size:.75rem;color:var(--secondary-text-color);padding-left:12px}' +
      '.device-options{display:grid;gap:6px}.device-option{box-sizing:border-box;width:100%;min-height:48px;display:flex;align-items:center;gap:12px;padding:10px 13px;border:1px solid var(--divider-color,#777);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;text-align:left;cursor:pointer}' +
      '.device-option:hover{background:color-mix(in srgb,var(--primary-text-color) 6%,var(--card-background-color))}.device-option.selected{border-color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 10%,var(--card-background-color))}' +
      '.radio{box-sizing:border-box;width:20px;height:20px;border:2px solid var(--secondary-text-color);border-radius:50%;display:grid;place-items:center;flex:0 0 auto}.selected .radio{border-color:var(--primary-color)}.selected .radio:after{content:"";width:10px;height:10px;border-radius:50%;background:var(--primary-color)}' +
      '.device-name{flex:1}.empty-devices{padding:10px 12px;color:var(--secondary-text-color)}.hint{color:var(--secondary-text-color);font-size:.85rem;line-height:1.4}' +
      '.order-field{display:grid;gap:7px}.order-title{display:flex;align-items:center;justify-content:space-between;font-size:.75rem;color:var(--secondary-text-color);padding-left:12px}.reset-order{border:0;background:transparent;color:var(--primary-color);font:inherit;font-size:.75rem;cursor:pointer;padding:4px 8px}' +
      '.order-list{display:grid;gap:4px}.order-item{display:flex;align-items:center;gap:8px;min-height:38px;padding:4px 6px 4px 12px;border-radius:7px;background:color-mix(in srgb,var(--primary-text-color) 5%,transparent)}.order-item ha-icon{width:18px;height:18px;color:var(--secondary-text-color)}.order-name{flex:1}.move{width:34px;height:32px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--primary-text-color);cursor:pointer}.move:hover{background:color-mix(in srgb,var(--primary-text-color) 10%,transparent)}.move:disabled{opacity:.25;cursor:default}' +
      '</style><div class="form"><div class="device-field"><div class="device-title">Airthings device</div><div class="device-options">' +
      ((this._airthingsDevices || []).length ? (this._airthingsDevices || []).map((device) =>
        '<button type="button" class="device-option' + (device.id === this._config.device_id ? ' selected' : '') +
        '" data-device="' + this._escape(device.id) + '"><span class="radio" aria-hidden="true"></span><span class="device-name">' +
        this._escape(device.name) + '</span></button>').join("") : '<div class="empty-devices">Loading Airthings devices…</div>') +
      '</div></div><ha-textfield id="title" label="Title (optional)" value="' +
      String(this._config.title || "").replace(/"/g,"&quot;") + '"></ha-textfield>' +
      '<ha-textfield id="hours" label="History (hours)" type="number" min="1" max="168" value="' +
      this._config.hours + '"></ha-textfield><div class="order-field"><div class="order-title"><span>Measurement order</span><button type="button" class="reset-order">Reset order</button></div><div class="order-list">' +
      this._editorOrder().map((type, index, order) => '<div class="order-item"><ha-icon icon="' + PRESETS[type].icon + '"></ha-icon><span class="order-name">' +
        PRESETS[type].name + '</span><button type="button" class="move" data-type="' + type + '" data-direction="up" aria-label="Move ' + PRESETS[type].name + ' up"' +
        (index === 0 ? ' disabled' : '') + '><ha-icon icon="mdi:chevron-up"></ha-icon></button><button type="button" class="move" data-type="' + type +
        '" data-direction="down" aria-label="Move ' + PRESETS[type].name + ' down"' + (index === order.length - 1 ? ' disabled' : '') +
        '><ha-icon icon="mdi:chevron-down"></ha-icon></button></div>').join("") + '</div></div>' +
      '<div class="hint">The card finds radon, PM2.5, PM1, CO₂, VOC, temperature, humidity, pressure, noise and light sensors exposed by the selected device. Battery is shown in the header.</div></div>';
    this.shadowRoot.querySelectorAll(".device-option").forEach((option) => option.addEventListener("click", () => {
      const deviceId = option.dataset.device || "";
      if (deviceId === (this._config.device_id || "")) return;
      const patch = { device_id: deviceId };
      if (deviceId && Array.isArray(this._config.entities)) patch.entities = undefined;
      this._change(patch);
    }));
    this.shadowRoot.querySelector("#title").addEventListener("change", (event) => this._change({ title: event.target.value }));
    this.shadowRoot.querySelector("#hours").addEventListener("change", (event) =>
      this._change({ hours: Math.max(1, Math.min(168, Number(event.target.value) || 24)) }));
    this.shadowRoot.querySelectorAll(".move").forEach((button) => button.addEventListener("click", () => {
      const order = this._editorOrder();
      const index = order.indexOf(button.dataset.type);
      const target = button.dataset.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
      this._change({ sensor_order: order });
    }));
    this.shadowRoot.querySelector(".reset-order").addEventListener("click", () =>
      this._change({ sensor_order: undefined }));
  }

  _editorOrder() {
    return normalizedSensorOrder(this._config && this._config.sensor_order);
  }

  async _loadDevices() {
    if (!this._hass || this._loadingDevices || this._airthingsDevices) return;
    this._loadingDevices = true;
    try {
      const [entityRegistry, deviceRegistry] = await Promise.all([
        this._hass.entities
          ? Object.entries(this._hass.entities).map(([entity_id, entry]) => Object.assign({ entity_id: entity_id }, entry))
          : this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.devices
          ? Object.entries(this._hass.devices).map(([id, device]) => Object.assign({ id: id }, device))
          : this._hass.callWS({ type: "config/device_registry/list" })
      ]);
      const devicesById = new Map(deviceRegistry.map((device) => [device.id, device]));
      const supportedDeviceIds = new Set(entityRegistry.filter((entry) => {
        const state = this._hass.states[entry.entity_id];
        const device = devicesById.get(entry.device_id) || {};
        const airthingsDevice = /airthings/i.test(String(entry.platform || "")) ||
          /airthings/i.test(String(device.manufacturer || ""));
        return entry.device_id && !entry.disabled_by && entry.entity_id.startsWith("sensor.") &&
          airthingsDevice && state && sensorType(entry.entity_id, state);
      }).map((entry) => entry.device_id));
      this._airthingsDevices = deviceRegistry.filter((device) => supportedDeviceIds.has(device.id))
        .map((device) => ({ id: device.id, name: device.name_by_user || device.name || device.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this._renderEditor();
    } catch (error) {
      console.warn("Airthings Card could not load the device list", error);
      this._airthingsDevices = [];
      this._renderEditor();
    } finally {
      this._loadingDevices = false;
    }
  }

  _escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g,
      (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]);
  }
}

customElements.define("airthings-card", AirthingsCard);
customElements.define("airthings-card-editor", AirthingsCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "airthings-card", name: "Airthings Card",
  description: "Responsive Airthings measurements with colour-coded SVG history",
  preview: true
});
console.info("%c AIRTHINGS-CARD %c " + VERSION + " ", "color:white;background:#45b97c;font-weight:700", "color:#45b97c;background:#182126");
