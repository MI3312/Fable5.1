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
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.buttons = 0; this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
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
