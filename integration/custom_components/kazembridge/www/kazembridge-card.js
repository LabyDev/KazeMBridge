/**
 * kazembridge-card — Lovelace custom card for MHI WF-RAC air conditioners.
 *
 * Served automatically by the KazeMBridge integration at
 * /kazembridge_static/kazembridge-card.js — no manual installation needed.
 * The integration registers it via add_extra_js_url on startup.
 *
 * Card config example:
 *   type: custom:kazembridge-card
 *   entity: climate.mhi_ac
 *   indoor_sensor:  sensor.mhi_ac_indoor_temperature    # optional
 *   outdoor_sensor: sensor.mhi_ac_outdoor_temperature   # optional
 */

"use strict";

// ─── Internationalisation ─────────────────────────────────────────────────────
// The card reads hass.language and falls back to English when a key is missing.
// Add a new language block here to support additional locales.
const STRINGS = {
  en: {
    mode: "Mode",
    vertical_vane: "Vertical vane",
    horizontal_vane: "Horizontal vane",
    fan_speed: "Fan speed",
    front_view: "Front view",
    side_view: "Side view",
    presets: "Presets",
    preset_name_ph: "Name…",
    preset_save: "+ Save",
    preset_confirm: "Save",
    preset_cancel: "Cancel",
    preset_this_ac: "This AC",
    preset_global: "Global",
    indoor: "Indoor",
    outdoor: "Outdoor",
    frost_protection: "Frost Protection",
    entrust_3d_auto: "3D Auto",
    turn_off: "Turn off",
    turn_on: "Turn on",
    updating: "Updating…",
    fan_auto: "A",
    swing: "Swing",
    global_badge: "G",
  },
  nl: {
    mode: "Modus",
    vertical_vane: "Verticale lamellen",
    horizontal_vane: "Horizontale lamellen",
    fan_speed: "Ventilatorsnelheid",
    front_view: "Vooraanzicht",
    side_view: "Zijaanzicht",
    presets: "Presets",
    preset_name_ph: "Naam…",
    preset_save: "+ Opslaan",
    preset_confirm: "Opslaan",
    preset_cancel: "Annuleren",
    preset_this_ac: "Deze AC",
    preset_global: "Globaal",
    indoor: "Binnen",
    outdoor: "Buiten",
    frost_protection: "Vorstbeveiliging",
    entrust_3d_auto: "3D Auto",
    turn_off: "Uitschakelen",
    turn_on: "Inschakelen",
    updating: "Bezig…",
    fan_auto: "A",
    swing: "Swing",
    global_badge: "G",
  },
};

// ─── Mode definitions ─────────────────────────────────────────────────────────
// Each entry maps an hvac_mode string to its display label and emoji icon.
// The "off" mode uses an inline SVG power icon instead (see POWER_SVG below).
const MODES = {
  off: { label: "Off", icon: null },
  auto: { label: "Auto", icon: "♾" },
  cool: { label: "Cool", icon: "❄" },
  heat: { label: "Heat", icon: "🔥" },
  fan_only: { label: "Fan", icon: "🌀" },
  dry: { label: "Dry", icon: "💧" },
};

// Accent colours per mode — used for the active mode button, temperature display,
// power button background, and the pending-indicator dot.
const MODE_COLORS = {
  off: "#555",
  auto: "#7b68ee",
  cool: "#4fc3f7",
  heat: "#ff7043",
  fan_only: "#80cbc4",
  dry: "#fff176",
};

// Inline SVG power icon.  Using SVG instead of the ⏻ Unicode character because
// ⏻ renders inconsistently or invisibly on many mobile fonts.
const POWER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A7 7 0 0 1 5 12c0-2.28 1.09-4.3 2.79-5.59L6.37 5A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z"
    fill="currentColor"/>
</svg>`;

// ─── Horizontal vane positions ────────────────────────────────────────────────
// sides: [left_section_direction, right_section_direction]
//   where each direction is 'L' (left), 'M' (centre), or 'R' (right).
//   null means swing mode — the arrows animate rather than point at a fixed angle.
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
    desc: "Left aims left, right centre",
    sides: ["L", "M"],
  },
  {
    value: "both_center",
    label: "Both Mid",
    desc: "Both sections centre",
    sides: ["M", "M"],
  },
  {
    value: "center_right",
    label: "Mid + R",
    desc: "Left centre, right aims right",
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

// Rotation angle (degrees) for each direction symbol, viewed from above.
// 0° = straight forward, negative = left, positive = right.
const H_DIR_ANGLE = { L: -45, M: 0, R: 45 };

// ─── Vertical vane positions ──────────────────────────────────────────────────
// angle: degrees below horizontal (10 = nearly horizontal, 65 = nearly vertical down).
// null angle means swing mode.
const V_POSITIONS = [
  { value: "1", label: "1", angle: 10 },
  { value: "2", label: "2", angle: 28 },
  { value: "3", label: "3", angle: 48 },
  { value: "4", label: "4", angle: 65 },
  { value: "swing", label: "Swing", angle: null },
];

// ─── Card element ─────────────────────────────────────────────────────────────

/**
 * KazemBridgeCard — custom Lovelace element for a single MHI WF-RAC climate entity.
 *
 * Lifecycle:
 *   setConfig()  — called once by Lovelace with the card's YAML config.
 *   set hass()   — called by Lovelace on every state update.
 *   connectedCallback()    — card added to DOM; starts polling and animation loop.
 *   disconnectedCallback() — card removed from DOM; stops polling and animation.
 *
 * Rendering:
 *   _render()        — full DOM rebuild (called on state changes).
 *   _renderSvgsOnly() — cheap RAF-frame update: redraws only the two vane SVGs.
 */
class KazemBridgeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null; // Home Assistant object — updated by set hass()
    this._config = null; // Card YAML config

    this._pending = null; // Optimistic state: { changes: {field: value}, until: timestampMs }
    this._queued = {}; // Accumulated changes waiting for the debounce flush
    this._debounceTimer = null;
    this._pollInterval = null;
    this._entrustDebounce = null;
    this._savingPreset = false; // Whether the preset-name input form is visible

    // ── JS-driven animation state ──────────────────────────────────────────
    // We animate the vane arrows in JavaScript (requestAnimationFrame) rather
    // than via SVG SMIL so that React-style re-renders don't restart animations.
    //
    // _vAngle:   currently displayed vertical angle (degrees below horizontal)
    // _vTarget:  the angle we are easing toward
    // _hAngles:  [leftDegrees, rightDegrees] currently displayed
    // _hTargets: [leftDegrees, rightDegrees] we are easing toward
    // null means "not yet initialised — snap to target on first frame".
    this._vAngle = null;
    this._vTarget = null;
    this._hAngles = null;
    this._hTargets = null;
    this._rafId = null;
    this._lastRafTs = null;
    this._renderPending = false;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback() {
    // Poll every 4 seconds so the card stays current even without a state push.
    this._triggerPoll();
    this._pollInterval = setInterval(() => this._triggerPoll(), 4000);
    this._startRaf();

    // Re-render when another card instance modifies shared global presets.
    this._onPresetsChanged = () => this._render();
    window.addEventListener("kzb-presets-changed", this._onPresetsChanged);
    window.addEventListener("storage", this._onPresetsChanged);
  }

  disconnectedCallback() {
    clearInterval(this._pollInterval);
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    window.removeEventListener("kzb-presets-changed", this._onPresetsChanged);
    window.removeEventListener("storage", this._onPresetsChanged);
  }

  // ─── Animation loop ────────────────────────────────────────────────────────

  /**
   * Start the requestAnimationFrame loop.
   * Each frame eases _vAngle → _vTarget and _hAngles → _hTargets at a fixed
   * angular speed, then calls _renderSvgsOnly() if anything changed.
   */
  _startRaf() {
    if (this._rafId) return;
    const loop = (timestamp) => {
      this._rafId = requestAnimationFrame(loop);

      // dt is capped at 50 ms so a tab wake-up after being hidden doesn't
      // cause the arrows to jump across large angles in one frame.
      const dt = this._lastRafTs
        ? Math.min((timestamp - this._lastRafTs) / 1000, 0.05)
        : 0;
      this._lastRafTs = timestamp;

      // Move current angle toward target at SPEED degrees per second.
      const SPEED = 280;
      const easeAngle = (current, target) => {
        if (current === null) return target; // snap on first frame
        const delta = target - current;
        if (Math.abs(delta) < 0.3) return target; // close enough — snap
        return (
          current + Math.sign(delta) * Math.min(Math.abs(delta), SPEED * dt)
        );
      };

      let isDirty = false;

      // Vertical arrow
      if (this._vTarget !== null && this._vAngle !== this._vTarget) {
        const nextAngle = easeAngle(
          this._vAngle ?? this._vTarget,
          this._vTarget,
        );
        if (nextAngle !== this._vAngle) {
          this._vAngle = nextAngle;
          isDirty = true;
        }
      }

      // Horizontal arrows (left and right independently)
      if (this._hTargets !== null) {
        if (this._hAngles === null) this._hAngles = [...this._hTargets];
        const [targetLeft, targetRight] = this._hTargets;
        let nextLeft = easeAngle(this._hAngles[0], targetLeft);
        let nextRight = easeAngle(this._hAngles[1], targetRight);
        // Keep arrows within 90° of each other (physical vane constraint).
        if (nextRight - nextLeft > 90) nextLeft = nextRight - 90;
        if (nextLeft - nextRight > 90) nextRight = nextLeft - 90;
        if (nextLeft !== this._hAngles[0] || nextRight !== this._hAngles[1]) {
          this._hAngles = [nextLeft, nextRight];
          isDirty = true;
        }
      }

      if (isDirty) this._renderSvgsOnly();
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /**
   * Cheaply redraw only the two vane SVG panels without rebuilding the whole card.
   * Called every RAF frame while an animation is in progress.
   */
  _renderSvgsOnly() {
    const root = this.shadowRoot;
    if (!root) return;
    const panels = root.querySelectorAll(".vane-panel");
    if (panels.length < 2) return;
    const hSwingValue = this._attr("swing_horizontal_mode", "normal");
    const vSwingValue = this._attr("swing_mode", "1");
    panels[0].innerHTML = `<div class="section-label">${this._t("front_view")}</div>${this._frontViewSvg(hSwingValue)}`;
    panels[1].innerHTML = `<div class="section-label">${this._t("side_view")}</div>${this._sideViewSvg(vSwingValue)}`;
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

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

  // ─── Config and hass setters ───────────────────────────────────────────────

  setConfig(config) {
    if (!config.entity) throw new Error("kazembridge-card: entity is required");
    this._config = {
      entity: config.entity,
      indoor_sensor: config.indoor_sensor || null,
      outdoor_sensor: config.outdoor_sensor || null,
    };
    this._render();
    if (this._hass) this._triggerPoll();
  }

  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;

    // Clear optimistic state once the AC confirms our changes (or the timeout expires).
    if (this._pending) {
      const entityState = hass.states[this._config?.entity];
      if (entityState) {
        const allConfirmed = Object.entries(this._pending.changes).every(
          ([field, value]) => {
            const actual =
              field === "hvac_mode"
                ? entityState.state
                : entityState.attributes[field];
            return actual == value;
          },
        );
        if (allConfirmed || Date.now() > this._pending.until) {
          this._pending = null;
        }
      }
    }

    if (wasNull && this._config) this._triggerPoll();
    this._render();
  }

  getCardSize() {
    return 6;
  }

  // ─── i18n helper ──────────────────────────────────────────────────────────

  /**
   * Look up a translation key for the current HA language.
   * Falls back to English if the language or key is missing.
   */
  _t(key) {
    const languageCode = (this._hass?.language || "en").split("-")[0];
    const strings = STRINGS[languageCode] || STRINGS.en;
    return strings[key] ?? STRINGS.en[key] ?? key;
  }

  // ─── State helpers ─────────────────────────────────────────────────────────

  _state() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  /**
   * Return the current value of a state attribute, taking optimistic overrides
   * into account.  Returns fallback if the attribute is absent.
   */
  _attr(key, fallback = null) {
    const entityState = this._state();
    if (
      this._pending?.changes[key] !== undefined &&
      Date.now() < this._pending.until
    ) {
      return this._pending.changes[key];
    }
    return entityState ? (entityState.attributes[key] ?? fallback) : fallback;
  }

  _mode() {
    const entityState = this._state();
    if (
      this._pending?.changes["hvac_mode"] !== undefined &&
      Date.now() < this._pending.until
    ) {
      return this._pending.changes["hvac_mode"];
    }
    return entityState ? entityState.state : "off";
  }

  _isOn() {
    return this._mode() !== "off";
  }

  _isPending() {
    return this._pending && Date.now() < this._pending.until;
  }

  _sensorValue(entityId) {
    if (!entityId || !this._hass) return null;
    const sensorState = this._hass.states[entityId];
    return sensorState ? parseFloat(sensorState.state) : null;
  }

  // ─── Action queue + debounce ───────────────────────────────────────────────

  /**
   * Queue a field change and optimistically update the UI immediately.
   * All queued changes are flushed to the AC after a 600 ms debounce,
   * so rapid button presses coalesce into a single network request.
   */
  _queue(field, value) {
    this._queued[field] = value;
    if (!this._pending)
      this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes[field] = value;
    if (!this._renderPending) {
      this._renderPending = true;
      requestAnimationFrame(() => { this._renderPending = false; this._render(); });
    }
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), 600);
  }

  _flush() {
    const changes = { ...this._queued };
    this._queued = {};
    this._pending = { changes, until: Date.now() + 8000 };
    this._hass.callService("kazembridge", "set_state", {
      entity_id: this._config.entity,
      ...changes,
    });
  }

  // ─── Action methods ────────────────────────────────────────────────────────

  _setMode(mode) {
    this._queue("hvac_mode", mode);
  }

  _setFan(fanSpeed) {
    this._queue("fan_mode", fanSpeed);
  }

  _adjustTemp(delta) {
    const current = this._attr("temperature", 22);
    const next = Math.max(
      16,
      Math.min(31, Math.round((current + delta) * 2) / 2),
    );
    this._queue("temperature", next);
  }

  _setSwing(vSwingValue) {
    this._queue("swing_mode", vSwingValue);
  }

  _setHSwing(hSwingValue) {
    this._queue("swing_horizontal_mode", hSwingValue);
  }

  /**
   * Toggle entrust (3D auto) mode.  Uses its own debounce timer because entrust
   * calls the standard climate service rather than the custom set_state service.
   */
  _toggleEntrust() {
    const isCurrentlyOn = this._attr("preset_mode", "none") === "3d_auto";
    clearTimeout(this._entrustDebounce);
    this._entrustDebounce = setTimeout(() => {
      this._hass.callService("climate", "set_preset_mode", {
        entity_id: this._config.entity,
        preset_mode: isCurrentlyOn ? "none" : "3d_auto",
      });
    }, 600);
    if (!this._pending)
      this._pending = { changes: {}, until: Date.now() + 30000 };
    this._pending.changes["preset_mode"] = isCurrentlyOn ? "none" : "3d_auto";
    this._pending.until = Date.now() + 30000;
    this._render();
  }

  // ─── SVG helpers ──────────────────────────────────────────────────────────

  /**
   * Build the front-view SVG (top-down diagram showing horizontal airflow).
   *
   * Fixed positions: the RAF loop continuously eases _hAngles toward _hTargets,
   * and _renderSvgsOnly() redraws the SVG each frame using the current angles.
   * This avoids SVG SMIL fighting full re-renders.
   *
   * Swing mode: uses SMIL animateTransform so the animation runs continuously
   * and survives re-renders without resetting.
   */
  _frontViewSvg(hSwingValue) {
    const VB_W = 200,
      VB_H = 100;
    const BOX_X = 4,
      BOX_Y = 8,
      BOX_W = VB_W - 8,
      BOX_H = 36;
    const arrowRootY = BOX_Y + BOX_H;
    const centerX = VB_W / 2;
    const leftX = centerX / 2;
    const rightX = centerX + centerX / 2;

    const position =
      H_POSITIONS.find((pos) => pos.value === hSwingValue) || H_POSITIONS[0];

    // Update the RAF animation targets whenever the position changes.
    if (position.sides !== null) {
      const targetLeft = H_DIR_ANGLE[position.sides[0]];
      const targetRight = H_DIR_ANGLE[position.sides[1]];
      const targetsChanged =
        !this._hTargets ||
        this._hTargets[0] !== targetLeft ||
        this._hTargets[1] !== targetRight;
      if (targetsChanged) {
        this._hTargets = [targetLeft, targetRight];
        if (this._hAngles === null) this._hAngles = [targetLeft, targetRight]; // snap on first render
      }
    }

    const bodyHtml = `
      <rect x="${BOX_X}" y="${BOX_Y}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      <line x1="${BOX_X + 12}" y1="${BOX_Y + 11}" x2="${BOX_X + BOX_W - 12}" y2="${BOX_Y + 11}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${BOX_X + 12}" y1="${BOX_Y + 21}" x2="${BOX_X + BOX_W - 12}" y2="${BOX_Y + 21}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${BOX_X + 12}" y1="${BOX_Y + 31}" x2="${BOX_X + BOX_W - 12}" y2="${BOX_Y + 31}" stroke="#383848" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="${centerX}" y1="${BOX_Y + 4}" x2="${centerX}" y2="${BOX_Y + BOX_H - 4}" stroke="#2a2a3a" stroke-width="1.5"/>
      <circle cx="${BOX_X + BOX_W - 10}" cy="${BOX_Y + 8}" r="4" fill="${this._isOn() ? "#4caf50" : "#444"}" opacity="0.9"/>`;

    // Draw a static arrow at the given angle.  The RAF loop moves the angle
    // each frame, so the arrow appears to animate without SMIL.
    const drawStaticArrow = (centerXPos, angleDeg) => {
      const ARROW_LEN = 36,
        HEAD_LEN = 7;
      const angleRad = (angleDeg * Math.PI) / 180;
      // adx/ady: unit vector along the arrow direction.
      // pdx/pdy: unit vector perpendicular to the arrow (for the arrowhead wings).
      const adx = Math.sin(angleRad),
        ady = Math.cos(angleRad);
      const pdx = Math.cos(angleRad),
        pdy = -Math.sin(angleRad);
      const rootX = centerXPos,
        rootY = arrowRootY;
      const tipX = rootX + adx * ARROW_LEN,
        tipY = rootY + ady * ARROW_LEN;
      const baseX = tipX - adx * HEAD_LEN,
        baseY = tipY - ady * HEAD_LEN;
      const halfW = HEAD_LEN * 0.55;
      return `<g opacity="0.9">
        <line x1="${rootX.toFixed(1)}" y1="${rootY.toFixed(1)}"
              x2="${(tipX - adx * 3).toFixed(1)}" y2="${(tipY - ady * 3).toFixed(1)}"
          stroke="#4fc3f7" stroke-width="1.8" stroke-dasharray="4,3"/>
        <path d="M${(baseX - pdx * halfW).toFixed(1)},${(baseY - pdy * halfW).toFixed(1)}
                 L${tipX.toFixed(1)},${tipY.toFixed(1)}
                 L${(baseX + pdx * halfW).toFixed(1)},${(baseY + pdy * halfW).toFixed(1)}"
          fill="#4fc3f7"/>
      </g>`;
    };

    let arrowsHtml = "";

    if (position.sides === null) {
      // ── Swing: SMIL triangle-wave animation ──────────────────────────────
      // Left arrow leads right by 0.2 s so they look slightly staggered but
      // stay close together (never more than ~10° apart).
      const CYCLE_DURATION = 3.6,
        STEPS = 80;
      const currentPhase = ((Date.now() / 1000) % CYCLE_DURATION).toFixed(2);

      const makeAngleValues = (phaseShiftSeconds) => {
        const values = [];
        for (let step = 0; step <= STEPS; step++) {
          const normalised =
            (step / STEPS + phaseShiftSeconds / CYCLE_DURATION) % 1;
          const triangle =
            normalised < 0.5 ? 1 - normalised * 2 : (normalised - 0.5) * 2;
          values.push(-45 + triangle * 90);
        }
        return values;
      };

      const leftAngles = makeAngleValues(0);
      const rightAngles = makeAngleValues(0.2);
      const keyTimes = leftAngles
        .map((_, index) => (index / STEPS).toFixed(4))
        .join(";");
      const ARROW_LEN = 36,
        HEAD_LEN = 7,
        halfW = HEAD_LEN * 0.55;

      const drawAnimatedArrow = (arrowX, angleValues) => {
        const rotateValues = angleValues
          .map((deg) => `${deg} ${arrowX} ${arrowRootY}`)
          .join(";");
        const animation = `<animateTransform attributeName="transform" type="rotate"
          values="${rotateValues}" keyTimes="${keyTimes}" dur="${CYCLE_DURATION}s"
          repeatCount="indefinite" begin="-${currentPhase}s" calcMode="linear" additive="sum"/>`;
        const tipY = arrowRootY + ARROW_LEN;
        const baseY = tipY - HEAD_LEN;
        return `<g opacity="0.85">
          <line x1="${arrowX}" y1="${arrowRootY}" x2="${arrowX}" y2="${(tipY - 3).toFixed(1)}"
            stroke="#4fc3f7" stroke-width="1.8" stroke-dasharray="4,3">${animation}</line>
          <path d="M${(arrowX - halfW).toFixed(1)},${baseY.toFixed(1)} L${arrowX},${tipY.toFixed(1)} L${(arrowX + halfW).toFixed(1)},${baseY.toFixed(1)}"
            fill="#4fc3f7">${animation}</path>
        </g>`;
      };

      arrowsHtml =
        drawAnimatedArrow(leftX, leftAngles) +
        drawAnimatedArrow(rightX, rightAngles);
    } else {
      // ── Fixed: render at current animated angles (RAF is moving them) ────
      const [currentLeft, currentRight] = this._hAngles ?? [
        H_DIR_ANGLE[position.sides[0]],
        H_DIR_ANGLE[position.sides[1]],
      ];
      arrowsHtml =
        drawStaticArrow(leftX, currentLeft) +
        drawStaticArrow(rightX, currentRight);
    }

    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      ${bodyHtml}${arrowsHtml}
    </svg>`;
  }

  /**
   * Build the side-view SVG (profile diagram showing vertical airflow).
   *
   * Fixed positions: animated via the RAF loop (same approach as the front view).
   * Swing mode: continuous SMIL animation — tip sweeps downward.
   */
  _sideViewSvg(vSwingValue) {
    const VB_W = 200,
      VB_H = 105;
    const BOX_W = 68,
      BOX_H = 30;
    const BOX_X = VB_W - BOX_W - 36,
      BOX_Y = 6;
    const VANE_X = BOX_X,
      VANE_Y = BOX_Y + BOX_H;
    const VANE_LEN = 36;

    const vposition =
      V_POSITIONS.find((pos) => pos.value === vSwingValue) || V_POSITIONS[0];
    const isSwing = vSwingValue === "swing";

    // Keep RAF target updated.
    if (!isSwing) {
      if (this._vTarget !== vposition.angle) {
        this._vTarget = vposition.angle;
        if (this._vAngle === null) this._vAngle = vposition.angle; // snap on first render
      }
    }

    // vaneEndpoint: coordinates of the vane tip at `angleDeg` below horizontal,
    // pointing left from the pivot point (VANE_X, VANE_Y).
    const vaneEndpoint = (angleDeg) => {
      const angleRad = (angleDeg * Math.PI) / 180;
      return [
        VANE_X - VANE_LEN * Math.cos(angleRad),
        VANE_Y + VANE_LEN * Math.sin(angleRad),
      ];
    };

    // Draw three airflow arrows fanning out from the vane tip at the given angle.
    const drawFlowArrows = (angleDeg) => {
      const angleRad = (angleDeg * Math.PI) / 180;
      // adx/ady: along the airflow direction (away from the vane).
      // pdx/pdy: perpendicular to it (for positioning the three parallel arrows).
      const adx = -Math.cos(angleRad),
        ady = Math.sin(angleRad);
      const pdx = -Math.sin(angleRad),
        pdy = -Math.cos(angleRad);
      const FLOW_LEN = 32,
        HEAD_LEN = 6;
      const tipX = VANE_X + adx * VANE_LEN,
        tipY = VANE_Y + ady * VANE_LEN;

      return [-9, 0, 9]
        .map((offset, index) => {
          const startX = tipX + pdx * offset + adx * 2;
          const startY = tipY + pdy * offset + ady * 2;
          const endX = startX + adx * FLOW_LEN;
          const endY = startY + ady * FLOW_LEN;
          const baseX = endX - adx * HEAD_LEN;
          const baseY = endY - ady * HEAD_LEN;
          // bpx/bpy: perpendicular to the arrow direction (for arrowhead wings).
          const bpx = pdy,
            bpy = -pdx;
          const opacity = index === 1 ? 0.9 : 0.5; // centre arrow is brightest
          return `<g opacity="${opacity}">
          <line x1="${startX.toFixed(1)}" y1="${startY.toFixed(1)}"
                x2="${(endX - adx * 2).toFixed(1)}" y2="${(endY - ady * 2).toFixed(1)}"
            stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="4,3"/>
          <path d="M${(baseX + bpx * HEAD_LEN * 0.55).toFixed(1)},${(baseY + bpy * HEAD_LEN * 0.55).toFixed(1)}
                   L${endX.toFixed(1)},${endY.toFixed(1)}
                   L${(baseX - bpx * HEAD_LEN * 0.55).toFixed(1)},${(baseY - bpy * HEAD_LEN * 0.55).toFixed(1)}"
            fill="#4fc3f7"/>
        </g>`;
        })
        .join("");
    };

    let vaneHtml = "";

    if (isSwing) {
      // ── Swing: SMIL triangle-wave animation ──────────────────────────────
      const MIN_ANGLE = 10,
        MAX_ANGLE = 65,
        STEPS = 80,
        CYCLE_DURATION = 3.6;
      const currentPhase = ((Date.now() / 1000) % CYCLE_DURATION).toFixed(2);
      const allAngles = [];
      for (let step = 0; step <= STEPS; step++) {
        const normalised = step / STEPS;
        const triangle =
          normalised < 0.5 ? normalised * 2 : (1 - normalised) * 2;
        allAngles.push(MIN_ANGLE + triangle * (MAX_ANGLE - MIN_ANGLE));
      }
      const keyTimes = allAngles
        .map((_, i) => (i / STEPS).toFixed(4))
        .join(";");
      // Negative rotation values because SVG rotates clockwise; we want the tip to sweep downward.
      const rotateValues = allAngles
        .map((angle) => `-${angle} ${VANE_X} ${VANE_Y}`)
        .join(";");
      const [startX, startY] = vaneEndpoint(MIN_ANGLE);
      vaneHtml = `
        <line x1="${VANE_X}" y1="${VANE_Y}" x2="${startX.toFixed(1)}" y2="${startY.toFixed(1)}"
            stroke="#bbb" stroke-width="5" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate"
            values="${rotateValues}" keyTimes="${keyTimes}"
            dur="${CYCLE_DURATION}s" repeatCount="indefinite" begin="-${currentPhase}s" calcMode="linear"/>
        </line>`;
    } else {
      // ── Fixed: render at current JS-animated angle ────────────────────────
      const displayAngle = this._vAngle ?? vposition.angle;
      const [vEndX, vEndY] = vaneEndpoint(displayAngle);
      vaneHtml =
        `<line x1="${VANE_X}" y1="${VANE_Y}" x2="${vEndX.toFixed(1)}" y2="${vEndY.toFixed(1)}"
            stroke="#bbb" stroke-width="5" stroke-linecap="round"/>` +
        drawFlowArrows(displayAngle);
    }

    // Small tick marks along the bottom edge of the AC body (decorative).
    const ticks = Array.from(
      { length: 6 },
      (_, index) =>
        `<line x1="${BOX_X + 8 + index * 10}" y1="${BOX_Y + BOX_H}" x2="${BOX_X + 8 + index * 10}" y2="${BOX_Y + BOX_H + 5}" stroke="#3a3a4a" stroke-width="1.5"/>`,
    ).join("");

    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;">
      <rect x="${BOX_X}" y="${BOX_Y}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="#25252f" stroke="#3a3a4a" stroke-width="1"/>
      ${ticks}
      <line x1="${BOX_X}" y1="${BOX_Y + 3}" x2="${BOX_X}" y2="${BOX_Y + BOX_H - 3}" stroke="#4a4a5a" stroke-width="2.5"/>
      <circle cx="${BOX_X + BOX_W - 10}" cy="${BOX_Y + 8}" r="4" fill="${this._isOn() ? "#4caf50" : "#444"}" opacity="0.9"/>
      ${vaneHtml}
    </svg>`;
  }

  // ─── Button builders ───────────────────────────────────────────────────────

  _modeButtonsHtml(currentMode) {
    return Object.entries(MODES)
      .map(([modeKey, { label, icon }]) => {
        const iconHtml =
          modeKey === "off"
            ? POWER_SVG
            : `<span class="mode-icon">${icon}</span>`;
        return `
        <button class="mode-btn ${modeKey === currentMode ? "active" : ""}" data-mode="${modeKey}" title="${label}">
          ${iconHtml}
          <span class="mode-label">${label}</span>
        </button>`;
      })
      .join("");
  }

  _fanButtonsHtml(currentFanMode) {
    return ["auto", "1", "2", "3", "4"]
      .map(
        (fanSpeed) => `
      <button class="fan-btn ${fanSpeed === currentFanMode ? "active" : ""}" data-fan="${fanSpeed}"
        title="${fanSpeed === "auto" ? "Auto" : `Speed ${fanSpeed}`}">
        ${fanSpeed === "auto" ? this._t("fan_auto") : fanSpeed}
      </button>`,
      )
      .join("");
  }

  _verticalVaneButtonsHtml(currentVSwing) {
    return V_POSITIONS.map((vpos) => {
      const isActive = vpos.value === currentVSwing;
      const isSwing = vpos.value === "swing";
      let iconHtml;

      if (isSwing) {
        // Up-down chevrons to indicate oscillation.
        iconHtml = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 10l5-5 5 5H7zm10 4l-5 5-5-5h10z" fill="currentColor"/>
        </svg>`;
      } else {
        // Arrow pointing at the vane angle.
        const angleRad = (vpos.angle * Math.PI) / 180;
        const originX = 20,
          originY = 5,
          LEN = 15,
          HEAD = 5;
        const adx = -Math.cos(angleRad),
          ady = Math.sin(angleRad);
        const pdx = -Math.sin(angleRad),
          pdy = -Math.cos(angleRad);
        const endX = originX + adx * LEN,
          endY = originY + ady * LEN;
        const baseX = endX - adx * HEAD,
          baseY = endY - ady * HEAD;
        iconHtml = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
          <line x1="${originX}" y1="${originY}" x2="${(endX + adx * 2).toFixed(1)}" y2="${(endY + ady * 2).toFixed(1)}"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M${(baseX - pdx * HEAD * 0.6).toFixed(1)},${(baseY - pdy * HEAD * 0.6).toFixed(1)}
                   L${endX.toFixed(1)},${endY.toFixed(1)}
                   L${(baseX + pdx * HEAD * 0.6).toFixed(1)},${(baseY + pdy * HEAD * 0.6).toFixed(1)}"
            fill="currentColor"/>
        </svg>`;
      }

      return `<button class="vane-btn ${isActive ? "active" : ""}" data-vswing="${vpos.value}" title="${vpos.label}">
          ${iconHtml}
        </button>`;
    }).join("");
  }

  _horizontalVaneButtonsHtml(currentHSwing) {
    return H_POSITIONS.map(
      (hpos) => `
      <button class="vane-btn h-vane-btn ${hpos.value === currentHSwing ? "active" : ""}"
        data-hswing="${hpos.value}" title="${hpos.desc}">
        ${this._hSectionSvg(hpos.sides, hpos.value === currentHSwing)}
      </button>`,
    ).join("");
  }

  /**
   * Build a small top-down SVG icon for a horizontal vane button.
   * Shows an AC body outline and directional arrows for each louver section.
   */
  _hSectionSvg(sides, isActive = false) {
    const SVG_W = 36,
      SVG_H = 32;
    const arrowColor = isActive ? "#4fc3f7" : "#666";
    const midX = SVG_W / 2;
    const bodyTop = 4,
      bodyHeight = 9;
    const arrowRootY = bodyTop + bodyHeight;

    const bodyHtml = `
      <rect x="2" y="${bodyTop}" width="${SVG_W - 4}" height="${bodyHeight}" rx="3"
        fill="#25252f" stroke="${arrowColor}" stroke-width="1" opacity="0.7"/>
      <line x1="${midX}" y1="${bodyTop + 2}" x2="${midX}" y2="${arrowRootY - 2}"
        stroke="${arrowColor}" stroke-width="1" opacity="0.5"/>`;

    if (sides === null) {
      // Swing indicator: two horizontal arrows pointing outward with a centre dot.
      return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
        ${bodyHtml}
        <path d="M4,${arrowRootY + 9} l4,-3 v2 h4 v2 h-4 v2 z" fill="${arrowColor}"/>
        <path d="M32,${arrowRootY + 9} l-4,-3 v2 h-4 v2 h4 v2 z" fill="${arrowColor}"/>
        <circle cx="${midX}" cy="${arrowRootY + 9}" r="1.5" fill="${arrowColor}" opacity="0.6"/>
      </svg>`;
    }

    const drawSectionArrow = (arrowX, direction) => {
      if (!direction) return "";
      const ARROW_LEN = 11,
        HEAD_LEN = 4;
      const angleDeg = H_DIR_ANGLE[direction];
      const angleRad = (angleDeg * Math.PI) / 180;
      const adx = Math.sin(angleRad),
        ady = Math.cos(angleRad);
      const pdx = Math.cos(angleRad),
        pdy = -Math.sin(angleRad);
      const tipX = arrowX + adx * ARROW_LEN,
        tipY = arrowRootY + ady * ARROW_LEN;
      const baseX = tipX - adx * HEAD_LEN,
        baseY = tipY - ady * HEAD_LEN;
      return `
        <line x1="${arrowX}" y1="${arrowRootY}" x2="${(tipX - adx * 2).toFixed(1)}" y2="${(tipY - ady * 2).toFixed(1)}"
          stroke="${arrowColor}" stroke-width="1.5" stroke-dasharray="3,2"/>
        <path d="M${(baseX - pdx * HEAD_LEN * 0.6).toFixed(1)},${(baseY - pdy * HEAD_LEN * 0.6).toFixed(1)}
                 L${tipX.toFixed(1)},${tipY.toFixed(1)}
                 L${(baseX + pdx * HEAD_LEN * 0.6).toFixed(1)},${(baseY + pdy * HEAD_LEN * 0.6).toFixed(1)}"
          fill="${arrowColor}"/>`;
    };

    const [leftDir, rightDir] = sides;
    return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
      ${bodyHtml}
      ${drawSectionArrow(midX / 2, leftDir)}
      ${drawSectionArrow(midX + midX / 2, rightDir)}
    </svg>`;
  }

  // ─── Presets ───────────────────────────────────────────────────────────────

  _presetKey(isGlobal) {
    return isGlobal
      ? "kzb_presets_global"
      : `kzb_presets_${this._config.entity}`;
  }

  _loadPresets() {
    const parseFromStorage = (key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]");
      } catch {
        return [];
      }
    };
    const globalPresets = parseFromStorage("kzb_presets_global").map(
      (preset) => ({ ...preset, _global: true }),
    );
    const localPresets = parseFromStorage(`kzb_presets_${this._config.entity}`);
    return [...globalPresets, ...localPresets];
  }

  _savePreset(name, isGlobal) {
    if (!name.trim()) return;
    const key = this._presetKey(isGlobal);
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]");
      } catch {
        return [];
      }
    })();
    const preset = {
      name: name.trim(),
      hvac_mode: this._mode(),
      temperature: this._attr("temperature", 22),
      fan_mode: this._attr("fan_mode", "auto"),
      swing_mode: this._attr("swing_mode", "1"),
      swing_horizontal_mode: this._attr("swing_horizontal_mode", "both_center"),
    };
    const existingIndex = existing.findIndex(
      (savedPreset) => savedPreset.name === preset.name,
    );
    if (existingIndex >= 0) existing[existingIndex] = preset;
    else existing.push(preset);
    localStorage.setItem(key, JSON.stringify(existing));
    if (isGlobal) window.dispatchEvent(new CustomEvent("kzb-presets-changed"));
    this._savingPreset = false;
    this._render();
  }

  _deletePreset(name, isGlobal) {
    const key = this._presetKey(isGlobal);
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]");
      } catch {
        return [];
      }
    })();
    localStorage.setItem(
      key,
      JSON.stringify(existing.filter((preset) => preset.name !== name)),
    );
    if (isGlobal) window.dispatchEvent(new CustomEvent("kzb-presets-changed"));
    this._render();
  }

  _applyPreset(preset) {
    const fields = [
      "hvac_mode",
      "temperature",
      "fan_mode",
      "swing_mode",
      "swing_horizontal_mode",
    ];
    fields.forEach((field) => {
      if (preset[field] != null) this._queue(field, preset[field]);
    });
  }

  _presetsHtml() {
    const presets = this._loadPresets();

    const chipsHtml = presets
      .map(
        (preset) => `
      <span class="preset-chip">
        <span class="preset-chip-name" data-preset-apply='${JSON.stringify(preset)}'>
          ${preset.name}${preset._global ? ` <sup>${this._t("global_badge")}</sup>` : ""}
        </span>
        <button class="preset-chip-del"
          data-preset-del="${preset.name}"
          data-preset-global="${preset._global ? "1" : "0"}"
          title="Delete">×</button>
      </span>`,
      )
      .join("");

    const formHtml = this._savingPreset
      ? `
      <div class="preset-form">
        <input type="text" id="preset-name" placeholder="${this._t("preset_name_ph")}" maxlength="24"/>
        <label><input type="radio" name="preset-scope" value="local" checked/> ${this._t("preset_this_ac")}</label>
        <label><input type="radio" name="preset-scope" value="global"/> ${this._t("preset_global")}</label>
        <button class="preset-form-confirm" id="preset-confirm">${this._t("preset_confirm")}</button>
        <button class="preset-form-cancel"  id="preset-cancel">${this._t("preset_cancel")}</button>
      </div>`
      : "";

    return `
      <div class="section-label">${this._t("presets")}</div>
      ${formHtml}
      <div class="preset-row">
        <button class="preset-save-btn" id="preset-save">${this._t("preset_save")}</button>
        ${chipsHtml}
      </div>`;
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;

    const entityState = this._state();
    if (!entityState) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:16px;color:#f44">Entity not found: ${this._config.entity}</ha-card>`;
      return;
    }

    const currentMode = this._mode();
    const isOn = this._isOn();
    const accentColor = MODE_COLORS[currentMode] || "#7b68ee";
    const targetTemp = this._attr("temperature", 22);
    const fanMode = this._attr("fan_mode", "auto");
    const vSwingMode = this._attr("swing_mode", "1");
    const hSwingMode = this._attr("swing_horizontal_mode", "normal");
    const entrustOn = this._attr("preset_mode", "none") === "3d_auto";
    const autoHeating = this._attr("auto_heating"); // 1 = frost protection active
    const isPending = this._isPending();

    const indoorTemp = this._sensorValue(this._config.indoor_sensor);
    const outdoorTemp = this._sensorValue(this._config.outdoor_sensor);

    const tempDisplay = targetTemp.toFixed(1);
    const tempDisabled = !isOn || currentMode === "fan_only";

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
        background: ${isOn ? accentColor : "#333"}; border: none; border-radius: 50%;
        width: 36px; height: 36px; cursor: pointer; color: #fff;
        transition: background 0.3s; display: flex; align-items: center; justify-content: center;
      }
      .pending-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: ${accentColor}; opacity: ${isPending ? 1 : 0};
        transition: opacity 0.3s;
        animation: ${isPending ? "pulse 1s infinite" : "none"};
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
      .mode-btn.active { background: ${accentColor}22; border-color: ${accentColor}; color: ${accentColor}; }
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
      .temp-value { font-size: 42px; font-weight: 300; color: ${accentColor}; line-height: 1; text-align: center; }
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
      .extras-row { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
      .entrust-btn {
        background: ${entrustOn ? "#7b68ee33" : "#2a2a3a"}; border: 1px solid ${entrustOn ? "#7b68ee" : "#333"};
        border-radius: 8px; padding: 7px 12px; cursor: pointer;
        color: ${entrustOn ? "#7b68ee" : "#666"}; font-size: 12px; font-family: inherit;
        transition: background 0.2s, border-color 0.2s, color 0.2s;
      }
      .frost-badge {
        background: #1a3a5c; border: 1px solid #4fc3f7;
        border-radius: 8px; padding: 5px 10px;
        color: #4fc3f7; font-size: 12px; pointer-events: none;
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
      .preset-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; align-items: center; }
      .preset-save-btn {
        background: #2a2a3a; border: 1px dashed #444; border-radius: 8px;
        padding: 5px 10px; cursor: pointer; color: #666; font-size: 12px; font-family: inherit;
        transition: border-color 0.2s, color 0.2s;
      }
      .preset-save-btn:hover { border-color: #7b68ee; color: #7b68ee; }
      .preset-chip {
        display: flex; align-items: center; gap: 4px;
        background: #2a2a3a; border: 1px solid #3a3a4a; border-radius: 8px;
        padding: 5px 8px; font-size: 12px; font-family: inherit; color: #bbb;
      }
      .preset-chip-name { cursor: pointer; transition: color 0.2s; }
      .preset-chip-name:hover { color: #7b68ee; }
      .preset-chip-del {
        background: none; border: none; color: #444; cursor: pointer;
        font-size: 14px; line-height: 1; padding: 0 2px; font-family: inherit;
        transition: color 0.2s;
      }
      .preset-chip-del:hover { color: #f44; }
      .preset-form {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
        background: #25252f; border: 1px solid #3a3a4a; border-radius: 10px;
        padding: 8px 10px; margin-bottom: 8px;
      }
      .preset-form input[type=text] {
        background: #1c1c28; border: 1px solid #3a3a4a; border-radius: 6px;
        color: #e0e0e0; font-size: 12px; font-family: inherit;
        padding: 4px 8px; outline: none; flex: 1; min-width: 80px;
      }
      .preset-form label { font-size: 12px; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; }
      .preset-form-confirm {
        background: #7b68ee33; border: 1px solid #7b68ee; border-radius: 6px;
        color: #7b68ee; font-size: 12px; font-family: inherit;
        padding: 4px 10px; cursor: pointer;
      }
      .preset-form-cancel {
        background: none; border: 1px solid #333; border-radius: 6px;
        color: #555; font-size: 12px; font-family: inherit;
        padding: 4px 8px; cursor: pointer;
      }
    `;

    const html = `
      <style>${css}</style>
      <ha-card>
        <div class="header">
          <div class="title">${entityState.attributes.friendly_name || this._config.entity}</div>
          <div class="header-right">
            <div class="pending-dot" title="${isPending ? this._t("updating") : ""}"></div>
            <button class="power-btn" id="pwr" title="${isOn ? this._t("turn_off") : this._t("turn_on")}">${POWER_SVG}</button>
          </div>
        </div>
        <div class="body">

          <div class="section-label">${this._t("mode")}</div>
          <div class="mode-row">${this._modeButtonsHtml(currentMode)}</div>

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
              <div class="section-label">${this._t("front_view")}</div>
              ${this._frontViewSvg(hSwingMode)}
            </div>
            <div class="vane-panel">
              <div class="section-label">${this._t("side_view")}</div>
              ${this._sideViewSvg(vSwingMode)}
            </div>
          </div>

          <div class="section-label">${this._t("vertical_vane")}</div>
          <div class="vane-row">${this._verticalVaneButtonsHtml(vSwingMode)}</div>

          <div class="section-label">${this._t("horizontal_vane")}</div>
          <div class="vane-row">${this._horizontalVaneButtonsHtml(hSwingMode)}</div>

          <div class="section-label">${this._t("fan_speed")}</div>
          <div class="fan-row">${this._fanButtonsHtml(fanMode)}</div>

          <div class="extras-row">
            <button class="entrust-btn" id="entrust" title="3D Auto — unit picks best airflow">
              ✦ ${this._t("entrust_3d_auto")}${entrustOn ? " ON" : ""}
            </button>
            ${autoHeating ? `<span class="frost-badge" title="${this._t("frost_protection")}">❄ ${this._t("frost_protection")}</span>` : ""}
          </div>

          ${this._presetsHtml()}

          ${
            indoorTemp !== null || outdoorTemp !== null
              ? `
          <div class="sensor-row">
            ${
              indoorTemp !== null
                ? `<div class="sensor-chip">
              <div class="s-label">${this._t("indoor")}</div>
              <div class="s-val">${indoorTemp.toFixed(1)}</div>
              <div class="s-unit">°C</div>
            </div>`
                : ""
            }
            ${
              outdoorTemp !== null
                ? `<div class="sensor-chip">
              <div class="s-label">${this._t("outdoor")}</div>
              <div class="s-val">${outdoorTemp.toFixed(1)}</div>
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

  // ─── Event listeners ───────────────────────────────────────────────────────

  _attachListeners() {
    const root = this.shadowRoot;

    // Header controls
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

    // Mode, vane and fan buttons
    root
      .querySelectorAll(".mode-btn")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this._setMode(button.dataset.mode),
        ),
      );
    root
      .querySelectorAll("[data-vswing]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this._setSwing(button.dataset.vswing),
        ),
      );
    root
      .querySelectorAll("[data-hswing]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this._setHSwing(button.dataset.hswing),
        ),
      );
    root
      .querySelectorAll(".fan-btn")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this._setFan(button.dataset.fan),
        ),
      );

    // Preset controls
    root.getElementById("preset-save")?.addEventListener("click", () => {
      this._savingPreset = !this._savingPreset;
      this._render();
    });

    root.getElementById("preset-confirm")?.addEventListener("click", () => {
      const name = root.getElementById("preset-name")?.value || "";
      const isGlobal =
        root.querySelector("input[name=preset-scope]:checked")?.value ===
        "global";
      this._savePreset(name, isGlobal);
    });

    root.getElementById("preset-cancel")?.addEventListener("click", () => {
      this._savingPreset = false;
      this._render();
    });

    root.querySelectorAll("[data-preset-apply]").forEach((element) =>
      element.addEventListener("click", () => {
        try {
          this._applyPreset(JSON.parse(element.dataset.presetApply));
        } catch {}
      }),
    );

    root.querySelectorAll("[data-preset-del]").forEach((button) =>
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._deletePreset(
          button.dataset.presetDel,
          button.dataset.presetGlobal === "1",
        );
      }),
    );
  }
}

customElements.define("kazembridge-card", KazemBridgeCard);
