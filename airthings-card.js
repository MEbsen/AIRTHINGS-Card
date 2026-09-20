const VERSION = "0.2.0";
const COLORS = {
  good: "#45b97c", fair: "#e8b931", poor: "#ef8d32",
  high: "#e05252", neutral: "#55a9c9", unavailable: "#8a949c"
};
const PRESETS = {
  radon: { name: "Radon", icon: "mdi:radioactive", limits: [[100,"good","Good"],[200,"fair","Fair"],[300,"poor","Poor"],[null,"high","High"]] },
  co2: { name: "CO₂", icon: "mdi:molecule-co2", limits: [[800,"good","Good"],[1000,"fair","Fair"],[1400,"poor","Poor"],[null,"high","High"]] },
  voc: { name: "VOC", icon: "mdi:weather-windy", limits: [[250,"good","Good"],[1000,"fair","Fair"],[2000,"poor","Poor"],[null,"high","High"]] },
  temperature: { name: "Temperature", icon: "mdi:thermometer", ranges: [[null,18,"fair","Cool"],[18,25,"good","Good"],[25,28,"fair","Warm"],[28,null,"poor","High"]] },
  humidity: { name: "Humidity", icon: "mdi:water-outline", ranges: [[null,30,"poor","Dry"],[30,40,"fair","Fair"],[40,60,"good","Good"],[60,70,"fair","Fair"],[70,null,"poor","High"]] },
  pressure: { name: "Pressure", icon: "mdi:gauge", limits: [[null,"neutral","Stable"]] }
};
const SENSOR_TYPES = ["radon", "co2", "voc", "temperature", "humidity", "pressure"];

function sensorType(entityId, state) {
  const id = String(entityId || "").toLowerCase();
  const deviceClass = String(state && state.attributes && state.attributes.device_class || "").toLowerCase();
  if (id.includes("radon")) return "radon";
  if (deviceClass === "carbon_dioxide" || /(^|_)co2($|_)/.test(id)) return "co2";
  if (deviceClass === "volatile_organic_compounds" || deviceClass === "volatile_organic_compounds_parts" ||
      id.includes("voc")) return "voc";
  if (deviceClass === "temperature" || id.includes("temperature")) return "temperature";
  if (deviceClass === "humidity" || id.includes("humidity")) return "humidity";
  if (deviceClass === "atmospheric_pressure" || id.includes("pressure")) return "pressure";
  return null;
}

class AirthingsCard extends HTMLElement {
  static async getConfigElement() {
    return document.createElement("airthings-card-editor");
  }

  static getStubConfig(hass) {
    const registry = hass.entities || {};
    const firstAirthings = Object.entries(registry).find(([entityId, entry]) =>
      entry.device_id && entityId.startsWith("sensor.") &&
      /airthings|radon/.test((entityId + " " + (entry.platform || "")).toLowerCase()));
    if (firstAirthings) {
      return { title: "Airthings", hours: 24, columns: "auto", device_id: firstAirthings[1].device_id };
    }
    const byName = (term) => Object.keys(hass.states).find((id) =>
      id.startsWith("sensor.") && id.toLowerCase().includes(term));
    return {
      title: "Airthings",
      hours: 24,
      columns: "auto",
      entities: [
        ["radon", "radon"], ["co2", "co2"], ["voc", "voc"],
        ["temperature", "temperature"], ["humidity", "humidity"], ["pressure", "pressure"]
      ].map(([type, term]) => ({ type: type, entity: byName(term) || "" }))
       .filter((item) => item.entity)
    };
  }

  setConfig(config) {
    if (!config.device_id && (!Array.isArray(config.entities) || !config.entities.length)) {
      throw new Error("Airthings Card requires an Airthings device");
    }
    const previousDevice = this._config && this._config.device_id;
    this._config = Object.assign({ title: "Airthings", hours: 24, columns: "auto" }, config);
    if (previousDevice !== this._config.device_id) this._resolvingDevice = "";
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
      const selected = new Map();
      candidates.forEach((entry) => {
        const type = sensorType(entry.entity_id, this._hass.states[entry.entity_id]);
        if (!type) return;
        const score = this._sensorScore(type, entry.entity_id);
        if (!selected.has(type) || score > selected.get(type).score) {
          selected.set(type, { score: score, entity: entry.entity_id, type: type });
        }
      });
      this._effectiveEntities = SENSOR_TYPES.filter((type) => selected.has(type))
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

  async _loadHistory() {
    if (!this._hass || !this._config) return;
    const entities = (this._effectiveEntities || []).map((item) => typeof item === "string" ? item : item.entity).filter(Boolean);
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
    const entities = this._effectiveEntities || [];
    const models = entities.map((item) => this._model(item));
    const rank = { "#e05252": 4, "#ef8d32": 3, "#e8b931": 2, "#45b97c": 1 };
    const overall = models.filter((model) => model.available)
      .sort((a,b) => (rank[b.status.color] || 0) - (rank[a.status.color] || 0))[0];
    const columns = this._config.columns === "auto"
      ? "repeat(auto-fit,minmax(min(190px,100%),1fr))"
      : "repeat(" + (Number(this._config.columns) || 2) + ",1fr)";
    const cards = models.map((model) =>
      '<button class="metric" data-entity="' + this._escape(model.item.entity) + '" style="--quality:' + model.status.color + '">' +
      '<div class="label"><ha-icon icon="' + this._escape(model.icon) + '"></ha-icon><span>' + this._escape(model.name) + '</span></div>' +
      '<div class="reading"><span class="value">' + (model.available ? this._format(model.value) : "—") + '</span><span class="unit">' + this._escape(model.unit) + '</span></div>' +
      '<div class="status">' + this._escape(model.status.label) + '</div>' + this._sparkline(model) + '</button>'
    ).join("");
    const badge = overall ? '<div class="badge" style="--quality:' + overall.status.color + '">' + this._escape(overall.status.label || "Current") + '</div>' : "";
    const device = this._hass && this._hass.devices && this._hass.devices[this._config.device_id];
    const title = this._config.title && this._config.title !== "Airthings"
      ? this._config.title : device && (device.name_by_user || device.name) || this._config.title;
    const empty = !models.length
      ? '<div class="empty">No supported sensors found for this device.<br><small>Check that its entities are enabled in Home Assistant.</small></div>'
      : '<div class="grid">' + cards + '</div>';
    this.shadowRoot.innerHTML = '<style>' +
      ':host{display:block;container-type:inline-size;--at-bg:var(--ha-card-background,var(--card-background-color,#1c252a));--at-tile:color-mix(in srgb,var(--primary-text-color,#fff) 6%,transparent)}' +
      'ha-card{overflow:hidden;background:var(--at-bg);color:var(--primary-text-color);padding:18px;border-radius:var(--ha-card-border-radius,12px)}' +
      '.head{display:flex;align-items:center;gap:12px;margin:0 2px 16px}.title{font-size:1.35rem;font-weight:600;min-width:0;flex:1}.subtitle{font-size:.78rem;color:var(--secondary-text-color);margin-top:2px}' +
      '.badge{border-radius:999px;padding:6px 11px;font-weight:650;font-size:.78rem;background:color-mix(in srgb,var(--quality) 20%,transparent);color:var(--quality)}' +
      '.grid{display:grid;grid-template-columns:' + columns + ';gap:10px}.metric{box-sizing:border-box;min-width:0;height:142px;border:0;border-radius:14px;padding:13px;background:var(--at-tile);color:inherit;text-align:left;position:relative;cursor:pointer;overflow:hidden}' +
      '.metric:hover{background:color-mix(in srgb,var(--primary-text-color,#fff) 10%,transparent)}.label{display:flex;align-items:center;gap:7px;font-size:.94rem;color:var(--secondary-text-color)}ha-icon{width:19px;height:19px}' +
      '.reading{margin-top:10px;line-height:1;color:var(--quality);white-space:nowrap}.value{font-size:1.9rem;font-weight:620;letter-spacing:-.04em}.unit{font-size:.82rem;margin-left:4px;color:var(--secondary-text-color)}' +
      '.status{font-size:.78rem;font-weight:650;color:var(--quality);margin-top:7px}.spark{position:absolute;left:11px;right:11px;bottom:8px;width:calc(100% - 22px);height:35px;overflow:visible}.spark line{stroke-width:2.4;stroke-linecap:round;vector-effect:non-scaling-stroke}.guide{stroke:var(--divider-color,rgba(128,128,128,.22));stroke-width:1;vector-effect:non-scaling-stroke}' +
      '.no-history{position:absolute;left:13px;bottom:12px;font-size:.7rem;color:var(--disabled-text-color)}@container (max-width:390px){.metric{height:128px}.value{font-size:1.65rem}}' +
      '.empty{padding:26px 10px;text-align:center;color:var(--secondary-text-color);line-height:1.5}' +
      '</style><ha-card><div class="head"><div class="title">' + this._escape(title) +
      '<div class="subtitle">' + this._config.hours + ' hour history · v' + VERSION + '</div></div>' + badge +
      '</div>' + empty + '</ha-card>';
    this.shadowRoot.querySelectorAll(".metric").forEach((button) =>
      button.addEventListener("click", () => this.dispatchEvent(new CustomEvent("hass-more-info", {
        bubbles: true, composed: true, detail: { entityId: button.dataset.entity }
      }))));
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
    this._config = Object.assign({ title: "Airthings", hours: 24, columns: "auto", entities: [] }, config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._renderEditor();
  }

  set hass(hass) {
    this._hass = hass;
    this._renderEditor();
  }

  _change(patch) {
    this._config = Object.assign({}, this._config, patch);
    this.dispatchEvent(new CustomEvent("config-changed", {
      bubbles: true, composed: true, detail: { config: this._config }
    }));
    this._renderEditor();
  }

  _renderEditor() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.innerHTML = '<style>' +
      ':host{display:block}.form{display:grid;gap:14px;padding:8px 0}.row{display:grid;grid-template-columns:2fr 1fr;gap:12px}' +
      'ha-textfield,ha-select,ha-device-picker{width:100%}.hint{color:var(--secondary-text-color);font-size:.85rem;line-height:1.4}' +
      '</style><div class="form"><ha-device-picker id="device" label="Airthings device" value="' +
      (this._config.device_id || "") + '"></ha-device-picker><ha-textfield id="title" label="Title (optional)" value="' +
      String(this._config.title || "").replace(/"/g,"&quot;") + '"></ha-textfield>' +
      '<div class="row"><ha-textfield id="hours" label="History (hours)" type="number" min="1" max="168" value="' +
      this._config.hours + '"></ha-textfield><ha-select id="columns" label="Columns" value="' +
      this._config.columns + '"><mwc-list-item value="auto">Auto</mwc-list-item><mwc-list-item value="1">1</mwc-list-item>' +
      '<mwc-list-item value="2">2</mwc-list-item><mwc-list-item value="3">3</mwc-list-item></ha-select></div>' +
      '<div class="hint">The card automatically finds supported sensors exposed by the selected device: radon, CO₂, VOC, temperature, humidity and pressure.</div></div>';
    const picker = this.shadowRoot.querySelector("#device");
    picker.hass = this._hass;
    picker.addEventListener("value-changed", (event) =>
      this._change({ device_id: event.detail.value }));
    this.shadowRoot.querySelector("#title").addEventListener("change", (event) => this._change({ title: event.target.value }));
    this.shadowRoot.querySelector("#hours").addEventListener("change", (event) =>
      this._change({ hours: Math.max(1, Math.min(168, Number(event.target.value) || 24)) }));
    this.shadowRoot.querySelector("#columns").addEventListener("selected", (event) =>
      this._change({ columns: event.target.value }));
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
