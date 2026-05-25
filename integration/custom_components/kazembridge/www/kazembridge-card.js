/**
 * kazembridge-card — Lovelace custom card for MHI WF-RAC air conditioners.
 *
 * Served automatically by the KazeMBridge integration at /kazembridge_static/kazembridge-card.js.
 * No manual installation needed — the integration registers it via add_extra_js_url.
 *
 * Card config:
 *   type: custom:kazembridge-card
 *   entity: climate.mhi_ac
 *   indoor_sensor: sensor.mhi_ac_indoor_temperature   # optional
 *   outdoor_sensor: sensor.mhi_ac_outdoor_temperature # optional
 */

const MODES = {
  off:      { label: 'Off',  icon: null },   // power btn uses inline SVG, not ⏻
  auto:     { label: 'Auto', icon: '♾' },
  cool:     { label: 'Cool', icon: '❄' },
  heat:     { label: 'Heat', icon: '🔥' },
  fan_only: { label: 'Fan',  icon: '🌀' },
  dry:      { label: 'Dry',  icon: '💧' },
};

const MODE_COLORS = {
  off:      '#555',
  auto:     '#7b68ee',
  cool:     '#4fc3f7',
  heat:     '#ff7043',
  fan_only: '#80cbc4',
  dry:      '#fff176',
};

// Inline SVG power icon — replaces ⏻ which has poor mobile font support
const POWER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A7 7 0 0 1 5 12c0-2.28 1.09-4.3 2.79-5.59L6.37 5A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z"
    fill="currentColor"/>
</svg>`;

// Vertical vane: degrees from horizontal. 1=shallow, 4=steep down.
const V_ANGLES = [12, 32, 55, 75];

// Horizontal positions mapped to codec wind_lr values.
// louver angles: 0=straight ahead, negative=left, positive=right.
const H_POSITIONS = [
  { value: 'normal',       label: 'Normal',      desc: 'Both forward',                      louver: [0,    0   ] },
  { value: 'both_left',    label: 'Both Left',   desc: 'Both sides left',                   louver: [-45, -45 ] },
  { value: 'left_center',  label: 'Left + Mid',  desc: 'Left stays left, right goes center',louver: [-45,  0  ] },
  { value: 'both_center',  label: 'Both Center', desc: 'Both sides center',                 louver: [0,    0  ] },
  { value: 'center_right', label: 'Mid + Right', desc: 'Left goes center, right goes right',louver: [0,   45  ] },
  { value: 'both_right',   label: 'Both Right',  desc: 'Both sides right',                  louver: [45,  45  ] },
  { value: 'wide',         label: 'Wide',        desc: 'Left aims left, right aims right',  louver: [-60,  60 ] },
  { value: 'swing',        label: 'Swing',       desc: 'Auto swing',                        louver: null },
];

// Vertical positions (codec swing_mode values)
const V_POSITIONS = [
  { value: 'swing', label: 'Swing', angle: null },
  { value: '1',     label: 'High',  angle: V_ANGLES[0] },
  { value: '2',     label: '',      angle: V_ANGLES[1] },
  { value: '3',     label: '',      angle: V_ANGLES[2] },
  { value: '4',     label: 'Low',   angle: V_ANGLES[3] },
];

class KazemBridgeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    // Optimistic state: cleared when coordinator confirms all queued values.
    this._pending = null;   // { changes: {field: value, ...}, until: timestamp }
    this._queued = {};      // accumulated changes within the debounce window
    this._debounceTimer = null;
    this._pollInterval = null;
    this._entrustDebounce = null;
    this._firstHassSet = true;
  }

  connectedCallback() {
    this._triggerPoll();
    this._pollInterval = setInterval(() => this._triggerPoll(), 8000);
  }

  disconnectedCallback() {
    clearInterval(this._pollInterval);
  }

  _triggerPoll() {
    if (this._hass && this._config) {
      this._hass.callWS({ type: 'homeassistant/update_entity', entity_id: this._config.entity })
        .catch(() => {});
    }
  }

  setConfig(config) {
    if (!config.entity) throw new Error('kazembridge-card: entity is required');
    this._config = {
      entity: config.entity,
      indoor_sensor: config.indoor_sensor || null,
      outdoor_sensor: config.outdoor_sensor || null,
    };
    this._render();
    // poll immediately once hass is already available
    if (this._hass) {
      this._triggerPoll();
    }
  }

  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;

    if (this._pending) {
      const s = hass.states[this._config?.entity];
      if (s) {
        const allConfirmed = Object.entries(this._pending.changes).every(([f, v]) => {
          const actual = f === 'hvac_mode' ? s.state : s.attributes[f];
          return actual == v;
        });
        if (allConfirmed || Date.now() > this._pending.until) {
          this._pending = null;
        }
      }
    }

    // fire a poll as soon as both hass and config are first available
    if (wasNull && this._config) {
      this._triggerPoll();
    }

    this._render();
  }

  getCardSize() { return 6; }

  // ─── State helpers ────────────────────────────────────────────────────────

  _state() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _attr(key, fallback = null) {
    const s = this._state();
    if (this._pending?.changes[key] !== undefined && Date.now() < this._pending.until) {
      return this._pending.changes[key];
    }
    return s ? (s.attributes[key] ?? fallback) : fallback;
  }

  _mode() {
    const s = this._state();
    if (this._pending?.changes['hvac_mode'] !== undefined && Date.now() < this._pending.until) {
      return this._pending.changes['hvac_mode'];
    }
    return s ? s.state : 'off';
  }

  _isOn() { return this._mode() !== 'off'; }

  _isPending() {
    return this._pending && Date.now() < this._pending.until;
  }

  _sensorValue(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    return s ? parseFloat(s.state) : null;
  }

  // ─── Action queue + debounce ──────────────────────────────────────────────

  _queue(field, value) {
    this._queued[field] = value;
    if (!this._pending) this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes[field] = value;
    this._pending.until = Date.now() + 30000;
    this._render();
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), 600);
  }

  _flush() {
    const changes = { ...this._queued };
    this._queued = {};
    this._hass.callService('kazembridge', 'set_state', {
      entity_id: this._config.entity,
      ...changes,
    });
  }

  // ─── Action methods ───────────────────────────────────────────────────────

  _setMode(mode) {
    this._queue('hvac_mode', mode);
  }

  _adjustTemp(delta) {
    const cur = this._attr('temperature', 22);
    const next = Math.max(16, Math.min(31, Math.round((cur + delta) * 2) / 2));
    this._queue('temperature', next);
  }

  _setFan(mode) {
    this._queue('fan_mode', mode);
  }

  _setSwing(mode) {
    this._queue('swing_mode', mode);
  }

  _setHSwing(value) {
    this._queue('swing_horizontal_mode', value);
  }

  _toggleEntrust() {
    const cur = this._attr('preset_mode', 'none') === '3d_auto';
    clearTimeout(this._entrustDebounce);
    this._entrustDebounce = setTimeout(() => {
      this._hass.callService('climate', 'set_preset_mode', {
        entity_id: this._config.entity,
        preset_mode: cur ? 'none' : '3d_auto',
      });
    }, 600);
    // Optimistic: track entrust separately since it's not in the blob
    if (!this._pending) this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes['preset_mode'] = cur ? 'none' : '3d_auto';
    this._pending.until = Date.now() + 30000;
    this._render();
  }

  // ─── SVG helpers ──────────────────────────────────────────────────────────

  /**
   * Front view of the AC unit — shows horizontal airflow direction.
   * Front view arrows point downward (away from grille), arrowY at bottom edge of grille.
   */
  _frontViewSvg(hSwingValue) {
    const W = 200, BH = 40, BY = 14;
    const pos = H_POSITIONS.find(p => p.value === hSwingValue) || H_POSITIONS[0];
    const isSwing = pos.louver === null;

    // arrows point downward from the grille bottom edge.
    // deg=0 → straight down, negative=left, positive=right.
    const arrow = (cx, cy, deg, opacity = 1) => {
      const len = 36;
      const r = deg * Math.PI / 180;
      // Downward: ey = cy + len*cos(r), ex = cx + len*sin(r)
      const ex = cx + len * Math.sin(r);
      const ey = cy + len * Math.cos(r);
      const mx = cx + (len - 6) * Math.sin(r);
      const my = cy + (len - 6) * Math.cos(r);
      // Arrowhead barbs: perpendicular to forward direction, pointing back toward shaft
      const lx = mx - 7 * Math.cos(r + 0.4), ly = my + 7 * Math.sin(r + 0.4);
      const rx = mx - 7 * Math.cos(r - 0.4), ry = my + 7 * Math.sin(r - 0.4);
      return `
        <g opacity="${opacity}">
          <line x1="${cx}" y1="${cy}" x2="${(ex - 5 * Math.sin(r)).toFixed(1)}" y2="${(ey - 5 * Math.cos(r)).toFixed(1)}"
            stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3"/>
          <path d="M${lx.toFixed(1)},${ly.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)}"
            fill="#4fc3f7"/>
        </g>`;
    };

    const cx1 = W / 2 - 28, cx2 = W / 2 + 28;
    // arrowY at bottom edge of grille (not 6px below)
    const arrowY = BY + BH;

    let arrowContent;
    if (isSwing) {
      // swing animation goes downward — arrows sweep left↔right below the grille
      const swingDegs = [-60, -30, 0, 30, 60, 30, 0, -30, -60];
      const kts = swingDegs.map((_, i) => (i / (swingDegs.length - 1)).toFixed(3)).join(';');
      arrowContent = `
        <g id="arr1" opacity="0.85">
          <line x1="${cx1}" y1="${arrowY}" x2="${cx1}" y2="${arrowY + 30}"
            stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3">
            <animateTransform attributeName="transform" type="rotate"
              values="${swingDegs.map(d => `${d} ${cx1} ${arrowY}`).join(';')}"
              keyTimes="${kts}" dur="2.5s" repeatCount="indefinite" calcMode="spline"
              keySplines="${swingDegs.slice(0,-1).map(()=>'0.4 0 0.6 1').join(';')}"/>
          </line>
        </g>
        <g id="arr2" opacity="0.85">
          <line x1="${cx2}" y1="${arrowY}" x2="${cx2}" y2="${arrowY + 30}"
            stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3">
            <animateTransform attributeName="transform" type="rotate"
              values="${swingDegs.map(d => `${-d} ${cx2} ${arrowY}`).join(';')}"
              keyTimes="${kts}" dur="2.5s" repeatCount="indefinite" calcMode="spline"
              keySplines="${swingDegs.slice(0,-1).map(()=>'0.4 0 0.6 1').join(';')}"/>
          </line>
        </g>`;
    } else {
      arrowContent = arrow(cx1, arrowY, pos.louver[0], 0.85) + arrow(cx2, arrowY, pos.louver[1], 0.85);
    }

    return `<svg viewBox="0 0 ${W} 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      <!-- AC front face -->
      <rect x="0" y="${BY}" width="${W}" height="${BH}" rx="7" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      <line x1="16" y1="${BY + 10}" x2="${W - 16}" y2="${BY + 10}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="16" y1="${BY + 20}" x2="${W - 16}" y2="${BY + 20}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="16" y1="${BY + 30}" x2="${W - 16}" y2="${BY + 30}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <circle cx="${W - 14}" cy="${BY + 9}" r="4" fill="${this._isOn() ? '#4caf50' : '#444'}" opacity="0.9"/>
      <!-- Airflow arrows -->
      ${arrowContent}
    </svg>`;
  }

  /**
   * Side view of the AC unit — shows vertical vane angle.
   * Side view — body on right, vane swings left-downward, vane swings left-downward.
   */
  _sideViewSvg(vSwingValue) {
    const isSwing = vSwingValue === 'swing';
    // body on right side
    const BW = 60, BH = 30, BX = 130, BY = 18;
    // VX = BX (front face = left edge of body), vane goes left+down
    const VX = BX, VY = BY + BH;
    // shorter vane
    const VLEN = 34;

    const activeAngle = isSwing
      ? V_ANGLES[0]
      : (V_ANGLES[parseInt(vSwingValue, 10) - 1] ?? V_ANGLES[0]);

    // vane endpoint flipped — goes left+down: x decreases, y increases
    const ep = deg => {
      const r = deg * Math.PI / 180;
      return [VX - VLEN * Math.cos(r), VY + VLEN * Math.sin(r)];
    };

    const [vx2, vy2] = ep(activeAngle);

    const swingValues = [...V_ANGLES, ...V_ANGLES.slice(0, -1).reverse()];
    const rotatePath = swingValues.map(a => `${a} ${VX},${VY}`).join(';');
    const keyTimes = swingValues.map((_, i) => (i / (swingValues.length - 1)).toFixed(3)).join(';');

    // arrow SVG also goes left-downward
    const arrowSvg = (deg, opacity = 1) => {
      const r = deg * Math.PI / 180;
      const x1 = VX - 12 * Math.cos(r), y1 = VY + 12 * Math.sin(r);
      const x2 = VX - (VLEN + 18) * Math.cos(r), y2 = VY + (VLEN + 18) * Math.sin(r);
      const tip = [x2, y2];
      const left = [x2 + 6 * Math.cos(r - 0.4), y2 - 6 * Math.sin(r - 0.4)];
      const right = [x2 + 6 * Math.cos(r + 0.4), y2 - 6 * Math.sin(r + 0.4)];
      return `
        <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x2 + 5 * Math.cos(r)).toFixed(1)}" y2="${(y2 - 5 * Math.sin(r)).toFixed(1)}"
          stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3" opacity="${opacity}"/>
        <path d="M${left[0].toFixed(1)},${left[1].toFixed(1)} L${tip[0].toFixed(1)},${tip[1].toFixed(1)} L${right[0].toFixed(1)},${right[1].toFixed(1)}"
          fill="#4fc3f7" opacity="${opacity}"/>`;
    };

    const vaneContent = isSwing
      ? `<g>
          <line x1="${VX}" y1="${VY}" x2="${vx2.toFixed(1)}" y2="${vy2.toFixed(1)}"
            stroke="#aaa" stroke-width="5" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate"
              values="${rotatePath}" keyTimes="${keyTimes}"
              dur="3s" repeatCount="indefinite" calcMode="spline"
              keySplines="${swingValues.slice(0, -1).map(() => '0.4 0 0.6 1').join(';')}"/>
          </line>
        </g>`
      : `<line x1="${VX}" y1="${VY}" x2="${vx2.toFixed(1)}" y2="${vy2.toFixed(1)}"
          stroke="#aaa" stroke-width="5" stroke-linecap="round"/>
        ${arrowSvg(activeAngle, 0.75)}`;

    return `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      <!-- AC side profile body (right side) -->
      <rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="5" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      <!-- Front face indicator line (left edge of body) -->
      <line x1="${BX}" y1="${BY}" x2="${BX}" y2="${BY + BH}" stroke="#4a4a5a" stroke-width="2"/>
      <!-- LED on back-right of body -->
      <circle cx="${BX + BW - 12}" cy="${BY + 9}" r="4" fill="${this._isOn() ? '#4caf50' : '#444'}" opacity="0.9"/>
      <!-- Vane -->
      ${vaneContent}
    </svg>`;
  }

  // ─── Buttons ──────────────────────────────────────────────────────────────

  _modeButtons(currentMode) {
    return Object.entries(MODES).map(([mode, { label, icon }]) => {
      // power button (off mode) uses inline SVG; other modes use emoji
      const iconHtml = mode === 'off'
        ? POWER_SVG
        : `<span class="mode-icon">${icon}</span>`;
      return `
        <button class="mode-btn ${mode === currentMode ? 'active' : ''}" data-mode="${mode}" title="${label}">
          ${iconHtml}
          <span class="mode-label">${label}</span>
        </button>`;
    }).join('');
  }

  _fanButtons(currentFan) {
    return ['auto', '1', '2', '3', '4'].map(f => `
      <button class="fan-btn ${f === currentFan ? 'active' : ''}" data-fan="${f}"
        title="${f === 'auto' ? 'Auto' : `Speed ${f}`}">
        ${f === 'auto' ? 'A' : f}
      </button>`).join('');
  }

  _verticalVaneButtons(current) {
    return V_POSITIONS.map(p => {
      const isSwing = p.value === 'swing';
      const active = p.value === current;
      const icon = isSwing
        // ↕ replaced with inline SVG showing two opposing vertical arrows
        ? `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 10l5-5 5 5H7zm10 4l-5 5-5-5h10z" fill="currentColor"/>
          </svg>`
        : (() => {
            const r = p.angle * Math.PI / 180;
            // scaleX(-1) to mirror arrow left-downward after side view flip
            const x2 = 4 + 16 * Math.cos(r), y2 = 4 + 16 * Math.sin(r);
            const tx = x2, ty = y2;
            const lx = x2 - 6 * Math.cos(r - 0.4), ly = y2 - 6 * Math.sin(r - 0.4);
            const rx2 = x2 - 6 * Math.cos(r + 0.4), ry = y2 - 6 * Math.sin(r + 0.4);
            return `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"
                style="transform:scaleX(-1)">
              <line x1="4" y1="4" x2="${(x2 - 4 * Math.cos(r)).toFixed(1)}" y2="${(y2 - 4 * Math.sin(r)).toFixed(1)}"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M${lx.toFixed(1)},${ly.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)} L${rx2.toFixed(1)},${ry.toFixed(1)}"
                fill="currentColor"/>
            </svg>`;
          })();
      return `<button class="vane-btn ${active ? 'active' : ''}" data-vswing="${p.value}"
          title="${p.label || `Position ${p.value}`}">
          ${icon}
        </button>`;
    }).join('');
  }

  _horizontalVaneButtons(currentH) {
    return H_POSITIONS.map(p => `
      <button class="vane-btn h-vane-btn ${p.value === currentH ? 'active' : ''}"
        data-hswing="${p.value}" title="${p.desc}">
        ${this._hLouverSvg(p.louver, p.value === currentH)}
      </button>`).join('');
  }

  _hLouverSvg(angles, active = false) {
    const color = active ? '#4fc3f7' : '#666';
    const W = 36, H = 36, CX = W / 2, CY = H / 2;
    const LEN = 10;

    if (!angles) {
      // ↔ replaced with inline SVG showing two opposing horizontal arrows
      return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 18l5-4v3h5v2H9v3L4 18zm28 0l-5 4v-3h-5v-2h5v-3l5 4z" fill="${color}"/>
      </svg>`;
    }

    // arrowhead at BOTTOM end (by/bx side) so arrow points forward/out of unit
    const louver = (cx, deg) => {
      const r = deg * Math.PI / 180;
      const dx = LEN * Math.sin(r), dy = LEN * Math.cos(r);
      const tx = cx + dx, ty = CY - dy;   // top end
      const bx = cx - dx, by = CY + dy;   // bottom end (forward/out) — arrowhead here
      // Barbs at the bottom end pointing back toward shaft
      const ax  = bx + 5 * Math.sin(r - 0.35), ay  = by - 5 * Math.cos(r - 0.35);
      const bax = bx + 5 * Math.sin(r + 0.35), bay = by - 5 * Math.cos(r + 0.35);
      return `
        <line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"
          stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} L${bax.toFixed(1)},${bay.toFixed(1)}"
          fill="${color}"/>`;
    };

    return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
      ${louver(CX - 9, angles[0])}
      ${louver(CX + 9, angles[1])}
    </svg>`;
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;

    const state = this._state();
    if (!state) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:16px;color:#f44">Entity not found: ${this._config.entity}</ha-card>`;
      return;
    }

    const mode       = this._mode();
    const isOn       = this._isOn();
    const isFanOnly  = mode === 'fan_only';
    const accent     = MODE_COLORS[mode] || '#7b68ee';
    const targetTemp = this._attr('temperature', 22);
    const fanMode    = this._attr('fan_mode', 'auto');
    const swingMode  = this._attr('swing_mode', '1');
    const entrust    = this._attr('preset_mode', 'none') === '3d_auto';
    const indoorT    = this._sensorValue(this._config.indoor_sensor);
    const outdoorT   = this._sensorValue(this._config.outdoor_sensor);
    const pending    = this._isPending();
    const hSwing     = this._attr('swing_horizontal_mode', 'normal');

    // show '—' and disable ± buttons in fan_only mode
    const tempDisplay = isFanOnly ? '—' : (isOn ? targetTemp.toFixed(1) : '—');
    const tempDisabled = isFanOnly || !isOn;

    const css = `
      :host { display: block; }
      ha-card {
        background: #1c1c28; color: #e0e0e0;
        border-radius: 16px; overflow: hidden;
        font-family: 'Segoe UI', system-ui, sans-serif;
        user-select: none;
      }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px 10px; border-bottom: 1px solid #2a2a3a; position: relative;
      }
      .title { font-size: 13px; color: #777; letter-spacing: 0.05em; }
      .header-right { display: flex; align-items: center; gap: 10px; }
      .power-btn {
        background: ${isOn ? accent : '#333'}; border: none; border-radius: 50%;
        width: 36px; height: 36px; cursor: pointer; color: #fff;
        transition: background 0.3s; display: flex; align-items: center; justify-content: center;
      }
      .pending-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: ${accent}; opacity: ${pending ? 1 : 0};
        transition: opacity 0.3s;
        animation: ${pending ? 'pulse 1s infinite' : 'none'};
      }
      @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
      .body { padding: 14px 18px; }
      .section-label {
        font-size: 10px; color: #555; text-transform: uppercase;
        letter-spacing: 0.08em; margin-bottom: 6px;
      }
      /* no flex-wrap; tighter min-width so all 6 buttons fit on mobile */
      .mode-row { display: flex; gap: 5px; margin-bottom: 14px; }
      .mode-btn {
        flex: 1; min-width: 38px;
        background: #2a2a3a; border: 1px solid #333; border-radius: 10px;
        padding: 6px 3px; color: #aaa; cursor: pointer;
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        transition: background 0.2s, border-color 0.2s, color 0.2s; font-family: inherit;
      }
      .mode-btn.active { background: ${accent}22; border-color: ${accent}; color: ${accent}; }
      .mode-icon { font-size: 17px; }
      .mode-label { font-size: 10px; }
      .temp-row {
        display: flex; align-items: center; justify-content: center;
        gap: 18px; margin-bottom: 14px;
      }
      .temp-btn {
        background: #2a2a3a; border: 1px solid #333; border-radius: 50%;
        width: 38px; height: 38px; font-size: 22px; cursor: pointer; color: #ccc;
        display: flex; align-items: center; justify-content: center; font-family: inherit;
        transition: background 0.15s;
      }
      .temp-btn:active { background: #3a3a4a; }
      /* greyed-out when disabled (fan_only mode) */
      .temp-btn:disabled { opacity: 0.3; cursor: default; }
      .temp-value { font-size: 42px; font-weight: 300; color: ${accent}; line-height: 1; text-align: center; }
      .temp-unit { font-size: 13px; color: #555; text-align: center; }
      .vane-panels { display: flex; gap: 10px; margin-bottom: 12px; }
      .vane-panel { flex: 1; display: flex; flex-direction: column; align-items: center; }
      .vane-panel .section-label { margin-bottom: 4px; }
      .vane-row { display: flex; gap: 5px; margin-bottom: 14px; flex-wrap: wrap; }
      .vane-btn {
        flex: 1; min-width: 36px;
        background: #2a2a3a; border: 1px solid #333; border-radius: 8px;
        padding: 6px 2px; cursor: pointer; color: #777;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, border-color 0.2s, color 0.2s;
      }
      .vane-btn.active { background: #4fc3f722; border-color: #4fc3f7; color: #4fc3f7; }
      .h-vane-btn { min-width: 34px; padding: 5px 1px; }
      .fan-row { display: flex; gap: 5px; margin-bottom: 14px; }
      .fan-btn {
        flex: 1; background: #2a2a3a; border: 1px solid #333; border-radius: 8px;
        padding: 7px 0; cursor: pointer; color: #888; font-size: 13px; font-family: inherit;
        transition: background 0.2s, border-color 0.2s, color 0.2s;
      }
      .fan-btn.active { background: #80cbc422; border-color: #80cbc4; color: #80cbc4; }
      .extras-row { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; }
      .entrust-btn {
        background: ${entrust ? '#7b68ee33' : '#2a2a3a'}; border: 1px solid ${entrust ? '#7b68ee' : '#333'};
        border-radius: 8px; padding: 7px 12px; cursor: pointer;
        color: ${entrust ? '#7b68ee' : '#666'}; font-size: 12px; font-family: inherit;
        transition: background 0.2s, border-color 0.2s, color 0.2s;
      }
      .sensor-row {
        display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #2a2a3a;
      }
      .sensor-chip {
        flex: 1; background: #2a2a3a; border-radius: 10px; padding: 8px 10px; text-align: center;
      }
      .s-label { font-size: 10px; color: #555; }
      .s-val { font-size: 20px; font-weight: 300; color: ${isOn ? '#e0e0e0' : '#555'}; }
      .s-unit { font-size: 10px; color: #555; }
    `;

    const html = `
      <style>${css}</style>
      <ha-card>
        <div class="header">
          <div class="title">${state.attributes.friendly_name || this._config.entity}</div>
          <div class="header-right">
            <div class="pending-dot" title="${pending ? 'Updating…' : ''}"></div>
            <!-- power button uses inline SVG icon -->
            <button class="power-btn" id="pwr" title="${isOn ? 'Turn off' : 'Turn on'}">${POWER_SVG}</button>
          </div>
        </div>
        <div class="body">

          <div class="section-label">Mode</div>
          <div class="mode-row">${this._modeButtons(mode)}</div>

          <div class="temp-row">
            <!-- disabled in fan_only mode -->
            <button class="temp-btn" id="tm" ${tempDisabled ? 'disabled' : ''}>−</button>
            <div>
              <div class="temp-value">${tempDisplay}</div>
              <div class="temp-unit">°C target</div>
            </div>
            <button class="temp-btn" id="tp" ${tempDisabled ? 'disabled' : ''}>+</button>
          </div>

          <div class="vane-panels">
            <div class="vane-panel">
              <div class="section-label">Front view</div>
              ${this._frontViewSvg(hSwing)}
            </div>
            <div class="vane-panel">
              <div class="section-label">Side view</div>
              ${this._sideViewSvg(swingMode)}
            </div>
          </div>

          <div class="section-label">Vertical vane</div>
          <div class="vane-row">${this._verticalVaneButtons(swingMode)}</div>

          <div class="section-label">Horizontal vane</div>
          <div class="vane-row">${this._horizontalVaneButtons(hSwing)}</div>

          <div class="section-label">Fan speed</div>
          <div class="fan-row">${this._fanButtons(fanMode)}</div>

          <div class="extras-row">
            <button class="entrust-btn" id="entrust" title="3D Auto — unit picks best airflow">
              ✦ 3D Auto${entrust ? ' ON' : ''}
            </button>
          </div>

          ${(indoorT !== null || outdoorT !== null) ? `
          <div class="sensor-row">
            ${indoorT !== null ? `<div class="sensor-chip">
              <div class="s-label">Indoor</div>
              <div class="s-val">${indoorT.toFixed(1)}</div>
              <div class="s-unit">°C</div>
            </div>` : ''}
            ${outdoorT !== null ? `<div class="sensor-chip">
              <div class="s-label">Outdoor</div>
              <div class="s-val">${outdoorT.toFixed(1)}</div>
              <div class="s-unit">°C</div>
            </div>` : ''}
          </div>` : ''}

        </div>
      </ha-card>`;

    this.shadowRoot.innerHTML = html;
    this._attachListeners();
  }

  _attachListeners() {
    const root = this.shadowRoot;
    root.getElementById('pwr')?.addEventListener('click', () => this._setMode(this._isOn() ? 'off' : (this._attr('hvac_mode_last') || 'cool')));
    root.getElementById('tm')?.addEventListener('click', () => this._adjustTemp(-0.5));
    root.getElementById('tp')?.addEventListener('click', () => this._adjustTemp(0.5));
    root.getElementById('entrust')?.addEventListener('click', () => this._toggleEntrust());
    root.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => this._setMode(b.dataset.mode)));
    root.querySelectorAll('[data-vswing]').forEach(b => b.addEventListener('click', () => this._setSwing(b.dataset.vswing)));
    root.querySelectorAll('[data-hswing]').forEach(b => b.addEventListener('click', () => this._setHSwing(b.dataset.hswing)));
    root.querySelectorAll('.fan-btn').forEach(b => b.addEventListener('click', () => this._setFan(b.dataset.fan)));
  }
}

customElements.define('kazembridge-card', KazemBridgeCard);
