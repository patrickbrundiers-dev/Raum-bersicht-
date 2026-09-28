/* Raumübersicht Card für Home Assistant
 * Zeigt alle Räume (Areas) als Karten und öffnet pro Raum ein Popup
 * mit allen Geräten, nach Kategorien sortiert. Keine Entity-IDs nötig.
 */
const RUC_VERSION = "2.1.0";

const CATEGORIES = [
  { key: "climate", title: "Heizung und Klima", icon: "mdi:radiator", domains: ["climate", "water_heater"] },
  { key: "light", title: "Licht", icon: "mdi:lightbulb-outline", domains: ["light"] },
  { key: "cover", title: "Rollos und Fenster", icon: "mdi:blinds", domains: ["cover"] },
  { key: "switch", title: "Steckdosen und Schalter", icon: "mdi:power-socket-eu", domains: ["switch", "input_boolean", "fan", "humidifier"] },
  { key: "media", title: "Medien", icon: "mdi:speaker", domains: ["media_player"] },
  { key: "binary", title: "Fenster und Bewegung", icon: "mdi:door", domains: ["binary_sensor"] },
  { key: "sensor", title: "Raumklima", icon: "mdi:gauge", domains: ["sensor"] },
];
// Was im Popup sofort sichtbar ist, alles andere steckt unter "Weitere Sensoren"
const ESSENTIAL_SENSOR = ["temperature", "humidity", "carbon_dioxide", "co2", "power"];
const ESSENTIAL_BINARY = ["window", "door", "opening", "garage_door", "motion", "occupancy", "presence"];
const TOGGLE_DOMAINS = ["light", "switch", "input_boolean", "fan", "humidifier"];
const DOMAIN_ICONS = {
  climate: "mdi:thermostat", light: "mdi:lightbulb", switch: "mdi:power-socket-eu", input_boolean: "mdi:toggle-switch",
  fan: "mdi:fan", humidifier: "mdi:air-humidifier", cover: "mdi:blinds", media_player: "mdi:speaker",
  sensor: "mdi:eye", binary_sensor: "mdi:checkbox-blank-circle-outline", water_heater: "mdi:water-boiler",
};
const OFF_STATES = ["off", "closed", "idle", "standby", "paused", "unavailable", "unknown"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").trim().toLowerCase();

class RaumUebersichtCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._openRoom = null;
    this._sheetScroll = 0;
    this._sig = "";
    this._pend = {};
    this._flash = null;
    this._more = {};
    this._hist = {};
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target && e.target.getAttribute && e.target.getAttribute("role") === "button") {
        e.preventDefault();
        this._onClick(e);
      }
    });
  }

  static getStubConfig() { return { type: "custom:raum-uebersicht-card" }; }

  setConfig(config) {
    this._config = { columns: 2, sort: "urgency", ...config };
    this._sig = "";
    if (this._hass) this._render();
  }

  getCardSize() { return 6; }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /* ---------- Raum- und Geräteauflösung ---------- */

  _areaOf(entityId) {
    const h = this._hass;
    const reg = h.entities && h.entities[entityId];
    if (!reg) return null;
    if (reg.area_id) return reg.area_id;
    const dev = reg.device_id && h.devices && h.devices[reg.device_id];
    return dev ? dev.area_id || null : null;
  }

  _findArea(key) {
    const areas = this._hass.areas || {};
    const k = norm(key);
    return Object.values(areas).find((a) => norm(a.area_id) === k || norm(a.name) === k) || null;
  }

  _entitiesInArea(areaId) {
    const h = this._hass;
    return Object.keys(h.states).filter((id) => this._areaOf(id) === areaId);
  }

  _visible(id) {
    const reg = this._hass.entities && this._hass.entities[id];
    if (!reg) return true;
    if (reg.hidden || reg.entity_category) return false;
    return !/_(linkquality|identify|update)$/.test(id);
  }

  _rooms() {
    const h = this._hass;
    const cfgRooms = this._config.rooms;
    let list = [];
    if (Array.isArray(cfgRooms) && cfgRooms.length) {
      list = cfgRooms.map((r) => {
        const cfg = typeof r === "string" ? { area: r } : r;
        const area = this._findArea(cfg.area || cfg.name);
        return area ? { cfg, area } : null;
      }).filter(Boolean);
    } else {
      list = Object.values(h.areas || {})
        .map((area) => ({ cfg: {}, area }))
        .filter(({ area }) => this._entitiesInArea(area.area_id).some((id) => this._visible(id)
          && (id.startsWith("climate.") || (id.startsWith("sensor.") && this._dc(id) === "temperature"))))
        .sort((a, b) => a.area.name.localeCompare(b.area.name, "de"));
    }
    const rooms = list.map(({ cfg, area }) => this._buildRoom(cfg, area));
    const mode = this._config.sort;
    if (mode !== "config") {
      rooms.sort((a, b) => (mode === "name" ? 0 : b.score - a.score) || a.name.localeCompare(b.name, "de"));
    }
    return rooms;
  }

  _urgency(r) {
    const h = this._hass;
    let score = 0;
    let level = "";
    const w = r.win && h.states[r.win];
    if (w && w.state === "on") {
      score += 100 + Math.min(60, Math.round((Date.now() - new Date(w.last_changed).getTime()) / 60000));
      level = "bad";
    }
    const hv = this._num(r.hum);
    if (hv != null) {
      if (hv >= 70) { score += 60; level = "bad"; }
      else if (hv >= 60) { score += 25; level = level || "warn"; }
      else if (hv < 40) { score += 5; }
    }
    const v = r.vent && h.states[r.vent];
    if (v) {
      const t = norm(v.state);
      if (/l(ü|ue)ften/.test(t) && !/(kein|nicht|nein)/.test(t)) { score += 30; level = level || "warn"; }
    }
    r.score = score;
    r.level = level;
  }

  _watts(id) {
    const st = this._hass.states[id];
    const v = this._num(id);
    if (v == null) return null;
    return String((st.attributes || {}).unit_of_measurement || "").toLowerCase() === "kw" ? v * 1000 : v;
  }

  _fmtW(w) {
    if (w == null) return "";
    return w >= 1000 ? `${(w / 1000).toFixed(1).replace(".", ",")} kW` : `${Math.round(w)} W`;
  }

  _fmtKwh(v) {
    return `${v.toFixed(v < 10 ? 2 : 1).replace(".", ",")} kWh`;
  }

  _isBetterThermostat(id) {
    const reg = this._hass.entities && this._hass.entities[id];
    if (reg && reg.platform) return reg.platform === "better_thermostat";
    const a = (this._hass.states[id] || {}).attributes || {};
    return "calibration_mode" in a || "saved_temperature" in a || "window_open" in a;
  }

  _preferredClimate(ids) {
    return ids.find((id) => this._isBetterThermostat(id)) || ids[0] || null;
  }

  _dc(id) { const s = this._hass.states[id]; return s ? s.attributes.device_class : undefined; }

  _pick(ids, domain, deviceClasses) {
    return ids.find((id) => id.startsWith(domain + ".") && (!deviceClasses || deviceClasses.includes(this._dc(id)))) || null;
  }

  _buildRoom(cfg, area) {
    const ids = this._entitiesInArea(area.area_id).filter((id) => this._visible(id));
    const h = this._hass;
    const has = (id) => id && h.states[id];
    const temp = has(cfg.temperature) ? cfg.temperature : this._pick(ids, "sensor", ["temperature"]);
    const hum = has(cfg.humidity) ? cfg.humidity : this._pick(ids, "sensor", ["humidity"]);
    const win = has(cfg.window) ? cfg.window : this._pick(ids, "binary_sensor", ["window", "door", "opening", "garage_door"]);
    const climates = ids.filter((id) => id.startsWith("climate."));
    const clim = has(cfg.climate) ? cfg.climate : this._preferredClimate(climates);
    const vent = has(cfg.ventilation) ? cfg.ventilation : ids.find((id) => id.startsWith("sensor.") && id.endsWith("_empfehlung")) || null;
    const powerIds = ids.filter((id) => id.startsWith("sensor.") && this._dc(id) === "power");
    const watts = powerIds.map((id) => this._watts(id)).filter((v) => v != null);
    const ann = cfg.announce || this._config.announce;
    const room = {
      id: area.area_id, name: cfg.name || area.name, icon: cfg.icon || area.icon || "mdi:door",
      // pro Raum nur ein Thermostat (Better Thermostat), keine Einzel-TRVs oder Gruppen
      ids: ids.filter((id) => !id.startsWith("climate.") || id === clim),
      temp, hum, win, clim, vent,
      power: watts.length ? watts.reduce((a, b) => a + b, 0) : null,
      announce: vent && ann && (ann.targets || ann.target) ? ann : null,
    };
    this._urgency(room);
    return room;
  }

  /* ---------- Darstellung ---------- */

  _fmt(id) {
    const s = this._hass.states[id];
    if (!s) return "";
    if (typeof this._hass.formatEntityState === "function") return this._hass.formatEntityState(s);
    const u = s.attributes.unit_of_measurement;
    return u ? `${s.state} ${u}` : s.state;
  }

  _num(id) {
    const s = id && this._hass.states[id];
    const v = s ? parseFloat(String(s.state).replace(",", ".")) : NaN;
    return isNaN(v) ? null : v;
  }

  _name(id) {
    const s = this._hass.states[id];
    return (s && s.attributes.friendly_name) || id;
  }

  _icon(id) {
    const s = this._hass.states[id];
    return (s && s.attributes.icon) || DOMAIN_ICONS[id.split(".")[0]] || "mdi:help-circle-outline";
  }

  _since(id) {
    const s = this._hass.states[id];
    if (!s) return "";
    const min = Math.max(0, Math.round((Date.now() - new Date(s.last_changed).getTime()) / 60000));
    if (min < 60) return `${min} Min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} Std ${min % 60} Min` : `${Math.floor(h / 24)} Tage`;
  }

  _humClass(v) {
    if (v == null) return "";
    if (v >= 70) return "bad";
    if (v >= 60 || v < 40) return "warn";
    return "ok";
  }

  _roomCard(r) {
    const t = this._num(r.temp);
    const hv = this._num(r.hum);
    const winOpen = r.win && this._hass.states[r.win].state === "on";
    const clim = r.clim && this._hass.states[r.clim];
    const pend = clim && this._pend[r.clim];
    const target = pend && Date.now() - pend.t < 4000 ? pend.v : clim && clim.attributes.temperature;
    const heating = clim && clim.state !== "off" && clim.state !== "unavailable";
    const vent = r.vent && this._hass.states[r.vent];
    const tt = t == null ? "–" : t.toFixed(1).replace(".", ",");
    const hc = this._humClass(hv);
    const num = (v) => String(v).replace(".", ",");
    const btn = (icon, attrs, label, cls = "") => `<button class="step ${cls}" ${attrs} aria-label="${label}"><ha-icon icon="${icon}"></ha-icon></button>`;
    let heat = "";
    if (clim && heating && target != null) {
      heat = `<div class="heat">
        ${btn("mdi:minus", `data-action="step" data-dir="-1" data-entity="${esc(r.clim)}"`, "Kälter")}
        <span class="hv2"><ha-icon icon="mdi:fire"></ha-icon>${num(target)} °C</span>
        ${btn("mdi:plus", `data-action="step" data-dir="1" data-entity="${esc(r.clim)}"`, "Wärmer")}
        ${btn("mdi:power", `data-action="heat" data-mode="off" data-entity="${esc(r.clim)}"`, "Heizung ausschalten", "pw on")}
      </div>`;
    } else if (clim) {
      heat = `<div class="heat off">
        <span class="hv2"><ha-icon icon="mdi:radiator-off"></ha-icon>${heating ? esc(clim.state) : "Heizung aus"}</span>
        ${clim.state !== "unavailable" ? btn("mdi:power", `data-action="heat" data-mode="on" data-entity="${esc(r.clim)}"`, "Heizung einschalten", "pw") : ""}
      </div>`;
    }
    const ventShow = vent && !["unknown", "unavailable"].includes(vent.state);
    return `
      <div class="room ${r.level}" role="button" tabindex="0" data-action="open" data-room="${esc(r.id)}">
        <div class="top">
          <span class="ic"><ha-icon icon="${esc(r.icon)}"></ha-icon></span>
          <span class="name">${esc(r.name)}</span>
          ${winOpen ? `<span class="wopen"><ha-icon icon="mdi:window-open-variant"></ha-icon>${this._since(r.win)}</span>` : ""}
        </div>
        <div class="tline"><span class="temp">${tt}<small>°C</small></span>${clim && heating && target != null ? `<span class="tgt">Ziel ${num(target)}°</span>` : ""}</div>
        ${hv != null ? `<div class="hum ${hc}"><span class="hbar"><i style="width:${Math.max(4, Math.min(100, Math.round(hv)))}%"></i></span><span class="hp">${Math.round(hv)} %</span></div>` : ""}
        ${heat}
        ${r.power != null && r.power >= 1 ? `<div class="pow"><ha-icon icon="mdi:flash-outline"></ha-icon>${this._fmtW(r.power)}</div>` : ""}
        ${ventShow ? `<div class="vent ${r.level}"><ha-icon icon="mdi:weather-windy"></ha-icon><span class="vt">${esc(this._fmt(r.vent))}</span>${r.announce ? `<button class="ann" data-action="announce" data-room="${esc(r.id)}" aria-label="Ansagen"><ha-icon icon="${this._flash === r.id ? "mdi:check" : "mdi:bullhorn-outline"}"></ha-icon></button>` : ""}</div>` : ""}
      </div>`;
  }

  _deviceRow(id) {
    const st = this._hass.states[id];
    const domain = id.split(".")[0];
    const toggle = TOGGLE_DOMAINS.includes(domain);
    const dis = st.state === "unavailable";
    const on = !OFF_STATES.includes(st.state);
    const active = on && domain !== "sensor" && domain !== "binary_sensor";
    const act = toggle && !dis ? "toggle" : "info";
    return `
      <div class="tile ${active ? "on" : ""} ${dis ? "dis" : ""} ${domain === "climate" ? "wide" : ""}" role="button" tabindex="0" data-action="${act}" data-entity="${esc(id)}">
        <span class="tt"><span class="dic"><ha-icon icon="${esc(this._icon(id))}"></ha-icon></span>${act === "toggle" ? `<button class="ib" data-action="info" data-entity="${esc(id)}" aria-label="Details"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button>` : ""}</span>
        <span class="dn">${esc(this._name(id))}</span>
        <span class="ds">${esc(this._fmt(id))}</span>
      </div>`;
  }

  _summary(rooms) {
    if (!rooms.length) return "";
    const h = this._hass;
    const open = rooms.filter((r) => r.win && h.states[r.win].state === "on").length;
    const humid = rooms.filter((r) => { const v = this._num(r.hum); return v != null && v >= 70; }).length;
    const heating = rooms.filter((r) => r.clim && !["off", "unavailable", "unknown"].includes(h.states[r.clim].state)).length;
    const withClim = rooms.filter((r) => r.clim).length;
    const power = rooms.some((r) => r.power != null) ? rooms.reduce((a, r) => a + (r.power || 0), 0) : null;
    const chips = [];
    if (open) chips.push(`<span class="pill bad"><ha-icon icon="mdi:window-open-variant"></ha-icon>${open} Fenster offen</span>`);
    if (humid) chips.push(`<span class="pill bad"><ha-icon icon="mdi:water-alert-outline"></ha-icon>${humid} ${humid === 1 ? "Raum" : "Räume"} zu feucht</span>`);
    if (!open && !humid) chips.push(`<span class="pill ok"><ha-icon icon="mdi:check-circle-outline"></ha-icon>Alles in Ordnung</span>`);
    if (withClim) chips.push(`<span class="pill ${heating ? "heat" : ""}"><ha-icon icon="mdi:radiator"></ha-icon>Heizung in ${heating} von ${withClim} ${withClim === 1 ? "Raum" : "Räumen"} an</span>`);
    if (power != null && power >= 1) chips.push(`<span class="pill"><ha-icon icon="mdi:flash-outline"></ha-icon>${this._fmtW(power)}</span>`);
    return `<div class="summary">${chips.join("")}</div>`;
  }

  _heat(id, on) {
    const st = this._hass.states[id];
    if (!st) return;
    let mode = "off";
    if (on) {
      const modes = st.attributes.hvac_modes || [];
      mode = modes.includes("heat") ? "heat" : modes.find((m) => m !== "off") || "heat";
    }
    this._hass.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: mode });
  }

  _allOffIds(r) {
    const cfg = this._config.all_off;
    if (cfg === false) return [];
    const doms = Array.isArray(cfg) ? cfg : ["light", "switch"];
    return r.ids.filter((id) => doms.includes(id.split(".")[0]) && this._hass.states[id].state === "on");
  }

  _allOff(roomId) {
    const r = this._rooms().find((x) => x.id === roomId);
    if (!r) return;
    const ids = this._allOffIds(r);
    if (ids.length) this._hass.callService("homeassistant", "turn_off", { entity_id: ids });
  }

  _series(entries, start, end, n) {
    const pts = (entries || []).map((e) => {
      const raw = e.lu ?? e.last_updated ?? e.lc ?? e.last_changed;
      const t = typeof raw === "number" ? raw * 1000 : Date.parse(raw);
      const v = parseFloat(String(e.s ?? e.state).replace(",", "."));
      return { t, v };
    }).filter((p) => !isNaN(p.t) && !isNaN(p.v)).sort((a, b) => a.t - b.t);
    if (!pts.length) return [];
    const out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const mid = start + ((i + 0.5) * (end - start)) / n;
      while (j + 1 < pts.length && pts[j + 1].t <= mid) j++;
      out.push(pts[j].v);
    }
    return out;
  }

  async _loadHistory(room) {
    const now = Date.now();
    const cached = this._hist[room.id];
    if (cached && (cached.loading || now - cached.t < 600000)) return;
    const rec = { t: now, loading: true, series: {}, kwh: null };
    this._hist[room.id] = rec;
    const start = now - 7 * 86400000;
    try {
      const ids = [room.temp, room.hum].filter(Boolean);
      if (ids.length) {
        const res = await this._hass.callWS({
          type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(now).toISOString(),
          entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
        });
        ids.forEach((id) => { rec.series[id] = this._series(res[id], start, now, 84); });
      }
    } catch (e) { /* Verlauf ist optional */ }
    try {
      const eids = room.ids.filter((id) => id.startsWith("sensor.") && this._dc(id) === "energy");
      if (eids.length) {
        const mid = new Date(); mid.setHours(0, 0, 0, 0);
        const res = await this._hass.callWS({
          type: "recorder/statistics_during_period", start_time: mid.toISOString(), statistic_ids: eids, period: "day", types: ["change"],
        });
        let sum = 0; let found = false;
        eids.forEach((id) => {
          const unit = String((this._hass.states[id].attributes || {}).unit_of_measurement || "").toLowerCase();
          (res[id] || []).forEach((row) => {
            if (typeof row.change === "number") { sum += unit === "wh" ? row.change / 1000 : row.change; found = true; }
          });
        });
        if (found) rec.kwh = sum;
      }
    } catch (e) { /* Energie ist optional */ }
    rec.loading = false;
    rec.t = Date.now();
    this._sig = "";
    this._render();
  }

  _chart(label, values, cls, unit, dec) {
    if (!values || values.length < 2) return "";
    const mn = Math.min(...values), mx = Math.max(...values);
    const pad = (mx - mn) || 1;
    const pts = values.map((v, i) => `${((i * 300) / (values.length - 1)).toFixed(1)},${(52 - ((v - mn) / pad) * 46).toFixed(1)}`).join(" ");
    const f = (v) => v.toFixed(dec).replace(".", ",");
    return `
      <div class="chart ${cls}">
        <div class="ch"><span>${label}</span><span class="cr">${f(mn)} bis ${f(mx)} ${unit}</span></div>
        <svg viewBox="0 0 300 58" preserveAspectRatio="none" role="img" aria-label="${label}, letzte 7 Tage"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
      </div>`;
  }

  _insights(r) {
    const rec = this._hist[r.id] || {};
    const charts = [
      r.temp ? this._chart("Temperatur", (rec.series || {})[r.temp], "t", "°C", 1) : "",
      r.hum ? this._chart("Luftfeuchte", (rec.series || {})[r.hum], "h", "%", 0) : "",
    ].join("");
    const parts = [];
    if (r.power != null) parts.push(`<div class="kpi"><span class="kv">${this._fmtW(r.power)}</span><span class="kl">Aktuell</span></div>`);
    if (rec.kwh != null) parts.push(`<div class="kpi"><span class="kv">${this._fmtKwh(rec.kwh)}</span><span class="kl">Heute</span></div>`);
    if (!charts && !parts.length) return rec.loading ? `<div class="cat"><ha-icon icon="mdi:chart-line"></ha-icon>Verlauf wird geladen …</div>` : "";
    return `
      ${parts.length ? `<div class="cat"><ha-icon icon="mdi:flash-outline"></ha-icon>Energie</div><div class="kpis">${parts.join("")}</div>` : ""}
      ${charts ? `<div class="cat"><ha-icon icon="mdi:chart-line"></ha-icon>Verlauf, letzte 7 Tage</div>${charts}<div class="axis"><span>vor 7 Tagen</span><span>jetzt</span></div>` : ""}`;
  }

  _rank(id, list) {
    const i = list.indexOf(this._dc(id));
    return i < 0 ? 99 : i;
  }

  _isEssential(id) {
    const domain = id.split(".")[0];
    if (domain === "sensor") return ESSENTIAL_SENSOR.includes(this._dc(id));
    if (domain === "binary_sensor") return ESSENTIAL_BINARY.includes(this._dc(id));
    return true;
  }

  _byUse(a, b, list) {
    const act = (id) => (OFF_STATES.includes(this._hass.states[id].state) ? 1 : 0);
    const dom = a.split(".")[0];
    if (dom === "sensor" || dom === "binary_sensor") {
      return this._rank(a, list) - this._rank(b, list) || this._name(a).localeCompare(this._name(b), "de");
    }
    return act(a) - act(b) || this._name(a).localeCompare(this._name(b), "de");
  }

  _popup(r) {
    const more = [];
    const groups = CATEGORIES.map((c) => {
      const all = r.ids.filter((id) => c.domains.includes(id.split(".")[0]));
      const list = c.key === "binary" ? ESSENTIAL_BINARY : ESSENTIAL_SENSOR;
      const items = all.filter((id) => this._isEssential(id)).sort((x, y) => this._byUse(x, y, list));
      all.filter((id) => !this._isEssential(id)).forEach((id) => more.push(id));
      return { c, items };
    }).filter((g) => g.items.length);
    more.sort((x, y) => this._name(x).localeCompare(this._name(y), "de"));
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    const moreOpen = !!this._more[r.id];
    const offIds = this._allOffIds(r);
    return `
      <div class="overlay" data-action="close">
        <div class="sheet" role="dialog" aria-label="${esc(r.name)}">
          <div class="grab"></div>
          <div class="head">
            <span class="hic"><ha-icon icon="${esc(r.icon)}"></ha-icon></span>
            <span class="ht"><span class="hn">${esc(r.name)}</span><span class="hs">${count} Geräte${more.length ? `, ${more.length} weitere Sensoren` : ""}${r.power != null ? `, ${this._fmtW(r.power)}` : ""}</span></span>
            <button class="x" data-action="close" aria-label="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          ${offIds.length ? `<button class="alloff" data-action="alloff" data-room="${esc(r.id)}"><ha-icon icon="mdi:power"></ha-icon>${this._flash === "off:" + r.id ? "Ausgeschaltet" : `Alles aus (${offIds.length})`}</button>` : ""}
          ${groups.length ? groups.map((g) => `
            <div class="cat"><ha-icon icon="${g.c.icon}"></ha-icon>${g.c.title}</div>
            <div class="tiles">${g.items.map((id) => this._deviceRow(id)).join("")}</div>`).join("") : `<p class="empty">Diesem Bereich sind noch keine Geräte zugeordnet.</p>`}
          ${this._insights(r)}
          ${more.length ? `
            <button class="more" data-action="more" data-room="${esc(r.id)}"><ha-icon icon="${moreOpen ? "mdi:chevron-up" : "mdi:chevron-down"}"></ha-icon>${moreOpen ? "Weitere Sensoren ausblenden" : `Weitere Sensoren anzeigen (${more.length})`}</button>
            ${moreOpen ? `<div class="tiles">${more.map((id) => this._deviceRow(id)).join("")}</div>` : ""}` : ""}
        </div>
      </div>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const rooms = this._rooms();
    const open = rooms.find((r) => r.id === this._openRoom);
    const title = this._config.title;
    if (open) this._loadHistory(open);
    const html = `
      <style>${RUC_STYLE}</style>
      <ha-card>
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
        ${this._config.summary === false ? "" : this._summary(rooms)}
        <div class="grid" style="--cols:${Number(this._config.columns) || 2}">
          ${rooms.length ? rooms.map((r) => this._roomCard(r)).join("") : `<p class="empty">Keine Räume gefunden. Lege in Home Assistant Bereiche an und ordne Geräte zu.</p>`}
        </div>
      </ha-card>
      ${open ? this._popup(open) : ""}`;
    if (html === this._sig) return;
    const sheet = this.shadowRoot.querySelector(".sheet");
    if (sheet) this._sheetScroll = sheet.scrollTop;
    this._sig = html;
    this.shadowRoot.innerHTML = html;
    const ns = this.shadowRoot.querySelector(".sheet");
    if (ns) ns.scrollTop = this._sheetScroll;
  }

  _step(id, dir) {
    const st = this._hass.states[id];
    if (!st) return;
    const step = Number(st.attributes.target_temp_step) || 0.5;
    const min = st.attributes.min_temp ?? 5;
    const max = st.attributes.max_temp ?? 30;
    const p = this._pend[id];
    const base = p && Date.now() - p.t < 4000 ? p.v : Number(st.attributes.temperature);
    if (isNaN(base)) return;
    let v = Math.round((base + dir * step) / step) * step;
    v = Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    this._pend[id] = { v, t: Date.now() };
    this._hass.callService("climate", "set_temperature", { entity_id: id, temperature: v });
    this._sig = "";
    this._render();
  }

  _announce(roomId) {
    const room = this._rooms().find((r) => r.id === roomId);
    if (!room || !room.announce) return;
    const a = room.announce;
    const [domain, service] = String(a.service || "notify.alexa_media").split(".");
    const t = a.targets || a.target;
    const targets = Array.isArray(t) ? t : [t];
    this._hass.callService(domain, service, {
      message: `${room.name}. ${this._fmt(room.vent)}`,
      target: targets,
      data: { type: a.type || "announce" },
    });
    this._flash = roomId;
    this._sig = "";
    this._render();
    setTimeout(() => { this._flash = null; this._sig = ""; this._render(); }, 2000);
  }

  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "close") {
      if (el.classList.contains("overlay") && e.target !== el) return;
      this._openRoom = null; this._sheetScroll = 0; this._sig = ""; this._render();
    } else if (action === "open") {
      this._openRoom = el.dataset.room; this._sheetScroll = 0; this._sig = ""; this._render();
    } else if (action === "toggle") {
      e.stopPropagation();
      this._hass.callService("homeassistant", "toggle", { entity_id: el.dataset.entity });
    } else if (action === "heat") {
      e.stopPropagation();
      this._heat(el.dataset.entity, el.dataset.mode === "on");
    } else if (action === "alloff") {
      this._allOff(el.dataset.room);
      this._flash = "off:" + el.dataset.room;
      this._sig = ""; this._render();
      setTimeout(() => { this._flash = null; this._sig = ""; this._render(); }, 2000);
    } else if (action === "more") {
      this._more[el.dataset.room] = !this._more[el.dataset.room];
      this._sig = "";
      this._render();
    } else if (action === "step") {
      e.stopPropagation();
      this._step(el.dataset.entity, Number(el.dataset.dir));
    } else if (action === "announce") {
      e.stopPropagation();
      this._announce(el.dataset.room);
    } else if (action === "info") {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: el.dataset.entity }, bubbles: true, composed: true }));
    }
  }
}

const RUC_STYLE = `
  :host { display: block; }
  * { box-sizing: border-box; }
  ha-card { padding: 12px; background: transparent; box-shadow: none; border: none; }
  button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
  .title { font-size: 22px; font-weight: 500; letter-spacing: -.01em; color: var(--primary-text-color); margin: 4px 4px 12px; }
  .empty { color: var(--secondary-text-color); font-size: 14px; padding: 8px; }
  .grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 12px; }

  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 2px 14px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; padding: 6px 12px 6px 9px; border-radius: 999px; white-space: nowrap;
    background: color-mix(in srgb, var(--card-background-color) 70%, transparent); color: var(--primary-text-color);
    border: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); --mdc-icon-size: 16px; }
  .pill.ok { background: color-mix(in srgb, var(--success-color, #43a047) 20%, transparent); color: var(--success-color, #66bb6a); border-color: transparent; }
  .pill.bad { background: color-mix(in srgb, var(--error-color, #db4437) 22%, transparent); color: var(--error-color, #ef5350); border-color: transparent; }
  .pill.heat { background: color-mix(in srgb, var(--state-climate-heat-color, #ff8100) 20%, transparent); color: var(--state-climate-heat-color, #ff9800); border-color: transparent; }

  .room { position: relative; text-align: left; cursor: pointer; outline: none; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px;
    border-radius: 24px; border: 1px solid color-mix(in srgb, var(--divider-color) 55%, transparent);
    background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 80%, transparent);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); transition: transform .12s ease, border-color .2s ease; }
  .room:active { transform: scale(.985); }
  .room:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .room.bad { border-color: color-mix(in srgb, var(--error-color, #db4437) 55%, transparent);
    background: linear-gradient(160deg, color-mix(in srgb, var(--error-color, #db4437) 18%, transparent), transparent 65%), color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 80%, transparent); }
  .room.warn { border-color: color-mix(in srgb, var(--warning-color, #f4b400) 45%, transparent);
    background: linear-gradient(160deg, color-mix(in srgb, var(--warning-color, #f4b400) 14%, transparent), transparent 65%), color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 80%, transparent); }

  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ic { flex: none; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 19px;
    background: color-mix(in srgb, var(--primary-color) 18%, transparent); color: var(--primary-color); }
  .room.bad .ic { background: color-mix(in srgb, var(--error-color, #db4437) 22%, transparent); color: var(--error-color, #ef5350); }
  .room.warn .ic { background: color-mix(in srgb, var(--warning-color, #f4b400) 22%, transparent); color: var(--warning-color, #f4b400); }
  .name { flex: 1; min-width: 0; font-size: 15px; font-weight: 500; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wopen { flex: none; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; padding: 3px 8px 3px 5px; border-radius: 999px; --mdc-icon-size: 14px;
    background: color-mix(in srgb, var(--error-color, #db4437) 24%, transparent); color: var(--error-color, #ef5350); }

  .tline { display: flex; align-items: baseline; gap: 8px; }
  .temp { font-size: 36px; line-height: 1; font-weight: 400; letter-spacing: -.03em; color: var(--primary-text-color); }
  .temp small { font-size: 15px; font-weight: 400; letter-spacing: 0; margin-left: 2px; color: var(--secondary-text-color); }
  .tgt { font-size: 13px; color: var(--secondary-text-color); }

  .hum { display: flex; align-items: center; gap: 8px; }
  .hbar { flex: 1; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
  .hbar i { display: block; height: 100%; border-radius: 3px; background: var(--secondary-text-color); }
  .hum.ok .hbar i { background: var(--success-color, #43a047); }
  .hum.warn .hbar i { background: var(--warning-color, #f4b400); }
  .hum.bad .hbar i { background: var(--error-color, #db4437); }
  .hp { font-size: 13px; font-weight: 500; min-width: 38px; text-align: right; color: var(--primary-text-color); }
  .hum.ok .hp { color: var(--success-color, #66bb6a); }
  .hum.warn .hp { color: var(--warning-color, #f4b400); }
  .hum.bad .hp { color: var(--error-color, #ef5350); }

  .heat { display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .hv2 { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-size: 14px; font-weight: 500; white-space: nowrap; --mdc-icon-size: 16px;
    color: var(--state-climate-heat-color, #ff9800); }
  .heat.off .hv2 { justify-content: flex-start; padding-left: 8px; color: var(--secondary-text-color); font-weight: 400; }
  .step { flex: none; width: 30px; height: 30px; padding: 0; border: none; border-radius: 50%; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); color: var(--primary-text-color); --mdc-icon-size: 18px; transition: transform .1s ease; }
  .step:active { transform: scale(.9); }
  .pw.on { background: color-mix(in srgb, var(--state-climate-heat-color, #ff8100) 28%, transparent); color: var(--state-climate-heat-color, #ff9800); }

  .pow { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--secondary-text-color); --mdc-icon-size: 15px; }
  .vent { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 10px; border-radius: 14px; font-size: 12px; line-height: 1.35; --mdc-icon-size: 16px;
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); color: var(--secondary-text-color); }
  .vent.warn { background: color-mix(in srgb, var(--warning-color, #f4b400) 16%, transparent); color: var(--primary-text-color); }
  .vent.bad { background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent); color: var(--primary-text-color); }
  .vt { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ann { flex: none; width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); --mdc-icon-size: 16px; }

  .overlay { position: fixed; inset: 0; z-index: 9; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.5);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fade .2s ease; }
  .sheet { width: 100%; max-width: 600px; max-height: 90vh; overflow: auto; padding: 8px 16px 28px; background: var(--card-background-color);
    border-radius: 28px 28px 0 0; animation: up .28s cubic-bezier(.2,.8,.2,1); }
  @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .grab { width: 40px; height: 4px; border-radius: 2px; background: var(--divider-color); margin: 0 auto 14px; }
  .head { display: flex; align-items: center; gap: 12px; margin-bottom: 2px; }
  .hic { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 24px;
    background: color-mix(in srgb, var(--primary-color) 20%, transparent); color: var(--primary-color); }
  .ht { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .hn { font-size: 22px; font-weight: 500; letter-spacing: -.01em; color: var(--primary-text-color); }
  .hs { font-size: 12px; color: var(--secondary-text-color); }
  .x { flex: none; width: 36px; height: 36px; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 20px;
    background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); color: var(--primary-text-color); }
  .cat { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; letter-spacing: .03em; color: var(--secondary-text-color); margin: 20px 2px 8px; --mdc-icon-size: 16px; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .tile { position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px; border-radius: 20px; cursor: pointer; outline: none;
    background: var(--secondary-background-color); transition: transform .1s ease, background .2s ease; }
  .tile:active { transform: scale(.98); }
  .tile:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .tile.wide { grid-column: 1 / -1; }
  .tile.dis { opacity: .5; }
  .tt { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .dic { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 20px;
    background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); color: var(--secondary-text-color); }
  .tile.on { background: color-mix(in srgb, var(--state-light-active-color, #ffc107) 20%, var(--secondary-background-color)); }
  .tile.on .dic { background: var(--state-light-active-color, #ffc107); color: #3d2c00; }
  .ib { width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 18px;
    background: none; color: var(--secondary-text-color); }
  .dn { font-size: 14px; font-weight: 500; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .alloff { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin: 14px 0 0; padding: 12px; border-radius: 16px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 500; --mdc-icon-size: 18px; background: color-mix(in srgb, var(--primary-color) 16%, transparent); color: var(--primary-color); }
  .kpis { display: flex; gap: 8px; }
  .kpi { flex: 1; display: flex; flex-direction: column; padding: 12px 14px; border-radius: 18px; background: var(--secondary-background-color); }
  .kv { font-size: 22px; font-weight: 500; letter-spacing: -.02em; color: var(--primary-text-color); }
  .kl { font-size: 12px; color: var(--secondary-text-color); }
  .chart { padding: 12px 14px 8px; margin-bottom: 8px; border-radius: 18px; background: var(--secondary-background-color); }
  .chart.t { color: var(--state-climate-heat-color, #ff9800); }
  .chart.h { color: var(--primary-color); }
  .ch { display: flex; justify-content: space-between; font-size: 13px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 6px; }
  .cr { font-weight: 400; color: var(--secondary-text-color); font-size: 12px; }
  .chart svg { width: 100%; height: 58px; display: block; }
  .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); padding: 0 4px; }
  .more { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; margin: 16px 0 10px; padding: 12px; border-radius: 16px; cursor: pointer; font-size: 13px;
    border: 1px dashed var(--divider-color); background: none; color: var(--secondary-text-color); --mdc-icon-size: 18px; }
`;

if (!customElements.get("raum-uebersicht-card")) customElements.define("raum-uebersicht-card", RaumUebersichtCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "raum-uebersicht-card",
  name: "Raumübersicht",
  description: "Alle Räume auf einen Blick, mit Geräte-Popup je Raum (automatisch aus den Bereichen).",
});
console.info(`%c RAUM-UEBERSICHT %c ${RUC_VERSION} `, "background:#3b82f6;color:#fff;border-radius:3px 0 0 3px", "background:#e5e7eb;color:#111;border-radius:0 3px 3px 0");
