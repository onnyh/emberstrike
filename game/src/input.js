// Keyboard and pointer-lock mouse, in one place. The rest of the game reads a
// plain state object: held keys, accumulated mouse movement (consumed each tick),
// whether the trigger is held, and one-shot key presses for menus and actions.
// The demo autopilot writes the same shape, so the player controller cannot
// tell a human from the autopilot — which is what makes demo runs honest tests.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = {
    keys,
    lookX: 0,
    lookY: 0,
    firing: false,
    aiming: false,
    locked: false,
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    wasPressed(code) {
      if (pressed.has(code)) { pressed.delete(code); return true; }
      return false;
    },
    clearPressed() { pressed.clear(); },
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.aiming = false; });

  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) { state.firing = false; state.aiming = false; }
    if (onLockChange) onLockChange(state.locked);
  });

  state.requestLock = () => canvas.requestPointerLock();
  return state;
}
