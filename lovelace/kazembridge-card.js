/**
 * kazembridge-card — Lovelace custom card for MHI WF-RAC air conditioners.
 *
 * Installation:
 *   1. Copy this file to your HA config/www/ directory.
 *   2. In Lovelace resources, add /local/kazembridge-card.js (type: module).
 *
 * Card config:
 *   type: custom:kazembridge-card
 *   entity: climate.mhi_ac
 *   indoor_sensor: sensor.mhi_ac_indoor_temperature   # optional
 *   outdoor_sensor: sensor.mhi_ac_outdoor_temperature # optional
 */

const MODES = {
  off:      { label: 'Off',  icon: '⏻' },
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

// Vertical vane: degrees from horizontal. 1=shallow, 4=steep down.
const V_ANGLES = [12, 32, 55, 75];

// Horizontal positions mapped to codec wind_lr values.
// User positions: 0=Normal(1) 1=Both Left(2) 2=Left+Center(3) 3=Both Center(4)
//                 4=Center+Right(5) 5=Both Right(6) 6=Wide Spread(7) 7=Converge(?) swing=0
// Codec wind_lr 1-7, swing=0.
const H_POSITIONS = [
  { value: '1', label: 'Normal',       desc: 'Both forward' },
  { value: '2', label: 'Both Left',    desc: 'Both sides left' },
  { value: '3', label: 'Left + Mid',   desc: 'Left stays left, right goes center' },
  { value: '4', label: 'Both Center',  desc: 'Both sides center' },
  { value: '5', label: 'Mid + Right',  desc: 'Left goes center, right goes right' },
  { value: '6', label: 'Both Right',   desc: 'Both sides right' },
  { value: '7', label: 'Wide',         desc: 'Left aims left, right aims right' },
  { value: 'swing', label: 'Swing',    desc: 'Auto swing' },
];

// Vertical positions (codec swing_mode values)
const V_POSITIONS = [
  { value: 'swing', label: 'Swing', angle: null },
  { value: '1',     label: 'High',  angle: V_ANGLES[0] },
  { value: '2',     label: '',      angle: V_ANGLES[1] },
  { value: '3',     label: '',      angle: V_ANGLES[2] },
  { value: '4',     label: 'Low',   angle: V_ANGLES[3] },
];

// How long to show the loading indicator after a service call (ms).
// MHI units take ~5 s to respond; coordinator refresh interval is 30 s.
const PENDING_MS = 7000;

class KazemBridgeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    // Optimistic state: set on user action, cleared when coordinator confirms.
    this._pending = null;  // { field, value, until }
  }

  setConfig(config) {
    if (!config.entity) throw new Error('kazembridge-card: entity is required');
    this._config = {
      entity: config.entity,
      indoor_sensor: config.indoor_sensor || null,
      outdoor_sensor: config.outdoor_sensor || null,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Clear pending state once coordinator has confirmed the change.
    if (this._pending && Date.now() > this._pending.until) {
      this._pending = null;
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
    // Return pending optimistic value if still within the loading window.
    if (this._pending && this._pending.field === key && Date.now() < this._pending.until) {
      return this._pending.value;
    }
    return s ? (s.attributes[key] ?? fallback) : fallback;
  }

  _mode() {
    const s = this._state();
    if (this._pending && this._pending.field === 'hvac_mode' && Date.now() < this._pending.until) {
      return this._pending.value;
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

  // ─── Service calls ────────────────────────────────────────────────────────

  _call(service, data = {}, optimisticField = null, optimisticValue = null) {
    this._hass.callService('climate', service, { entity_id: this._config.entity, ...data });
    if (optimisticField !== null) {
      this._pending = { field: optimisticField, value: optimisticValue, until: Date.now() + PENDING_MS };
      // Trigger re-render immediately for optimistic UI, then again after pending clears.
      this._render();
      setTimeout(() => { this._pending = null; this._render(); }, PENDING_MS);
    }
  }

  _setMode(mode) {
    if (mode === 'off') {
      this._call('turn_off', {}, 'hvac_mode', 'off');
    } else {
      this._call('set_hvac_mode', { hvac_mode: mode }, 'hvac_mode', mode);
    }
  }

  _adjustTemp(delta) {
    const cur = this._attr('temperature', 22);
    const next = Math.max(16, Math.min(31, Math.round((cur + delta) * 2) / 2));
    this._call('set_temperature', { temperature: next }, 'temperature', next);
  }

  _setFan(mode) {
    this._call('set_fan_mode', { fan_mode: mode }, 'fan_mode', mode);
  }

  _setSwing(mode) {
    this._call('set_swing_mode', { swing_mode: mode }, 'swing_mode', mode);
  }

  _setHSwing(value) {
    // Horizontal swing is exposed as a custom attribute; use a script-call workaround
    // via set_swing_mode only if integrated — otherwise fire as custom event or direct HA service.
    // For now, expose as a UI-only label until climate entity supports h-swing natively.
    // This fires the HA service for horizontal swing as custom preset if supported.
    this._hass.callService('climate', 'set_swing_mode', {
      entity_id: this._config.entity,
      swing_mode: mode,   // passed through to coordinator as-is; coordinator ignores if unknown
    });
    this._pending = { field: 'h_swing', value, until: Date.now() + PENDING_MS };
    this._render();
    setTimeout(() => { this._pending = null; this._render(); }, PENDING_MS);
  }

  _toggleEntrust() {
    const cur = this._attr('entrust', false);
    this._hass.callService('climate', 'set_preset_mode', {
      entity_id: this._config.entity,
      preset_mode: cur ? 'none' : '3d_auto',
    });
    this._pending = { field: 'entrust', value: !cur, until: Date.now() + PENDING_MS };
    this._render();
    setTimeout(() => { this._pending = null; this._render(); }, PENDING_MS);
  }

  // ─── SVG helpers ──────────────────────────────────────────────────────────

  /**
   * Side-profile AC unit with vertical vane.
   * swingValue: 'swing' | '1' | '2' | '3' | '4'
   */
  _verticalVaneSvg(swingValue) {
    const isSwing = swingValue === 'swing';
    const W = 180, BH = 36, BY = 18;
    const VX = 18, VY = BY + BH, VLEN = 48;

    const activeAngle = isSwing ? V_ANGLES[0] : (V_ANGLES[parseInt(swingValue, 10) - 1] ?? V_ANGLES[0]);

    // Build vane line endpoint for a given angle
    const ep = deg => {
      const r = deg * Math.PI / 180;
      return [VX + VLEN * Math.cos(r), VY + VLEN * Math.sin(r)];
    };

    const [vx2, vy2] = ep(activeAngle);

    // For swing: animate the vane through all 4 positions + back
    const swingValues = [...V_ANGLES, ...V_ANGLES.slice(0, -1).reverse()];
    const rotatePath = swingValues.map(a => `${a} ${VX},${VY}`).join(';');
    const keyTimes = swingValues.map((_, i) => (i / (swingValues.length - 1)).toFixed(3)).join(';');

    // Airflow arrow (inline path, no marker dependency)
    const arrowSvg = (deg, opacity = 1) => {
      const r = deg * Math.PI / 180;
      const x1 = VX + 12 * Math.cos(r), y1 = VY + 12 * Math.sin(r);
      const x2 = VX + (VLEN + 18) * Math.cos(r), y2 = VY + (VLEN + 18) * Math.sin(r);
      // Arrowhead as a small rotated triangle path
      const tip = [x2, y2];
      const left = [x2 - 7 * Math.cos(r - 0.4), y2 - 7 * Math.sin(r - 0.4)];
      const right = [x2 - 7 * Math.cos(r + 0.4), y2 - 7 * Math.sin(r + 0.4)];
      return `
        <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x2 - 5 * Math.cos(r)).toFixed(1)}" y2="${(y2 - 5 * Math.sin(r)).toFixed(1)}"
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

    return `<svg viewBox="0 0 ${W} 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      <!-- AC body -->
      <rect x="0" y="${BY}" width="${W}" height="${BH}" rx="7" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      <line x1="16" y1="${BY + 9}" x2="${W - 16}" y2="${BY + 9}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="16" y1="${BY + 18}" x2="${W - 16}" y2="${BY + 18}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="16" y1="${BY + 27}" x2="${W - 16}" y2="${BY + 27}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <circle cx="${W - 14}" cy="${BY + 9}" r="4" fill="${this._isOn() ? '#4caf50' : '#444'}" opacity="0.9"/>
      <!-- Vane -->
      ${vaneContent}
    </svg>`;
  }

  /**
   * Top-down view of two horizontal louvers for a given position.
   * Returns an SVG string showing where each louver points.
   *
   * Each louver is drawn as a short bar from center-ish with an angle.
   * Angle 0 = straight ahead, negative = left, positive = right.
   *
   * Positions (codec wind_lr 1-7):
   *   1=Normal(both 0°), 2=Both Left(-45°,-45°), 3=Left+Center(-45°,0°),
   *   4=Both Center(0°,0°), 5=Center+Right(0°,+45°), 6=Both Right(+45°,+45°),
   *   7=Wide(-60°,+60°)
   */
  _hLouverSvg(hValue, active = false) {
    const color = active ? '#4fc3f7' : '#666';
    const LOUVER_ANGLES = {
      '1':     [0,    0   ],
      '2':     [-45,  -45 ],
      '3':     [-45,  0   ],
      '4':     [0,    0   ],
      '5':     [0,    45  ],
      '6':     [45,   45  ],
      '7':     [-60,  60  ],
      'swing': null,
    };

    // Override center position for pos 4 to look distinct from pos 1
    // pos 1: both point forward (0), pos 4: also both center but we draw same — fine
    const angles = LOUVER_ANGLES[hValue];
    const W = 36, H = 36, CX = W / 2, CY = H / 2;
    const LEN = 10; // half-length of each louver bar

    if (!angles) {
      // Swing: show arrows cycling with ↔ symbol
      return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
        <text x="${CX}" y="${CY + 5}" text-anchor="middle" font-size="16" fill="${color}">↔</text>
      </svg>`;
    }

    const louver = (cx, deg) => {
      const r = deg * Math.PI / 180;
      const dx = LEN * Math.sin(r), dy = LEN * Math.cos(r);
      // Arrow tip
      const tx = cx + dx, ty = CY - dy;
      const bx = cx - dx, by = CY + dy;
      // Arrowhead direction (pointing forward = upward in top-down view)
      const ax = tx - 5 * Math.sin(r - 0.35), ay = ty + 5 * Math.cos(r - 0.35);
      const bax = tx - 5 * Math.sin(r + 0.35), bay = ty + 5 * Math.cos(r + 0.35);
      return `
        <line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"
          stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)} L${bax.toFixed(1)},${bay.toFixed(1)}"
          fill="${color}"/>`;
    };

    return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
      ${louver(CX - 9, angles[0])}
      ${louver(CX + 9, angles[1])}
    </svg>`;
  }

  // ─── Buttons ──────────────────────────────────────────────────────────────

  _modeButtons(currentMode) {
    return Object.entries(MODES).map(([mode, { label, icon }]) => `
      <button class="mode-btn ${mode === currentMode ? 'active' : ''}" data-mode="${mode}" title="${label}">
        <span class="mode-icon">${icon}</span>
        <span class="mode-label">${label}</span>
      </button>`).join('');
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
        ? `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
            <text x="12" y="17" text-anchor="middle" font-size="14" fill="currentColor">↕</text>
          </svg>`
        : (() => {
            const r = p.angle * Math.PI / 180;
            const x2 = 4 + 16 * Math.cos(r), y2 = 4 + 16 * Math.sin(r);
            const tx = x2, ty = y2;
            const lx = x2 - 6 * Math.cos(r - 0.4), ly = y2 - 6 * Math.sin(r - 0.4);
            const rx2 = x2 - 6 * Math.cos(r + 0.4), ry = y2 - 6 * Math.sin(r + 0.4);
            return `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
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
        ${this._hLouverSvg(p.value, p.value === currentH)}
      </button>`).join('');
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
    const accent     = MODE_COLORS[mode] || '#7b68ee';
    const targetTemp = this._attr('temperature', 22);
    const fanMode    = this._attr('fan_mode', 'auto');
    const swingMode  = this._attr('swing_mode', '1');
    const entrust    = this._attr('entrust', false);
    const indoorT    = this._sensorValue(this._config.indoor_sensor);
    const outdoorT   = this._sensorValue(this._config.outdoor_sensor);
    const pending    = this._isPending();

    // Horizontal swing is not yet exposed as a climate attribute — read from extra attrs.
    const hSwing = (() => {
      const s = this._state();
      if (this._pending?.field === 'h_swing') return this._pending.value;
      return s?.attributes?.wind_lr_mode || '1';
    })();

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
        width: 36px; height: 36px; font-size: 16px; cursor: pointer; color: #fff;
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
      .mode-row { display: flex; gap: 5px; margin-bottom: 14px; flex-wrap: wrap; }
      .mode-btn {
        flex: 1; min-width: 48px;
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
      .temp-value { font-size: 42px; font-weight: 300; color: ${accent}; line-height: 1; text-align: center; }
      .temp-unit { font-size: 13px; color: #555; text-align: center; }
      .vane-area { display: flex; justify-content: center; margin-bottom: 12px; }
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
            <button class="power-btn" id="pwr" title="${isOn ? 'Turn off' : 'Turn on'}">${MODES[mode]?.icon || '⏻'}</button>
          </div>
        </div>
        <div class="body">

          <div class="section-label">Mode</div>
          <div class="mode-row">${this._modeButtons(mode)}</div>

          <div class="temp-row">
            <button class="temp-btn" id="tm">−</button>
            <div>
              <div class="temp-value">${isOn ? targetTemp.toFixed(1) : '—'}</div>
              <div class="temp-unit">°C target</div>
            </div>
            <button class="temp-btn" id="tp">+</button>
          </div>

          <div class="vane-area">${this._verticalVaneSvg(swingMode)}</div>

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
