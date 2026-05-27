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
  off: { label: "Off", icon: null }, // power btn uses inline SVG, not ⏻
  auto: { label: "Auto", icon: "♾" },
  cool: { label: "Cool", icon: "❄" },
  heat: { label: "Heat", icon: "🔥" },
  fan_only: { label: "Fan", icon: "🌀" },
  dry: { label: "Dry", icon: "💧" },
};

const MODE_COLORS = {
  off: "#555",
  auto: "#7b68ee",
  cool: "#4fc3f7",
  heat: "#ff7043",
  fan_only: "#80cbc4",
  dry: "#fff176",
};

// Inline SVG power icon — replaces ⏻ which has poor mobile font support
const POWER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A7 7 0 0 1 5 12c0-2.28 1.09-4.3 2.79-5.59L6.37 5A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z"
    fill="currentColor"/>
</svg>`;

// Horizontal vane positions.
// sides: [left_section, right_section] where each is 'L', 'M', 'R', or null (no line).
// null sides = swing mode.
const H_POSITIONS = [
  {
    value: "both_left",
    label: "Both L",
    desc: "Both sections aim left",
    sides: ["L", "L"],
  },
  {
    value: "left_center",
    label: "L + Mid",
    desc: "Left aims left, right center",
    sides: ["L", "M"],
  },
  {
    value: "both_center",
    label: "Both Mid",
    desc: "Both sections center",
    sides: ["M", "M"],
  },
  {
    value: "center_right",
    label: "Mid + R",
    desc: "Left center, right aims right",
    sides: ["M", "R"],
  },
  {
    value: "both_right",
    label: "Both R",
    desc: "Both sections aim right",
    sides: ["R", "R"],
  },
  {
    value: "wide",
    label: "Wide",
    desc: "Left aims left, right aims right",
    sides: ["L", "R"],
  },
  {
    value: "right_left",
    label: "R + L",
    desc: "Left aims right, right aims left",
    sides: ["R", "L"],
  },
  { value: "swing", label: "Swing", desc: "Auto swing", sides: null },
];

// Angle in degrees for each horizontal direction symbol (top-view, 0=straight forward)
const H_DIR_ANGLE = { L: -45, M: 0, R: 45 };

// Vertical vane positions.
// angle: degrees below horizontal. null = swing.
const V_POSITIONS = [
  { value: "1", label: "1", angle: 10 },
  { value: "2", label: "2", angle: 28 },
  { value: "3", label: "3", angle: 48 },
  { value: "4", label: "4", angle: 65 },
  { value: "swing", label: "Swing", angle: null },
];

class KazemBridgeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._pending = null;
    this._queued = {};
    this._debounceTimer = null;
    this._pollInterval = null;
    this._entrustDebounce = null;
    this._firstHassSet = true;

    // JS-driven animation state — avoids SVG SMIL fighting re-renders.
    // _vAngle: current DISPLAYED vertical angle (animated in JS, degrees)
    // _vTarget: where we want to get to
    // _hAngles: [leftDeg, rightDeg] currently displayed (animated)
    // _hTargets: [leftDeg, rightDeg] target
    this._vAngle = null; // null = not yet initialised
    this._vTarget = null;
    this._hAngles = null; // null = not yet initialised
    this._hTargets = null;
    this._rafId = null;
    this._lastRafTs = null;
  }

  connectedCallback() {
    this._triggerPoll();
    this._pollInterval = setInterval(() => this._triggerPoll(), 4000);
    this._startRaf();
  }

  disconnectedCallback() {
    clearInterval(this._pollInterval);
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _startRaf() {
    if (this._rafId) return;
    const loop = (ts) => {
      this._rafId = requestAnimationFrame(loop);
      const dt = this._lastRafTs
        ? Math.min((ts - this._lastRafTs) / 1000, 0.05)
        : 0;
      this._lastRafTs = ts;
      // Ease toward targets at ~8 units/s (fast but smooth)
      const SPEED = 280; // degrees per second
      const ease = (cur, tgt) => {
        if (cur === null) return tgt;
        const diff = tgt - cur;
        if (Math.abs(diff) < 0.3) return tgt;
        return cur + Math.sign(diff) * Math.min(Math.abs(diff), SPEED * dt);
      };

      let dirty = false;

      // Vertical
      if (this._vTarget !== null && this._vAngle !== this._vTarget) {
        const next = ease(this._vAngle ?? this._vTarget, this._vTarget);
        if (next !== this._vAngle) {
          this._vAngle = next;
          dirty = true;
        }
      }

      // Horizontal — two independent arrows but clamped so they stay within 90° of each other
      if (this._hTargets !== null) {
        if (this._hAngles === null) this._hAngles = [...this._hTargets];
        const [tl, tr] = this._hTargets;
        let nl = ease(this._hAngles[0], tl);
        let nr = ease(this._hAngles[1], tr);
        // Clamp: arrows can't be more than 90° apart (irl vane constraint)
        if (nr - nl > 90) nl = nr - 90;
        if (nl - nr > 90) nr = nl - 90;
        if (nl !== this._hAngles[0] || nr !== this._hAngles[1]) {
          this._hAngles = [nl, nr];
          dirty = true;
        }
      }

      if (dirty) this._renderSvgsOnly();
    };
    this._rafId = requestAnimationFrame(loop);
  }

  // Cheaply update just the two SVG panels without rebuilding the whole card.
  // Called every RAF frame while an animation is in progress.
  _renderSvgsOnly() {
    const root = this.shadowRoot;
    if (!root) return;
    const panels = root.querySelectorAll(".vane-panel");
    if (panels.length < 2) return;
    const hSwing = this._attr("swing_horizontal_mode", "normal");
    const swingMode = this._attr("swing_mode", "1");
    panels[0].innerHTML = `<div class="section-label">Front view</div>${this._frontViewSvg(hSwing)}`;
    panels[1].innerHTML = `<div class="section-label">Side view</div>${this._sideViewSvg(swingMode)}`;
  }

  _triggerPoll() {
    if (this._hass && this._config) {
      this._hass
        .callWS({
          type: "homeassistant/update_entity",
          entity_id: this._config.entity,
        })
        .catch(() => {});
    }
  }

  setConfig(config) {
    if (!config.entity) throw new Error("kazembridge-card: entity is required");
    this._config = {
      entity: config.entity,
      indoor_sensor: config.indoor_sensor || null,
      outdoor_sensor: config.outdoor_sensor || null,
    };
    this._render();
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
        const allConfirmed = Object.entries(this._pending.changes).every(
          ([f, v]) => {
            const actual = f === "hvac_mode" ? s.state : s.attributes[f];
            return actual == v;
          },
        );
        if (allConfirmed || Date.now() > this._pending.until) {
          this._pending = null;
        }
      }
    }

    if (wasNull && this._config) {
      this._triggerPoll();
    }

    this._render();
  }

  getCardSize() {
    return 6;
  }

  // ─── State helpers ────────────────────────────────────────────────────────

  _state() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _attr(key, fallback = null) {
    const s = this._state();
    if (
      this._pending?.changes[key] !== undefined &&
      Date.now() < this._pending.until
    ) {
      return this._pending.changes[key];
    }
    return s ? (s.attributes[key] ?? fallback) : fallback;
  }

  _mode() {
    const s = this._state();
    if (
      this._pending?.changes["hvac_mode"] !== undefined &&
      Date.now() < this._pending.until
    ) {
      return this._pending.changes["hvac_mode"];
    }
    return s ? s.state : "off";
  }

  _isOn() {
    return this._mode() !== "off";
  }

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
    if (!this._pending)
      this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes[field] = value;
    this._pending.until = Date.now() + 30000;
    this._render();
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), 600);
  }

  _flush() {
    const changes = { ...this._queued };
    this._queued = {};
    this._hass.callService("kazembridge", "set_state", {
      entity_id: this._config.entity,
      ...changes,
    });
  }

  // ─── Action methods ───────────────────────────────────────────────────────

  _setMode(mode) {
    this._queue("hvac_mode", mode);
  }

  _adjustTemp(delta) {
    const cur = this._attr("temperature", 22);
    const next = Math.max(16, Math.min(31, Math.round((cur + delta) * 2) / 2));
    this._queue("temperature", next);
  }

  _setFan(mode) {
    this._queue("fan_mode", mode);
  }

  _setSwing(mode) {
    this._queue("swing_mode", mode);
  }

  _setHSwing(value) {
    this._queue("swing_horizontal_mode", value);
  }

  _toggleEntrust() {
    const cur = this._attr("preset_mode", "none") === "3d_auto";
    clearTimeout(this._entrustDebounce);
    this._entrustDebounce = setTimeout(() => {
      this._hass.callService("climate", "set_preset_mode", {
        entity_id: this._config.entity,
        preset_mode: cur ? "none" : "3d_auto",
      });
    }, 600);
    if (!this._pending)
      this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes["preset_mode"] = cur ? "none" : "3d_auto";
    this._pending.until = Date.now() + 30000;
    this._render();
  }

  // ─── SVG helpers ──────────────────────────────────────────────────────────

  /**
   * Front view. Fixed positions use JS-animated _hAngles (updated by RAF loop).
   * Swing uses SMIL (continuous, re-render-safe).
   */
  _frontViewSvg(hValue) {
    const VB_W = 200,
      VB_H = 100;
    const BX = 4,
      BY = 8,
      BW = VB_W - 8,
      BH = 36;
    const arrowRootY = BY + BH;
    const MID = VB_W / 2;
    const lx = MID / 2,
      rx = MID + MID / 2;

    const pos = H_POSITIONS.find((p) => p.value === hValue) || H_POSITIONS[0];

    // Keep targets updated; RAF loop eases _hAngles toward them each frame
    if (pos.sides !== null) {
      const tl = H_DIR_ANGLE[pos.sides[0]];
      const tr = H_DIR_ANGLE[pos.sides[1]];
      const changed =
        !this._hTargets || this._hTargets[0] !== tl || this._hTargets[1] !== tr;
      if (changed) {
        this._hTargets = [tl, tr];
        if (this._hAngles === null) this._hAngles = [tl, tr]; // snap on first render
      }
    }

    const body = `
      <rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="6" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      <line x1="${BX + 12}" y1="${BY + 11}" x2="${BX + BW - 12}" y2="${BY + 11}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${BX + 12}" y1="${BY + 21}" x2="${BX + BW - 12}" y2="${BY + 21}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${BX + 12}" y1="${BY + 31}" x2="${BX + BW - 12}" y2="${BY + 31}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${MID}" y1="${BY + 4}" x2="${MID}" y2="${BY + BH - 4}" stroke="#2a2a3a" stroke-width="1.5"/>
      <circle cx="${BX + BW - 10}" cy="${BY + 8}" r="4" fill="${this._isOn() ? "#4caf50" : "#444"}" opacity="0.9"/>`;

    // Static arrow at exact angle — no animation needed, RAF moves it every frame
    const arrowAt = (cx, deg) => {
      const LEN = 36,
        HEAD = 7;
      const r = (deg * Math.PI) / 180;
      const adx = Math.sin(r),
        ady = Math.cos(r);
      const pdx = Math.cos(r),
        pdy = -Math.sin(r);
      const x0 = cx,
        y0 = arrowRootY;
      const xt = x0 + adx * LEN,
        yt = y0 + ady * LEN;
      const xb = xt - adx * HEAD,
        yb = yt - ady * HEAD;
      const hw = HEAD * 0.55;
      return `<g opacity="0.9">
        <line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}"
              x2="${(xt - adx * 3).toFixed(1)}" y2="${(yt - ady * 3).toFixed(1)}"
          stroke="#4fc3f7" stroke-width="1.8" stroke-dasharray="4,3"/>
        <path d="M${(xb - pdx * hw).toFixed(1)},${(yb - pdy * hw).toFixed(1)}
                 L${xt.toFixed(1)},${yt.toFixed(1)}
                 L${(xb + pdx * hw).toFixed(1)},${(yb + pdy * hw).toFixed(1)}"
          fill="#4fc3f7"/>
      </g>`;
    };

    let arrowContent = "";

    if (pos.sides === null) {
      // SWING: triangle wave, left leads right by a small offset so they stay close
      // but visibly staggered. 0.2s lag = they're never more than ~10° apart.
      const dur = 3.6,
        steps = 80;
      const phase = ((Date.now() / 1000) % dur).toFixed(2);
      const makeDegs = (phaseShift) => {
        const out = [];
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps + phaseShift / dur) % 1;
          const tri = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;
          out.push(-45 + tri * 90);
        }
        return out;
      };
      // Left leads by 0.2s (≈1/18 of cycle) — close together, not in lockstep
      const leftDegs = makeDegs(0),
        rightDegs = makeDegs(0.2);
      const kTimes = leftDegs.map((_, i) => (i / steps).toFixed(4)).join(";");
      const LEN = 36,
        HEAD = 7,
        hw = HEAD * 0.55;
      const animArrow = (cx, degs) => {
        const vals = degs.map((d) => `${d} ${cx} ${arrowRootY}`).join(";");
        const anim = `<animateTransform attributeName="transform" type="rotate"
          values="${vals}" keyTimes="${kTimes}" dur="${dur}s"
          repeatCount="indefinite" begin="-${phase}s" calcMode="linear" additive="sum"/>`;
        const y0 = arrowRootY,
          yt = y0 + LEN,
          yb = yt - HEAD;
        return `<g opacity="0.85">
          <line x1="${cx}" y1="${y0}" x2="${cx}" y2="${(yt - 3).toFixed(1)}"
            stroke="#4fc3f7" stroke-width="1.8" stroke-dasharray="4,3">${anim}</line>
          <path d="M${(cx - hw).toFixed(1)},${yb.toFixed(1)} L${cx},${yt.toFixed(1)} L${(cx + hw).toFixed(1)},${yb.toFixed(1)}"
            fill="#4fc3f7">${anim}</path>
        </g>`;
      };
      arrowContent = animArrow(lx, leftDegs) + animArrow(rx, rightDegs);
    } else {
      // FIXED: just render at current animated angles — RAF is already moving them
      const [al, ar] = this._hAngles ?? [
        H_DIR_ANGLE[pos.sides[0]],
        H_DIR_ANGLE[pos.sides[1]],
      ];
      arrowContent = arrowAt(lx, al) + arrowAt(rx, ar);
    }

    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      ${body}${arrowContent}
    </svg>`;
  }

  /**
   * Side view. Fixed positions use JS-animated _vAngle (updated by RAF loop).
   * Swing uses SMIL (continuous, re-render-safe). Tip sweeps downward.
   */
  _sideViewSvg(vValue) {
    const VB_W = 200,
      VB_H = 105;
    const BW = 68,
      BH = 30,
      BX = VB_W - BW - 4,
      BY = 6;
    const VX = BX,
      VY = BY + BH;
    const VLEN = 36;

    const vpos = V_POSITIONS.find((p) => p.value === vValue) || V_POSITIONS[0];
    const isSwing = vValue === "swing";

    // Keep target updated; RAF eases _vAngle toward it
    if (!isSwing) {
      if (this._vTarget !== vpos.angle) {
        this._vTarget = vpos.angle;
        if (this._vAngle === null) this._vAngle = vpos.angle; // snap on first render
      }
    }

    // vaneEnd: tip of vane at `deg` degrees below horizontal, pointing left from (VX,VY)
    const vaneEnd = (deg) => {
      const r = (deg * Math.PI) / 180;
      return [VX - VLEN * Math.cos(r), VY + VLEN * Math.sin(r)];
    };

    const flowArrows = (deg) => {
      const r = (deg * Math.PI) / 180;
      const adx = -Math.cos(r),
        ady = Math.sin(r);
      const pdx = -Math.sin(r),
        pdy = -Math.cos(r);
      const LEN = 32,
        HEAD = 6;
      const tipX = VX + adx * VLEN,
        tipY = VY + ady * VLEN;
      return [-9, 0, 9]
        .map((off, i) => {
          const ox = tipX + pdx * off + adx * 2,
            oy = tipY + pdy * off + ady * 2;
          const ex = ox + adx * LEN,
            ey = oy + ady * LEN;
          const xb = ex - adx * HEAD,
            yb = ey - ady * HEAD;
          const op = i === 1 ? 0.9 : 0.5;
          const bpx = pdy,
            bpy = -pdx;
          return `<g opacity="${op}">
          <line x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}"
                x2="${(ex - adx * 2).toFixed(1)}" y2="${(ey - ady * 2).toFixed(1)}"
            stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3"/>
          <path d="M${(xb + bpx * HEAD * 0.55).toFixed(1)},${(yb + bpy * HEAD * 0.55).toFixed(1)}
                   L${ex.toFixed(1)},${ey.toFixed(1)}
                   L${(xb - bpx * HEAD * 0.55).toFixed(1)},${(yb - bpy * HEAD * 0.55).toFixed(1)}"
            fill="#4fc3f7"/>
        </g>`;
        })
        .join("");
    };

    let vaneContent = "";

    if (isSwing) {
      // SWING: SMIL. Negative rotation values so tip sweeps downward.
      const minA = 10,
        maxA = 65,
        steps = 80,
        dur = 3.6;
      const phase = ((Date.now() / 1000) % dur).toFixed(2);
      const allAngles = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
        allAngles.push(minA + tri * (maxA - minA));
      }
      const kTimes = allAngles.map((_, i) => (i / steps).toFixed(4)).join(";");
      const values = allAngles.map((a) => `-${a} ${VX} ${VY}`).join(";");
      const [vx2, vy2] = vaneEnd(minA);
      vaneContent = `
        <line x1="${VX}" y1="${VY}" x2="${vx2.toFixed(1)}" y2="${vy2.toFixed(1)}"
            stroke="#bbb" stroke-width="5" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate"
            values="${values}" keyTimes="${kTimes}"
            dur="${dur}s" repeatCount="indefinite" begin="-${phase}s" calcMode="linear"/>
        </line>`;
    } else {
      // FIXED: render at current JS-animated angle — no SMIL needed
      const displayAngle = this._vAngle ?? vpos.angle;
      const [vx2, vy2] = vaneEnd(displayAngle);
      vaneContent =
        `<line x1="${VX}" y1="${VY}" x2="${vx2.toFixed(1)}" y2="${vy2.toFixed(1)}"
            stroke="#bbb" stroke-width="5" stroke-linecap="round"/>` +
        flowArrows(displayAngle);
    }

    const ticks = Array.from(
      { length: 6 },
      (_, i) =>
        `<line x1="${BX + 8 + i * 10}" y1="${BY + BH}" x2="${BX + 8 + i * 10}" y2="${BY + BH + 5}" stroke="#3a3a4a" stroke-width="1.5"/>`,
    ).join("");

    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      <rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="5" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      ${ticks}
      <line x1="${BX}" y1="${BY + 3}" x2="${BX}" y2="${BY + BH - 3}" stroke="#4a4a5a" stroke-width="2.5"/>
      <circle cx="${BX + BW - 10}" cy="${BY + 8}" r="4" fill="${this._isOn() ? "#4caf50" : "#444"}" opacity="0.9"/>
      ${vaneContent}
    </svg>`;
  }

  // ─── Buttons ──────────────────────────────────────────────────────────────

  _modeButtons(currentMode) {
    return Object.entries(MODES)
      .map(([mode, { label, icon }]) => {
        const iconHtml =
          mode === "off" ? POWER_SVG : `<span class="mode-icon">${icon}</span>`;
        return `
        <button class="mode-btn ${mode === currentMode ? "active" : ""}" data-mode="${mode}" title="${label}">
          ${iconHtml}
          <span class="mode-label">${label}</span>
        </button>`;
      })
      .join("");
  }

  _fanButtons(currentFan) {
    return ["auto", "1", "2", "3", "4"]
      .map(
        (f) => `
      <button class="fan-btn ${f === currentFan ? "active" : ""}" data-fan="${f}"
        title="${f === "auto" ? "Auto" : `Speed ${f}`}">
        ${f === "auto" ? "A" : f}
      </button>`,
      )
      .join("");
  }

  _verticalVaneButtons(current) {
    return V_POSITIONS.map((p) => {
      const active = p.value === current;
      const isSwing = p.value === "swing";

      let icon;
      if (isSwing) {
        icon = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 10l5-5 5 5H7zm10 4l-5 5-5-5h10z" fill="currentColor"/>
        </svg>`;
      } else {
        const r = (p.angle * Math.PI) / 180;
        const ox = 20,
          oy = 5;
        const LEN = 15,
          HEAD = 5;
        const adx = -Math.cos(r),
          ady = Math.sin(r);
        const pdx = -Math.sin(r),
          pdy = -Math.cos(r);
        const ex = ox + adx * LEN,
          ey = oy + ady * LEN;
        const xb = ex - adx * HEAD,
          yb = ey - ady * HEAD;
        icon = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
          <line x1="${ox}" y1="${oy}" x2="${(ex + adx * 2).toFixed(1)}" y2="${(ey + ady * 2).toFixed(1)}"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M${(xb - pdx * HEAD * 0.6).toFixed(1)},${(yb - pdy * HEAD * 0.6).toFixed(1)}
                   L${ex.toFixed(1)},${ey.toFixed(1)}
                   L${(xb + pdx * HEAD * 0.6).toFixed(1)},${(yb + pdy * HEAD * 0.6).toFixed(1)}"
            fill="currentColor"/>
        </svg>`;
      }

      return `<button class="vane-btn ${active ? "active" : ""}" data-vswing="${p.value}"
          title="${p.label}">
          ${icon}
        </button>`;
    }).join("");
  }

  _horizontalVaneButtons(currentH) {
    return H_POSITIONS.map(
      (p) => `
      <button class="vane-btn h-vane-btn ${p.value === currentH ? "active" : ""}"
        data-hswing="${p.value}" title="${p.desc}">
        ${this._hSectionSvg(p.sides, p.value === currentH)}
      </button>`,
    ).join("");
  }

  _hSectionSvg(sides, active = false) {
    const W = 36,
      H = 32;
    const col = active ? "#4fc3f7" : "#666";
    const mid = W / 2;
    const bodyT = 4,
      bodyH = 9;
    const rootY = bodyT + bodyH;

    const bodyRect = `
      <rect x="2" y="${bodyT}" width="${W - 4}" height="${bodyH}" rx="3"
        fill="#25252f" stroke="${col}" stroke-width="1" opacity="0.7"/>
      <line x1="${mid}" y1="${bodyT + 2}" x2="${mid}" y2="${rootY - 2}"
        stroke="${col}" stroke-width="1" opacity="0.5"/>`;

    if (sides === null) {
      return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
        ${bodyRect}
        <path d="M4,${rootY + 9} l4,-3 v2 h4 v2 h-4 v2 z" fill="${col}"/>
        <path d="M32,${rootY + 9} l-4,-3 v2 h-4 v2 h4 v2 z" fill="${col}"/>
        <circle cx="${mid}" cy="${rootY + 9}" r="1.5" fill="${col}" opacity="0.6"/>
      </svg>`;
    }

    const arrow = (cx, dir) => {
      if (!dir) return "";
      const LEN = 11,
        HEAD = 4;
      const deg = H_DIR_ANGLE[dir];
      const r = (deg * Math.PI) / 180;
      const adx = Math.sin(r),
        ady = Math.cos(r);
      const pdx = Math.cos(r),
        pdy = -Math.sin(r);
      const xt = cx + adx * LEN,
        yt = rootY + ady * LEN;
      const xb = xt - adx * HEAD,
        yb = yt - ady * HEAD;
      return `
        <line x1="${cx}" y1="${rootY}" x2="${(xt - adx * 2).toFixed(1)}" y2="${(yt - ady * 2).toFixed(1)}"
          stroke="${col}" stroke-width="1.5" stroke-dasharray="3,2"/>
        <path d="M${(xb - pdx * HEAD * 0.6).toFixed(1)},${(yb - pdy * HEAD * 0.6).toFixed(1)}
                 L${xt.toFixed(1)},${yt.toFixed(1)}
                 L${(xb + pdx * HEAD * 0.6).toFixed(1)},${(yb + pdy * HEAD * 0.6).toFixed(1)}"
          fill="${col}"/>`;
    };

    const [leftDir, rightDir] = sides;
    return `<svg viewBox="0 0 ${W} ${H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
      ${bodyRect}
      ${arrow(mid / 2, leftDir)}
      ${arrow(mid + mid / 2, rightDir)}
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

    const mode = this._mode();
    const isOn = this._isOn();
    const accent = MODE_COLORS[mode] || "#7b68ee";
    const targetTemp = this._attr("temperature", 22);
    const fanMode = this._attr("fan_mode", "auto");
    const swingMode = this._attr("swing_mode", "1");
    const entrust = this._attr("preset_mode", "none") === "3d_auto";
    const indoorT = this._sensorValue(this._config.indoor_sensor);
    const outdoorT = this._sensorValue(this._config.outdoor_sensor);
    const pending = this._isPending();
    const hSwing = this._attr("swing_horizontal_mode", "normal");

    const tempDisplay = targetTemp.toFixed(1);
    const tempDisabled = !isOn || mode === "fan_only";

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
        background: ${isOn ? accent : "#333"}; border: none; border-radius: 50%;
        width: 36px; height: 36px; cursor: pointer; color: #fff;
        transition: background 0.3s; display: flex; align-items: center; justify-content: center;
      }
      .pending-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: ${accent}; opacity: ${pending ? 1 : 0};
        transition: opacity 0.3s;
        animation: ${pending ? "pulse 1s infinite" : "none"};
      }
      @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
      .body { padding: 14px 18px; }
      .section-label {
        font-size: 10px; color: #555; text-transform: uppercase;
        letter-spacing: 0.08em; margin-bottom: 6px;
      }
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
      .temp-btn:disabled { opacity: 0.3; cursor: default; }
      .temp-value { font-size: 42px; font-weight: 300; color: ${accent}; line-height: 1; text-align: center; }
      .temp-unit { font-size: 13px; color: #555; text-align: center; }
      .vane-panels { display: flex; gap: 10px; margin-bottom: 12px; }
      .vane-panel { flex: 1; display: flex; flex-direction: column; align-items: center; }
      .vane-panel .section-label { margin-bottom: 4px; }
      .vane-row { display: flex; gap: 5px; margin-bottom: 14px; }
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
        background: ${entrust ? "#7b68ee33" : "#2a2a3a"}; border: 1px solid ${entrust ? "#7b68ee" : "#333"};
        border-radius: 8px; padding: 7px 12px; cursor: pointer;
        color: ${entrust ? "#7b68ee" : "#666"}; font-size: 12px; font-family: inherit;
        transition: background 0.2s, border-color 0.2s, color 0.2s;
      }
      .sensor-row {
        display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #2a2a3a;
      }
      .sensor-chip {
        flex: 1; background: #2a2a3a; border-radius: 10px; padding: 8px 10px; text-align: center;
      }
      .s-label { font-size: 10px; color: #555; }
      .s-val { font-size: 20px; font-weight: 300; color: #e0e0e0; }
      .s-unit { font-size: 10px; color: #555; }
    `;

    const html = `
      <style>${css}</style>
      <ha-card>
        <div class="header">
          <div class="title">${state.attributes.friendly_name || this._config.entity}</div>
          <div class="header-right">
            <div class="pending-dot" title="${pending ? "Updating…" : ""}"></div>
            <button class="power-btn" id="pwr" title="${isOn ? "Turn off" : "Turn on"}">${POWER_SVG}</button>
          </div>
        </div>
        <div class="body">

          <div class="section-label">Mode</div>
          <div class="mode-row">${this._modeButtons(mode)}</div>

          <div class="temp-row">
            <button class="temp-btn" id="tm" ${tempDisabled ? "disabled" : ""}>−</button>
            <div>
              <div class="temp-value">${tempDisplay}</div>
              <div class="temp-unit">°C target</div>
            </div>
            <button class="temp-btn" id="tp" ${tempDisabled ? "disabled" : ""}>+</button>
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
              ✦ 3D Auto${entrust ? " ON" : ""}
            </button>
          </div>

          ${
            indoorT !== null || outdoorT !== null
              ? `
          <div class="sensor-row">
            ${
              indoorT !== null
                ? `<div class="sensor-chip">
              <div class="s-label">Indoor</div>
              <div class="s-val">${indoorT.toFixed(1)}</div>
              <div class="s-unit">°C</div>
            </div>`
                : ""
            }
            ${
              outdoorT !== null
                ? `<div class="sensor-chip">
              <div class="s-label">Outdoor</div>
              <div class="s-val">${outdoorT.toFixed(1)}</div>
              <div class="s-unit">°C</div>
            </div>`
                : ""
            }
          </div>`
              : ""
          }

        </div>
      </ha-card>`;

    this.shadowRoot.innerHTML = html;
    this._attachListeners();
  }

  _attachListeners() {
    const root = this.shadowRoot;
    root
      .getElementById("pwr")
      ?.addEventListener("click", () =>
        this._setMode(
          this._isOn() ? "off" : this._attr("hvac_mode_last") || "cool",
        ),
      );
    root
      .getElementById("tm")
      ?.addEventListener("click", () => this._adjustTemp(-0.5));
    root
      .getElementById("tp")
      ?.addEventListener("click", () => this._adjustTemp(0.5));
    root
      .getElementById("entrust")
      ?.addEventListener("click", () => this._toggleEntrust());
    root
      .querySelectorAll(".mode-btn")
      .forEach((b) =>
        b.addEventListener("click", () => this._setMode(b.dataset.mode)),
      );
    root
      .querySelectorAll("[data-vswing]")
      .forEach((b) =>
        b.addEventListener("click", () => this._setSwing(b.dataset.vswing)),
      );
    root
      .querySelectorAll("[data-hswing]")
      .forEach((b) =>
        b.addEventListener("click", () => this._setHSwing(b.dataset.hswing)),
      );
    root
      .querySelectorAll(".fan-btn")
      .forEach((b) =>
        b.addEventListener("click", () => this._setFan(b.dataset.fan)),
      );
  }
}

customElements.define("kazembridge-card", KazemBridgeCard);
