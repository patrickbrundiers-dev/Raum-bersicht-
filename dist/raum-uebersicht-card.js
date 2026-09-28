/* Raumübersicht Card für Home Assistant
 * Zeigt alle Räume (Areas) als Karten und öffnet pro Raum ein Popup
 * mit allen Geräten, nach Kategorien sortiert. Keine Entity-IDs nötig.
 */
const RUC_VERSION = "2.4.0";

const CATEGORIES = [
  { key: "climate", title: "Heizung und Klima", icon: "mdi:radiator", domains: ["climate", "water_heater"] },
  { key: "light", title: "Licht", icon: "mdi:lightbulb-outline", domains: ["light"] },
  { key: "cover", title: "Rollos und Fenster", icon: "mdi:blinds", domains: ["cover"] },
  { key: "switch", title: "Steckdosen und Schalter", icon: "mdi:power-socket-eu", domains: ["switch", "input_boolean", "fan", "humidifier"] },
  { key: "media", title: "Medien", icon: "mdi:speaker", domains: ["media_player"] },
  { key: "binary", title: "Fenster und Bewegung", icon: "mdi:door", domains: ["binary_sensor"] },
  { key: "sensor", title: "Raumklima", icon: "mdi:gauge", domains: ["sensor"] },
];
// Temperatur, Feuchte und Leistung stehen schon auf der Karte bzw. im Popup-Kopf, hier nur echte Zusatzwerte
const ESSENTIAL_SENSOR = ["carbon_dioxide", "co2", "pm25", "volatile_organic_compounds"];
const ESSENTIAL_BINARY = ["window", "door", "opening", "garage_door", "motion", "occupancy", "presence", "smoke", "moisture", "gas", "carbon_monoxide"];
// Technik-Entitäten, die im Popup nie erscheinen (auch nicht bei "Alles aus")
const HIDE_RE = /(_linkquality|_last_seen|_identify|_restart|_uptime|_ip_address|child_lock|window_detection|valve_detection|window_open|auto_lock|led_indicator|indicator|calibration|frost_protection|_boost)/;
// Abgeleitete Werte (Taupunkt, Hitzeindex ...) sind keine Raumtemperatur
const DERIVED_RE = /(dew|taupunkt|frost|heat.?index|hitzeindex|humidex|simmer|perceived|wahrgenommen|absolut|feels|gef[üu]hl|comfort|komfort|thermal)/i;
const DERIVED_PLATFORMS = ["thermal_comfort", "template", "derivative", "statistics", "min_max", "filter", "integration"];
const TRV_RE = /(heizk[öo]rper|thermostat|trv|local_temperature|radiator)/i;
const HIDE_NAME_RE = /(nicht st[öo]ren|do not disturb|kindersicherung|child lock)/i;
// Diese Geräte schaltet "Alles aus" nie aus, auch nicht bei all_off: [light, switch]
const KEEP_ON_RE = /(k[üu]hl|gefrier|fridge|freezer|router|modem|nas\b|server|alarm|wlan|switch_poe)/i;
const BIN_ICONS = {
  window: ["mdi:window-open-variant", "mdi:window-closed-variant"], door: ["mdi:door-open", "mdi:door-closed"],
  opening: ["mdi:door-open", "mdi:door-closed"], garage_door: ["mdi:garage-open", "mdi:garage"],
  motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"], occupancy: ["mdi:home-account", "mdi:home-outline"],
  presence: ["mdi:home-account", "mdi:home-outline"], smoke: ["mdi:smoke-detector-alert", "mdi:smoke-detector"],
  moisture: ["mdi:water-alert", "mdi:water-off"], gas: ["mdi:gas-cylinder", "mdi:gas-cylinder"],
  carbon_monoxide: ["mdi:molecule-co", "mdi:molecule-co"],
};
const SENSOR_ICONS = { carbon_dioxide: "mdi:molecule-co2", co2: "mdi:molecule-co2", pm25: "mdi:air-filter", volatile_organic_compounds: "mdi:air-filter" };
const WEATHER_ICONS = {
  sunny: "mdi:weather-sunny", "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", partlycloudy: "mdi:weather-partly-cloudy",
  rainy: "mdi:weather-rainy", pouring: "mdi:weather-pouring", snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy",
  fog: "mdi:weather-fog", windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant", lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy", hail: "mdi:weather-hail", exceptional: "mdi:alert-circle-outline",
};
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
    this._config = { columns: 1, sort: "urgency", ...config };
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
    const ex = Array.isArray(this._config.exclude) ? this._config.exclude.map(norm) : [];
    if (ex.length) list = list.filter(({ area }) => !ex.includes(norm(area.name)) && !ex.includes(norm(area.area_id)));
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

  _bestSensor(ids, classes, units) {
    const h = this._hass;
    let best = null;
    let bs = Infinity;
    ids.forEach((id) => {
      if (!id.startsWith("sensor.") || !classes.includes(this._dc(id))) return;
      const st = h.states[id];
      const unit = String(st.attributes.unit_of_measurement || "");
      if (unit && units && !units.includes(unit)) return;
      const name = `${id} ${st.attributes.friendly_name || ""}`;
      let sc = 0;
      if (DERIVED_RE.test(name)) sc += 100;
      const reg = h.entities && h.entities[id];
      if (reg && DERIVED_PLATFORMS.includes(reg.platform)) sc += 100;
      if (TRV_RE.test(name)) sc += 20;
      if (/(temperatur|temperature|luftfeucht|humidity|feuchte)/i.test(name)) sc -= 5;
      if (sc < bs) { bs = sc; best = id; }
    });
    return bs >= 100 ? null : best;
  }

  _bestWindow(ids) {
    const order = ["window", "opening", "door", "garage_door"];
    const cands = ids.filter((id) => id.startsWith("binary_sensor.") && order.includes(this._dc(id)) && !HIDE_RE.test(id));
    cands.sort((a, b) => order.indexOf(this._dc(a)) - order.indexOf(this._dc(b)));
    return cands[0] || null;
  }

  _pick(ids, domain, deviceClasses) {
    return ids.find((id) => id.startsWith(domain + ".") && (!deviceClasses || deviceClasses.includes(this._dc(id)))) || null;
  }

  _buildRoom(cfg, area) {
    const ids = this._entitiesInArea(area.area_id).filter((id) => this._visible(id));
    const h = this._hass;
    const has = (id) => id && h.states[id];
    const temp = has(cfg.temperature) ? cfg.temperature : this._bestSensor(ids, ["temperature"], ["°C", "°F"]);
    const hum = has(cfg.humidity) ? cfg.humidity : this._bestSensor(ids, ["humidity"], ["%"]);
    const win = has(cfg.window) ? cfg.window : this._bestWindow(ids);
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
    if (s && s.attributes.icon) return s.attributes.icon;
    const domain = id.split(".")[0];
    const dc = s && s.attributes.device_class;
    if (domain === "binary_sensor" && BIN_ICONS[dc]) return BIN_ICONS[dc][s.state === "on" ? 0 : 1];
    if (domain === "sensor" && SENSOR_ICONS[dc]) return SENSOR_ICONS[dc];
    return DOMAIN_ICONS[domain] || "mdi:help-circle-outline";
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

  _roomCard(r, idx) {
    const t = this._num(r.temp);
    const hv = this._num(r.hum);
    const wst = r.win && this._hass.states[r.win];
    const winOpen = wst && wst.state === "on";
    const winOk = wst && wst.state === "off";
    const clim = r.clim && this._hass.states[r.clim];
    const pend = clim && this._pend[r.clim];
    const target = pend && Date.now() - pend.t < 4000 ? pend.v : clim && clim.attributes.temperature;
    const heating = clim && clim.state !== "off" && clim.state !== "unavailable";
    const vent = r.vent && this._hass.states[r.vent];
    const tt = t == null ? "–" : t.toFixed(1).replace(".", ",");
    const num = (v) => String(v).replace(".", ",");
    const ob = (icon, attrs, label, txt = "") => `<button class="ob" ${attrs} aria-label="${label}">${txt || `<ha-icon icon="${icon}"></ha-icon>`}</button>`;
    let hum = "";
    if (hv != null) {
      const pos = Math.max(0, Math.min(100, ((hv - 20) / 60) * 100)).toFixed(1);
      hum = `<div class="hb ${this._humClass(hv)}">
        <div class="lr"><span class="lb">Luftfeuchte</span><span class="hvv">${Math.round(hv)} %</span></div>
        <div class="seg"><i></i><i></i><i></i><i></i></div>
        <div class="mk"><i style="left:${pos}%"></i></div>
      </div>`;
    }
    let heat = "";
    if (clim && heating && target != null) {
      heat = `<div class="hr"><div><div class="lb">Heizung</div><div class="hz">Ziel ${num(Number(target).toFixed(1))} °C</div></div>
        <div class="hbtns">
          ${ob("mdi:minus", `data-action="step" data-dir="-1" data-entity="${esc(r.clim)}"`, "Kälter")}
          ${ob("mdi:plus", `data-action="step" data-dir="1" data-entity="${esc(r.clim)}"`, "Wärmer")}
          ${ob("", `data-action="heat" data-mode="off" data-entity="${esc(r.clim)}"`, "Heizung ausschalten", "Aus")}
        </div></div>`;
    } else if (clim) {
      heat = `<div class="hr"><div><div class="lb">Heizung</div><div class="hz off">${heating ? esc(clim.state) : "Aus"}</div></div>
        <div class="hbtns">${clim.state !== "unavailable" ? ob("", `data-action="heat" data-mode="on" data-entity="${esc(r.clim)}"`, "Heizung einschalten", "Heizen") : ""}</div></div>`;
    }
    const ventShow = vent && !["unknown", "unavailable"].includes(vent.state);
    return `
      <div class="room ${r.level}" role="button" tabindex="0" data-action="open" data-room="${esc(r.id)}">
        <div class="rh">
          <ha-icon class="ri" icon="${esc(r.icon)}"></ha-icon>
          <span class="rn">${esc(r.name)}</span>
          ${winOpen ? `<span class="wpill bad"><ha-icon icon="mdi:window-open-variant"></ha-icon>offen seit ${this._since(r.win)}</span>` : winOk ? `<span class="wpill ok"><ha-icon icon="mdi:window-closed-variant"></ha-icon>geschlossen</span>` : ""}
        </div>
        <div class="tr">
          <div class="tc"><div class="lb">Temperatur</div><div class="tv">${tt}<small> °C</small></div>${r.power != null && r.power >= 1 ? `<div class="pf"><ha-icon icon="mdi:flash-outline"></ha-icon>${this._fmtW(r.power)}</div>` : ""}</div>
          ${r.temp ? this._sparkline(r.temp, idx) : ""}
        </div>
        ${hum}
        ${hum && heat ? `<div class="dv"></div>` : ""}
        ${heat}
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
    const dcl = st.attributes.device_class;
    const flag = domain === "binary_sensor" && st.state === "on"
      ? (["smoke", "moisture", "gas", "carbon_monoxide"].includes(dcl) ? "alert" : ["window", "door", "opening", "garage_door"].includes(dcl) ? "open" : "") : "";
    return `
      <div class="tile ${active ? "on" : ""} ${flag} ${dis ? "dis" : ""} ${domain === "climate" ? "wide" : ""}" role="button" tabindex="0" data-action="${act}" data-entity="${esc(id)}">
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
    if (withClim) chips.push(`<span class="pill ${heating ? "heat" : ""}"><ha-icon icon="mdi:radiator"></ha-icon>${heating ? `Heizung in ${heating} von ${withClim} ${withClim === 1 ? "Raum" : "Räumen"} an` : "Heizung überall aus"}</span>`);
    if (power != null && power >= 1) chips.push(`<span class="pill"><ha-icon icon="mdi:flash-outline"></ha-icon>${this._fmtW(power)}</span>`);
    return chips.join("");
  }

  _topBar(rooms) {
    const h = this._hass;
    const chips = [];
    const wid = this._config.weather || Object.keys(h.states).find((id) => id.startsWith("weather."));
    const w = wid && h.states[wid];
    if (w && w.state !== "unavailable") {
      const temp = w.attributes.temperature;
      chips.push(`<span class="pill"><ha-icon icon="${WEATHER_ICONS[w.state] || "mdi:weather-cloudy"}"></ha-icon>${esc(this._fmt(wid))}${temp != null ? `, ${Math.round(temp)} °C` : ""}</span>`);
    }
    const oid = this._config.outdoor;
    if (oid && h.states[oid]) chips.push(`<span class="pill"><ha-icon icon="mdi:thermometer"></ha-icon>Draußen ${esc(this._fmt(oid))}</span>`);
    const sid = this._config.season || Object.keys(h.states).find((id) => /^(sensor|select)\./.test(id) && /(modus|mode|season|jahreszeit)/.test(id)
      && ["winter", "sommer", "summer"].includes(norm(h.states[id].state)));
    const se = sid && h.states[sid];
    if (se && !["unavailable", "unknown"].includes(se.state)) {
      const winter = norm(se.state) === "winter";
      chips.push(`<span class="pill"><ha-icon icon="${winter ? "mdi:snowflake" : "mdi:white-balance-sunny"}"></ha-icon>${esc(winter ? "Winter-Modus" : /sommer|summer/.test(norm(se.state)) ? "Sommer-Modus" : se.state)}</span>`);
    }
    chips.push(this._summary(rooms));
    return `<div class="summary">${chips.join("")}</div>${this._config.hero === false ? "" : this._hero(rooms)}`;
  }

  _hero(rooms) {
    const r = rooms.find((x) => x.score > 0);
    if (!r) return "";
    const h = this._hass;
    const winOpen = r.win && h.states[r.win].state === "on";
    const hv = this._num(r.hum);
    const vent = r.vent && h.states[r.vent];
    const ventTxt = vent && !["unknown", "unavailable"].includes(vent.state) ? this._fmt(r.vent) : "";
    let head; let sub;
    if (winOpen) { head = "Fenster offen"; sub = `seit ${this._since(r.win)}${hv != null ? `, Feuchte ${Math.round(hv)} %` : ""}`; }
    else if (hv != null && hv >= 70) { head = "zu feucht"; sub = ventTxt || `Feuchte ${Math.round(hv)} %`; }
    else { head = "Lüften empfohlen"; sub = ventTxt || (hv != null ? `Feuchte ${Math.round(hv)} %` : ""); }
    return `
      <div class="hero ${r.level || "warn"}" role="button" tabindex="0" data-action="open" data-room="${esc(r.id)}">
        <div class="hx"><div class="hl">Dringendster Raum</div><div class="ht">${esc(r.name)}: ${head}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ""}</div>
        <ha-icon icon="${winOpen ? "mdi:window-open-variant" : "mdi:weather-windy"}"></ha-icon>
      </div>`;
  }

  async _loadSpark(ids) {
    if (!ids.length || typeof this._hass.callWS !== "function") return;
    const key = ids.join(",");
    const c = this._spark;
    if (c && (c.loading || (c.key === key && Date.now() - c.t < 600000))) return;
    const rec = { key, t: Date.now(), loading: true, series: {} };
    this._spark = rec;
    const end = Date.now();
    const start = end - 86400000;
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      ids.forEach((id) => { rec.series[id] = this._series(res[id], start, end, 48); });
    } catch (e) { /* Verlauf ist optional */ }
    rec.loading = false;
    rec.t = Date.now();
    this._sig = "";
    this._render();
  }

  _sparkline(id, uid) {
    const v = this._spark && this._spark.series[id];
    if (!v || v.length < 2) return `<div class="spark"></div>`;
    const mn = Math.min(...v), mx = Math.max(...v);
    const span = (mx - mn) || 1;
    const W = 140, H = 46;
    const pts = v.map((y, i) => [(i * W) / (v.length - 1), 6 + (1 - (y - mn) / span) * (H - 12)]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Temperaturverlauf 24 Stunden">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${W},${H} L0,${H} Z" fill="url(#g${uid})"/>
      <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
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
    const doms = Array.isArray(cfg) ? cfg : ["light"];
    return r.ids.filter((id) => this._popupVisible(id) && doms.includes(id.split(".")[0]) && this._hass.states[id].state === "on"
      && !KEEP_ON_RE.test(`${id} ${this._name(id)}`));
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

  _popupVisible(id) {
    const st = this._hass.states[id];
    if (!st) return false;
    if (HIDE_RE.test(id) || HIDE_NAME_RE.test(st.attributes.friendly_name || "")) return false;
    if (st.state === "unavailable" && this._config.show_unavailable !== true) return false;
    if (id.startsWith("media_player.") && this._config.media !== "always" && !["playing", "paused", "buffering", "on"].includes(st.state)) return false;
    const extra = this._config.hide;
    return !(Array.isArray(extra) && extra.some((x) => id.includes(String(x))));
  }

  _live(r) {
    const h = this._hass;
    const items = [];
    const t = this._num(r.temp);
    if (t != null) items.push(`<div class="kpi"><span class="kv">${t.toFixed(1).replace(".", ",")} °C</span><span class="kl">Temperatur</span></div>`);
    const hv = this._num(r.hum);
    if (hv != null) items.push(`<div class="kpi"><span class="kv ${this._humClass(hv)}">${Math.round(hv)} %</span><span class="kl">Luftfeuchte</span></div>`);
    const c = r.clim && h.states[r.clim];
    if (c) {
      const on = c.state !== "off" && c.state !== "unavailable";
      const tg = c.attributes.temperature;
      items.push(`<div class="kpi"><span class="kv">${on && tg != null ? `${String(tg).replace(".", ",")} °C` : "Aus"}</span><span class="kl">Heizung</span></div>`);
    }
    return items.length ? `<div class="kpis live">${items.join("")}</div>` : "";
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
      const all = r.ids.filter((id) => this._popupVisible(id) && c.domains.includes(id.split(".")[0]));
      const list = c.key === "binary" ? ESSENTIAL_BINARY : ESSENTIAL_SENSOR;
      const items = all.filter((id) => this._isEssential(id)).sort((x, y) => this._byUse(x, y, list));
      if (this._config.more_sensors === true) all.filter((id) => !this._isEssential(id)).forEach((id) => more.push(id));
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
          ${this._live(r)}
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
    this._loadSpark(rooms.map((r) => r.temp).filter(Boolean));
    const html = `
      <style>${RUC_STYLE}</style>
      <ha-card>
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
        ${this._config.summary === false ? "" : this._topBar(rooms)}
        <div class="grid" style="--cols:${Number(this._config.columns) || 1}">
          ${rooms.length ? rooms.map((r, i) => this._roomCard(r, i)).join("") : `<p class="empty">Keine Räume gefunden. Lege in Home Assistant Bereiche an und ordne Geräte zu.</p>`}
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

  .summary { display: flex; flex-wrap: nowrap; gap: 8px; margin: 0 2px 14px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .summary::-webkit-scrollbar { display: none; }
  .pill { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; padding: 6px 12px 6px 9px; border-radius: 999px; white-space: nowrap;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); color: var(--primary-text-color); --mdc-icon-size: 18px; }
  .pill.ok { background: color-mix(in srgb, var(--success-color, #43a047) 20%, transparent); color: var(--success-color, #66bb6a); }
  .pill.bad { background: color-mix(in srgb, var(--error-color, #db4437) 22%, transparent); color: var(--error-color, #ef5350); }
  .pill.heat { background: color-mix(in srgb, var(--state-climate-heat-color, #ff8100) 20%, transparent); color: var(--state-climate-heat-color, #ff9800); }

  .hero { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; margin: 0 0 14px; border-radius: 20px; cursor: pointer; outline: none;
    border: 1px solid color-mix(in srgb, var(--warning-color, #f4b400) 40%, transparent); background: color-mix(in srgb, var(--warning-color, #f4b400) 14%, transparent);
    color: var(--warning-color, #f4b400); --mdc-icon-size: 30px; transition: transform .12s ease; }
  .hero.bad { border-color: color-mix(in srgb, var(--error-color, #db4437) 45%, transparent); background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #ef5350); }
  .hero:active { transform: scale(.985); }
  .hero:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .hx { min-width: 0; }
  .hl { font-size: 13px; opacity: .85; }
  .ht { font-size: 21px; font-weight: 500; letter-spacing: -.01em; margin: 2px 0; }
  .hs { font-size: 14px; opacity: .9; }

  .room { position: relative; text-align: left; cursor: pointer; outline: none; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 18px;
    border-radius: 22px; border: 1px solid var(--divider-color); background: var(--ha-card-background, var(--card-background-color)); transition: transform .12s ease, border-color .2s ease; }
  .room:active { transform: scale(.99); }
  .room:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .room.bad { border-color: color-mix(in srgb, var(--error-color, #db4437) 55%, var(--divider-color)); }
  .room.warn { border-color: color-mix(in srgb, var(--warning-color, #f4b400) 50%, var(--divider-color)); }
  .rh { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .ri { flex: none; color: var(--secondary-text-color); --mdc-icon-size: 28px; }
  .rn { flex: 1; min-width: 0; font-size: 21px; font-weight: 500; letter-spacing: -.01em; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wpill { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 12px 6px 9px; border-radius: 999px; --mdc-icon-size: 17px; }
  .wpill.ok { background: color-mix(in srgb, var(--success-color, #43a047) 20%, transparent); color: var(--success-color, #66bb6a); }
  .wpill.bad { background: color-mix(in srgb, var(--error-color, #db4437) 22%, transparent); color: var(--error-color, #ef5350); }

  .lb { font-size: 14px; color: var(--secondary-text-color); }
  .tr { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
  .tc { min-width: 0; }
  .tv { font-size: 36px; line-height: 1.15; font-weight: 500; letter-spacing: -.02em; color: var(--primary-text-color); }
  .tv small { font-size: 22px; font-weight: 400; letter-spacing: 0; }
  .pf { display: inline-flex; align-items: center; gap: 3px; margin-top: 2px; font-size: 12px; color: var(--secondary-text-color); --mdc-icon-size: 14px; }
  .spark { flex: none; display: block; width: 46%; max-width: 190px; height: 50px; color: var(--state-climate-heat-color, #ff9800); }

  .lr { display: flex; align-items: baseline; justify-content: space-between; }
  .hvv { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }
  .hb.ok .hvv { color: var(--success-color, #66bb6a); }
  .hb.warn .hvv { color: var(--warning-color, #f4b400); }
  .hb.bad .hvv { color: var(--error-color, #ef5350); }
  .seg { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin-top: 8px; }
  .seg i { display: block; height: 100%; }
  .seg i:nth-child(1) { flex: 33.3; background: var(--warning-color, #f4b400); }
  .seg i:nth-child(2) { flex: 33.3; background: var(--success-color, #43a047); }
  .seg i:nth-child(3) { flex: 16.7; background: var(--warning-color, #f4b400); }
  .seg i:nth-child(4) { flex: 16.7; background: var(--error-color, #db4437); }
  .mk { position: relative; height: 10px; margin-top: 3px; }
  .mk i { position: absolute; top: 0; width: 3px; height: 10px; border-radius: 2px; background: var(--primary-text-color); transform: translateX(-50%); }
  .dv { height: 1px; background: var(--divider-color); margin: -2px 0; }

  .hr { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .hz { font-size: 21px; font-weight: 500; letter-spacing: -.01em; color: var(--primary-text-color); }
  .hz.off { color: var(--secondary-text-color); }
  .hbtns { display: flex; gap: 8px; }
  .ob { min-width: 46px; height: 46px; padding: 0 16px; border-radius: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); --mdc-icon-size: 22px; transition: transform .1s ease, background .15s ease; }
  .ob:active { transform: scale(.95); background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }

  .vent { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; border-radius: 14px; font-size: 15px; line-height: 1.35; --mdc-icon-size: 20px;
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); color: var(--secondary-text-color); }
  .vent.warn { background: color-mix(in srgb, var(--warning-color, #f4b400) 16%, transparent); color: var(--warning-color, #f4b400); }
  .vent.bad { background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent); color: var(--error-color, #ef5350); }
  .vt { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ann { flex: none; width: 32px; height: 32px; padding: 0; border: none; border-radius: 50%; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, currentColor 16%, transparent); color: inherit; --mdc-icon-size: 18px; }
  .tile.open .dic { background: color-mix(in srgb, var(--warning-color, #f4b400) 30%, transparent); color: var(--warning-color, #f4b400); }
  .tile.alert { background: color-mix(in srgb, var(--error-color, #db4437) 22%, var(--secondary-background-color)); }
  .tile.alert .dic { background: var(--error-color, #db4437); color: #fff; }

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
  .kv.ok { color: var(--success-color, #66bb6a); }
  .kv.warn { color: var(--warning-color, #f4b400); }
  .kv.bad { color: var(--error-color, #ef5350); }
  .kpis.live { margin: 14px 0 0; }
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
