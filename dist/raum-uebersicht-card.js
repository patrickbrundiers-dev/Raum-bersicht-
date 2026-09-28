/* Raumübersicht Card für Home Assistant
 * Zeigt alle Räume (Areas) als Karten und öffnet pro Raum ein Popup
 * mit allen Geräten, nach Kategorien sortiert. Keine Entity-IDs nötig.
 */
const RUC_VERSION = "2.0.0";

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
      if ((e.key === "Enter" || e.key === " ") && e.target && e.target.dataset && e.target.dataset.action === "open") {
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
    const winUnknown = r.win && ["unavailable", "unknown"].includes(this._hass.states[r.win].state);
    const clim = r.clim && this._hass.states[r.clim];
    const pend = clim && this._pend[r.clim];
    const target = pend && Date.now() - pend.t < 4000 ? pend.v : clim && clim.attributes.temperature;
    const heating = clim && clim.state !== "off" && clim.state !== "unavailable";
    const vent = r.vent && this._hass.states[r.vent];
    const tempTxt = t == null ? "–" : `${t.toFixed(1).replace(".", ",")} °C`;
    return `
      <div class="room ${r.level}" role="button" tabindex="0" data-action="open" data-room="${esc(r.id)}">
        <div class="top">
          <span class="ic"><ha-icon icon="${esc(r.icon)}"></ha-icon></span>
          <span class="name">${esc(r.name)}</span>
          ${r.win ? `<span class="pill ${winOpen ? "bad" : winUnknown ? "" : "ok"}"><ha-icon icon="${winOpen ? "mdi:window-open-variant" : "mdi:window-closed-variant"}"></ha-icon>${winOpen ? this._since(r.win) : winUnknown ? "?" : "zu"}</span>` : ""}
        </div>
        <div class="temp">${tempTxt}</div>
        <div class="meta">
          ${hv != null ? `<span class="pill ${this._humClass(hv)}"><ha-icon icon="mdi:water-percent"></ha-icon>${Math.round(hv)} %</span>` : ""}
          ${clim ? (heating && target != null
            ? `<span class="ctl"><button class="step" data-action="step" data-dir="-1" data-entity="${esc(r.clim)}" aria-label="Kälter"><ha-icon icon="mdi:minus"></ha-icon></button><span class="pill heat"><ha-icon icon="mdi:radiator"></ha-icon>${String(target).replace(".", ",")} °C</span><button class="step" data-action="step" data-dir="1" data-entity="${esc(r.clim)}" aria-label="Wärmer"><ha-icon icon="mdi:plus"></ha-icon></button><button class="step pw on" data-action="heat" data-mode="off" data-entity="${esc(r.clim)}" aria-label="Heizung ausschalten"><ha-icon icon="mdi:power"></ha-icon></button></span>`
            : `<span class="ctl"><span class="pill ${heating ? "heat" : ""}"><ha-icon icon="mdi:radiator"></ha-icon>${heating ? esc(clim.state) : "Aus"}</span>${clim.state !== "unavailable" ? `<button class="step pw" data-action="heat" data-mode="on" data-entity="${esc(r.clim)}" aria-label="Heizung einschalten"><ha-icon icon="mdi:power"></ha-icon></button>` : ""}</span>`) : ""}
          ${r.power != null && r.power >= 1 ? `<span class="pill"><ha-icon icon="mdi:flash-outline"></ha-icon>${this._fmtW(r.power)}</span>` : ""}
        </div>
        ${vent && !["unknown", "unavailable"].includes(vent.state) ? `<div class="vent"><ha-icon icon="mdi:weather-windy"></ha-icon><span class="vt">${esc(this._fmt(r.vent))}</span>${r.announce ? `<button class="ann" data-action="announce" data-room="${esc(r.id)}"><ha-icon icon="mdi:bullhorn-outline"></ha-icon>${this._flash === r.id ? "Angesagt" : "Ansagen"}</button>` : ""}</div>` : ""}
      </div>`;
  }

  _deviceRow(id) {
    const s = this._hass.states[id];
    const domain = id.split(".")[0];
    const toggle = TOGGLE_DOMAINS.includes(domain);
    const on = !OFF_STATES.includes(s.state);
    const dis = s.state === "unavailable";
    return `
      <div class="dev ${on && domain !== "sensor" && domain !== "binary_sensor" ? "on" : ""} ${dis ? "dis" : ""}" data-action="info" data-entity="${esc(id)}">
        <span class="dic"><ha-icon icon="${esc(this._icon(id))}"></ha-icon></span>
        <span class="dt"><span class="dn">${esc(this._name(id))}</span><span class="ds">${esc(this._fmt(id))}</span></span>
        ${toggle && !dis ? `<button class="tg ${on ? "on" : ""}" data-action="toggle" data-entity="${esc(id)}" aria-label="Umschalten"><i></i></button>` : ""}
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
            ${g.items.map((id) => this._deviceRow(id)).join("")}`).join("") : `<p class="empty">Diesem Bereich sind noch keine Geräte zugeordnet.</p>`}
          ${this._insights(r)}
          ${more.length ? `
            <button class="more" data-action="more" data-room="${esc(r.id)}"><ha-icon icon="${moreOpen ? "mdi:chevron-up" : "mdi:chevron-down"}"></ha-icon>${moreOpen ? "Weitere Sensoren ausblenden" : `Weitere Sensoren anzeigen (${more.length})`}</button>
            ${moreOpen ? more.map((id) => this._deviceRow(id)).join("") : ""}` : ""}
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
  ha-card { padding: 12px; background: transparent; box-shadow: none; border: none; }
  .title { font-size: 20px; font-weight: 500; color: var(--primary-text-color); margin: 4px 4px 12px; }
  .grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 12px; }
  .empty { color: var(--secondary-text-color); font-size: 14px; padding: 8px; }
  button { font: inherit; color: inherit; }
  .room { text-align: left; cursor: pointer; outline: none; padding: 12px; border-radius: 16px; border: 1px solid var(--divider-color);
    background: var(--ha-card-background, var(--card-background-color)); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .room.bad { border-color: var(--error-color); }
  .room.warn { border-color: var(--warning-color, #f4b400); }
  .room:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .ctl { display: inline-flex; align-items: center; gap: 4px; }
  .step { width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; cursor: pointer; display: inline-flex;
    align-items: center; justify-content: center; background: var(--secondary-background-color); color: var(--primary-text-color); --mdc-icon-size: 16px; }
  .step:active { transform: scale(.94); }
  .vt { flex: 1; min-width: 0; }
  .ann { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 4px 10px 4px 6px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); --mdc-icon-size: 14px; white-space: nowrap; }
  .top { display: flex; align-items: center; gap: 8px; }
  .ic { color: var(--secondary-text-color); --mdc-icon-size: 20px; display: flex; }
  .name { flex: 1; font-size: 15px; font-weight: 500; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .temp { font-size: 26px; font-weight: 500; color: var(--primary-text-color); }
  .meta { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; padding: 3px 8px 3px 5px; border-radius: 999px;
    background: var(--secondary-background-color); color: var(--secondary-text-color); --mdc-icon-size: 14px; white-space: nowrap; }
  .pill.ok { background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); color: var(--success-color, #2e7d32); }
  .pill.warn { background: color-mix(in srgb, var(--warning-color, #f4b400) 22%, transparent); color: var(--warning-color, #b26a00); }
  .pill.bad { background: color-mix(in srgb, var(--error-color, #db4437) 18%, transparent); color: var(--error-color, #c62828); }
  .pill.heat { background: color-mix(in srgb, var(--state-climate-heat-color, #ff8100) 20%, transparent); color: var(--state-climate-heat-color, #e65100); }
  .vent { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); --mdc-icon-size: 16px;
    padding-top: 8px; border-top: 1px solid var(--divider-color); }
  .overlay { position: fixed; inset: 0; z-index: 9; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 560px; max-height: 88vh; overflow: auto; box-sizing: border-box; padding: 8px 16px 24px;
    background: var(--card-background-color); border-radius: 20px 20px 0 0; }
  .grab { width: 36px; height: 4px; border-radius: 2px; background: var(--divider-color); margin: 0 auto 12px; }
  .head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .hic { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--primary-color) 18%, transparent); color: var(--primary-color); --mdc-icon-size: 22px; }
  .ht { flex: 1; display: flex; flex-direction: column; }
  .hn { font-size: 20px; font-weight: 500; color: var(--primary-text-color); }
  .hs { font-size: 12px; color: var(--secondary-text-color); }
  .x { border: none; background: none; cursor: pointer; color: var(--secondary-text-color); padding: 6px; --mdc-icon-size: 22px; }
  .summary { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 4px 12px; }
  .summary .pill { font-size: 13px; padding: 5px 10px 5px 7px; --mdc-icon-size: 16px; }
  .pw { margin-left: 2px; }
  .pw.on { background: color-mix(in srgb, var(--state-climate-heat-color, #ff8100) 22%, transparent); color: var(--state-climate-heat-color, #e65100); }
  .alloff { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin: 12px 0 0; padding: 10px; border-radius: 14px;
    border: none; cursor: pointer; font-size: 14px; background: var(--secondary-background-color); color: var(--primary-text-color); --mdc-icon-size: 18px; }
  .kpis { display: flex; gap: 8px; }
  .kpi { flex: 1; background: var(--secondary-background-color); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; }
  .kv { font-size: 18px; font-weight: 500; color: var(--primary-text-color); }
  .kl { font-size: 12px; color: var(--secondary-text-color); }
  .chart { background: var(--secondary-background-color); border-radius: 14px; padding: 10px 12px 6px; margin-bottom: 6px; }
  .chart.t { color: var(--state-climate-heat-color, #e65100); }
  .chart.h { color: var(--primary-color); }
  .ch { display: flex; justify-content: space-between; font-size: 13px; color: var(--primary-text-color); margin-bottom: 4px; }
  .cr { color: var(--secondary-text-color); font-size: 12px; }
  .chart svg { width: 100%; height: 58px; display: block; }
  .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); padding: 0 4px; }
  .more { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; margin: 12px 0 8px; padding: 10px;
    border-radius: 14px; border: 1px dashed var(--divider-color); background: none; cursor: pointer; font-size: 13px;
    color: var(--secondary-text-color); --mdc-icon-size: 18px; }
  .cat { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); margin: 16px 0 6px; --mdc-icon-size: 16px; }
  .dev { display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 6px; border-radius: 14px; cursor: pointer;
    background: var(--secondary-background-color); }
  .dev.dis { opacity: .55; }
  .dic { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
    background: var(--card-background-color); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .dev.on .dic { background: color-mix(in srgb, var(--state-light-active-color, #ffc107) 30%, transparent); color: var(--state-light-active-color, #b26a00); }
  .dt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .dn { font-size: 14px; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds { font-size: 12px; color: var(--secondary-text-color); }
  .tg { position: relative; width: 38px; height: 22px; border-radius: 11px; border: none; cursor: pointer; flex: none;
    background: var(--disabled-color, #bdbdbd); }
  .tg i { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
  .tg.on { background: var(--primary-color); }
  .tg.on i { left: 19px; }
`;

if (!customElements.get("raum-uebersicht-card")) customElements.define("raum-uebersicht-card", RaumUebersichtCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "raum-uebersicht-card",
  name: "Raumübersicht",
  description: "Alle Räume auf einen Blick, mit Geräte-Popup je Raum (automatisch aus den Bereichen).",
});
console.info(`%c RAUM-UEBERSICHT %c ${RUC_VERSION} `, "background:#3b82f6;color:#fff;border-radius:3px 0 0 3px", "background:#e5e7eb;color:#111;border-radius:0 3px 3px 0");
