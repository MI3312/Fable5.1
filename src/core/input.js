// Keyboard / mouse input with pointer lock and edge-triggered key presses.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0, clicked: new Set(), x: 0, y: 0 };
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;
    this.onLockChange = null;
    this.avgMove = 4;
    this.settleUntil = 0;
    this.spikes = 0;
    this.lastSpike = -1e9;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'F1', 'KeyF'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= (1 << e.button);
      this.mouse.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) {
        // Browsers occasionally report one bogus, enormous movement (pointer-lock re-entry, cursor
        // warping at the window edge, frame hitches on some drivers). That's what whips the view
        // round; throw such spikes away instead of turning the camera.
        const mx = e.movementX || 0, my = e.movementY || 0;
        const mag = Math.hypot(mx, my);
        const now = performance.now();
        if (now < this.settleUntil) return;
        // a genuine fast swipe arrives as a run of large events; a glitch is a lone one
        if (mag > 220 && mag > this.avgMove * 14 + 60 && now - this.lastSpike > 60) { this.lastSpike = now; this.spikes++; return; }
        this.avgMove += (mag - this.avgMove) * 0.12;
        this.mouse.dx += mx;
        this.mouse.dy += my;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // the first events after (re)locking carry the jump from wherever the cursor was
      this.settleUntil = performance.now() + 90;
      this.mouse.dx = 0; this.mouse.dy = 0;
      if (!this.locked) { this.mouse.buttons = 0; this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      // raw (unaccelerated) movement where the browser supports it - it also sidesteps the
      // Chromium spike bug; fall back to a plain lock when it's refused
      const plain = () => {
        try {
          const p = this.canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignore */ }
      };
      if (this.rawOk === false) { plain(); return; }
      try {
        const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') { this.rawOk = false; plain(); } });
        else if (!p) this.rawOk = false;
      } catch (e) { this.rawOk = false; plain(); }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  rawHit(code) { return this.pressed.has(code); }
  mouseDown(btn) { return this.enabled && (this.mouse.buttons & (1 << btn)) !== 0; }
  mouseHit(btn) { return this.enabled && this.mouse.clicked.has(btn); }

  consumeMouse() {
    const dx = this.mouse.dx * this.sensitivity, dy = this.mouse.dy * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouse.dx = 0; this.mouse.dy = 0;
    return [dx, dy];
  }

  consumeWheel() {
    const w = this.mouse.wheel;
    this.mouse.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.clicked.clear();
  }
}
