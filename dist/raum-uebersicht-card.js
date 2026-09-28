/* Raumübersicht Card für Home Assistant
 * Zeigt alle Räume (Areas) als Karten und öffnet pro Raum ein Popup
 * mit allen Geräten, nach Kategorien sortiert. Keine Entity-IDs nötig.
 */
const RUC_VERSION = "1.0.0";

const CATEGORIES = [
  { key: "climate", title: "Heizung und Klima", icon: "mdi:radiator", domains: ["climate", "water_heater"] },
  { key: "light", title: "Licht", icon: "mdi:lightbulb-outline", domains: ["light"] },
  { key: "switch", title: "Steckdosen und Schalter", icon: "mdi:power-socket-eu", domains: ["switch", "input_boolean", "fan", "humidifier"] },
  { key: "cover", title: "Rollos und Fenster", icon: "mdi:blinds", domains: ["cover"] },
  { key: "media", title: "Medien", icon: "mdi:speaker", domains: ["media_player"] },
  { key: "sensor", title: "Sensoren", icon: "mdi:gauge", domains: ["sensor"] },
  { key: "binary", title: "Kontakte und Bewegung", icon: "mdi:door", domains: ["binary_sensor"] },
];
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
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
  }

  static getStubConfig() { return { type: "custom:raum-uebersicht-card" }; }

  setConfig(config) {
    this._config = { columns: 2, ...config };
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
    return list.map(({ cfg, area }) => this._buildRoom(cfg, area));
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
    const clim = has(cfg.climate) ? cfg.climate : this._pick(ids, "climate");
    const vent = has(cfg.ventilation) ? cfg.ventilation : ids.find((id) => id.startsWith("sensor.") && id.endsWith("_empfehlung")) || null;
    return {
      id: area.area_id, name: cfg.name || area.name, icon: cfg.icon || area.icon || "mdi:door",
      ids, temp, hum, win, clim, vent,
    };
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
    const target = clim && clim.attributes.temperature;
    const heating = clim && clim.state !== "off" && clim.state !== "unavailable";
    const vent = r.vent && this._hass.states[r.vent];
    const tempTxt = t == null ? "–" : `${t.toFixed(1).replace(".", ",")} °C`;
    return `
      <button class="room ${winOpen ? "open" : ""}" data-action="open" data-room="${esc(r.id)}">
        <div class="top">
          <span class="ic"><ha-icon icon="${esc(r.icon)}"></ha-icon></span>
          <span class="name">${esc(r.name)}</span>
          ${r.win ? `<span class="pill ${winOpen ? "bad" : winUnknown ? "" : "ok"}"><ha-icon icon="${winOpen ? "mdi:window-open-variant" : "mdi:window-closed-variant"}"></ha-icon>${winOpen ? this._since(r.win) : winUnknown ? "?" : "zu"}</span>` : ""}
        </div>
        <div class="temp">${tempTxt}</div>
        <div class="meta">
          ${hv != null ? `<span class="pill ${this._humClass(hv)}"><ha-icon icon="mdi:water-percent"></ha-icon>${Math.round(hv)} %</span>` : ""}
          ${clim ? `<span class="pill ${heating ? "heat" : ""}"><ha-icon icon="mdi:radiator"></ha-icon>${heating ? (target != null ? `${String(target).replace(".", ",")} °C` : esc(clim.state)) : "Aus"}</span>` : ""}
        </div>
        ${vent && !["unknown", "unavailable"].includes(vent.state) ? `<div class="vent"><ha-icon icon="mdi:weather-windy"></ha-icon>${esc(this._fmt(r.vent))}</div>` : ""}
      </button>`;
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

  _popup(r) {
    const groups = CATEGORIES.map((c) => {
      const items = r.ids.filter((id) => c.domains.includes(id.split(".")[0]))
        .sort((a, b) => this._name(a).localeCompare(this._name(b), "de"));
      return { c, items };
    }).filter((g) => g.items.length);
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    return `
      <div class="overlay" data-action="close">
        <div class="sheet" role="dialog" aria-label="${esc(r.name)}">
          <div class="grab"></div>
          <div class="head">
            <span class="hic"><ha-icon icon="${esc(r.icon)}"></ha-icon></span>
            <span class="ht"><span class="hn">${esc(r.name)}</span><span class="hs">${count} Geräte, ${groups.length} Kategorien</span></span>
            <button class="x" data-action="close" aria-label="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          ${groups.length ? groups.map((g) => `
            <div class="cat"><ha-icon icon="${g.c.icon}"></ha-icon>${g.c.title}</div>
            ${g.items.map((id) => this._deviceRow(id)).join("")}`).join("") : `<p class="empty">Diesem Bereich sind noch keine Geräte zugeordnet.</p>`}
        </div>
      </div>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const rooms = this._rooms();
    const open = rooms.find((r) => r.id === this._openRoom);
    const title = this._config.title;
    const html = `
      <style>${RUC_STYLE}</style>
      <ha-card>
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
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
  .room { text-align: left; cursor: pointer; padding: 12px; border-radius: 16px; border: 1px solid var(--divider-color);
    background: var(--ha-card-background, var(--card-background-color)); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .room.open { border-color: var(--error-color); }
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
