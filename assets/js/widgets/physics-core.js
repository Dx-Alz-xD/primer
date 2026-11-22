/* =====================================================================
   The physics sandbox in lessons: the checker, the scenes and the 2D
   engine, shared by the server (server/widgets/physics.mjs checks every
   scene the AI writes, and that each task can be done) and the page
   (assets/js/widgets/physics.js draws it live and checks the learner's
   tasks). The server imports this file; the page loads it with a script
   element (window.PrimerPhysics).

   The engine: a fixed step of 1/120 s; balls and boxes that turn; static
   ground, walls and ramps; gravity; air drag (quadratic, 1/2 rho Cd A v^2,
   or linear, b v), solved implicitly so terminal velocity is exact;
   contacts with restitution and static and kinetic friction, by
   sequential impulses with warm starting (after Box2D); springs (Hooke,
   with damping); ropes and rods; buoyancy in a fluid; bricks held by
   mortar that give way when an impact's force passes their strength.
   Only + - * / and sqrt are used while it runs (sin and cos are worked
   out here, not by Math), so the same scene gives the same numbers in
   Node and in every browser.

   A scene (the "spec"), after normSpec:
     scene    drop | projectile | collision | ramp | push | spring |
              pendulum | wall | float | free
     g, air   gravity (m/s^2) and air density (kg/m^3)
     ...      the scene's own numbers (angle, speed, height, k, ...)
     bodies   [{ id, shape: ball|box, r | size, mass, e, mu, mus, cd, ... }]
     show     the readouts in the panel; graph: what it plots against time
     sliders  [{ var: "angle" | "A.mass", min, max, step }]
   A task's goal, after normTask:
     { type: land, body, x: [a, b] }
     { type: value, body, of, value, tol } or { ..., min, max } (and "at")
     { type: stop, body } | { type: break, target, breaks } |
     { type: slide, body, moves } | { type: float, body, floats }
     solve: { v: {...} }   a setting of the sliders that does it (found here)
   The learner's attempt ("value"): { v: { angle: 40, "A.mass": 2 } }
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerPhysics = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DT = 1 / 120;
  const MARGIN = 0.005; // contacts are found this far apart, so a body that is about to touch is stopped in time
  const LIMITS = { bodies: 40, sliders: 4, steps: 60, combos: 1500, budget: 3e6, labels: 6, tmax: 60 };
  const PLANETS = { earth: 9.8, moon: 1.62, mars: 3.71, jupiter: 24.8, venus: 8.87, mercury: 3.7, space: 0, none: 0 };
  const COLORS = ['red', 'blue', 'green', 'gold', 'grey', 'brown', 'purple', 'ink'];
  const SCENES = ['drop', 'projectile', 'collision', 'ramp', 'push', 'spring', 'pendulum', 'wall', 'float', 'free'];

  class PhysicsError extends Error {}
  const fail = (msg) => { throw new PhysicsError(msg); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const ID = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
  const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const show = (v) => String(v).replace(/[^\w .:+-]/g, '').slice(0, 24);
  const round = (x) => Number(Number(x).toPrecision(9));
  const sig = (x) => String(Number(Number(x).toPrecision(3)));

  /* ---------------- numbers that come out the same everywhere ---------------- */

  const PI = 3.141592653589793, TAU = 2 * PI, HALF = PI / 2;
  // sine by its series, after bringing the angle into [-pi/2, pi/2]: only + - * /, so every engine agrees
  function dsin(x) {
    x -= Math.round(x / TAU) * TAU;
    if (x > HALF) x = PI - x; else if (x < -HALF) x = -PI - x;
    const x2 = x * x;
    return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 / 355687428096000))))))));
  }
  const dcos = (x) => dsin(x + HALF);
  const rad = (deg) => deg * PI / 180;
  const sqrt = Math.sqrt, abs = Math.abs, mn = Math.min, mx = Math.max;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const len2 = (x, y) => sqrt(x * x + y * y);

  // 9.8, "9.8", "20 m/s", "45°", "9.8 m/s^2"
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || v.length > 40) return NaN;
    const m = /^\s*([-+−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:[a-zA-Z°%/²³·^*.\s0-9-]{0,16})$/.exec(v);
    return m ? Number(m[1].replace('−', '-')) : NaN;
  }
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;
  function pick(raw, keys) { for (const k of keys) if (has(raw, k)) return raw[k]; return undefined; }
  // a number from the spec, in its range, or its default
  function pnum(raw, keys, lo, hi, dflt, what, unit) {
    const v0 = pick(raw, keys);
    if (v0 === undefined) { if (dflt === undefined) fail(`${what} is missing`); return dflt; }
    const v = num(v0);
    if (!Number.isFinite(v)) fail(`${what} must be a number (got "${show(v0)}")`);
    if (v < lo || v > hi) fail(`${what} ${sig(v)} is outside ${lo} to ${hi}${unit ? ' ' + unit : ''}`);
    return round(v);
  }
  function pbool(v, dflt) {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === 0) return v === 1;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', 'yes', 'on', '1'].includes(s)) return true;
      if (['false', 'no', 'off', '0', 'none'].includes(s)) return false;
    }
    return dflt;
  }
  function pair(v, what, lo, hi) {
    const p = Array.isArray(v) ? v : isObj(v) ? [v.x, v.y] : null;
    if (!p || p.length < 2) fail(`${what} needs [x, y]`);
    const x = num(p[0]), y = num(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${what} needs two numbers [x, y]`);
    if (x < lo || x > hi || y < lo || y > hi) fail(`${what} [${sig(x)}, ${sig(y)}] is outside ${lo} to ${hi} m`);
    return [round(x), round(y)];
  }

  /* ---------------- what can change: the variables a slider can move ---------------- */

  // [lowest, highest, unit, applied live (true) or by starting again]
  const BODY_VARS = {
    mass: [0.001, 1000, 'kg', true], cd: [0, 2, '', true], area: [1e-4, 100, 'm²', true], b: [0, 1000, 'N·s/m', true],
    e: [0, 1, '', true], mu: [0, 1.5, '', true], r: [0.01, 5, 'm', false], v: [-50, 50, 'm/s', false],
    density: [10, 20000, 'kg/m³', true], length: [0.1, 30, 'm', false], angle: [1, 170, '°', false]
  };
  const SCENE_VARS = {
    common: { g: [0, 30, 'm/s²', true], air: [0, 5, 'kg/m³', true] },
    drop: { height: [0.1, 1000, 'm', false] },
    projectile: { angle: [0, 90, '°', false], speed: [0.5, 100, 'm/s', false], height: [0, 200, 'm', false] },
    collision: { e: [0, 1, '', true] },
    ramp: { angle: [5, 60, '°', false], length: [1, 30, 'm', false], force: [-5000, 5000, 'N', true], mu: [0, 1.5, '', true] },
    push: { force: [0, 10000, 'N', true], time: [0.1, 60, 's', false], mu: [0, 1.5, '', true] },
    spring: { k: [0.5, 20000, 'N/m', true], damping: [0, 500, 'N·s/m', true], length: [0.1, 5, 'm', false], pull: [-2, 2, 'm', false] },
    pendulum: { length: [0.1, 30, 'm', false], angle: [1, 170, '°', false] },
    wall: { speed: [0.5, 60, 'm/s', false], strength: [1, 1e6, 'N', true], distance: [1, 30, 'm', false], pad: [0, 1, 's', true] },
    float: { density: [1, 3000, 'kg/m³', true], depth: [0.3, 5, 'm', false] },
    free: {}
  };
  const sceneVar = (scene, name) => (SCENE_VARS[scene] && SCENE_VARS[scene][name]) || SCENE_VARS.common[name] || null;
  // the body variables each scene lets a slider move
  const BODY_VARS_IN = {
    drop: ['mass', 'cd', 'area', 'b', 'r'], projectile: ['mass', 'cd', 'area', 'b', 'r'], collision: ['mass', 'v', 'e'],
    ramp: ['mass', 'mu'], push: ['mass', 'mu'], spring: ['mass'], pendulum: ['mass', 'length', 'angle', 'cd'],
    wall: ['mass', 'r'], float: ['mass', 'density'], free: ['mass', 'cd', 'area', 'b', 'e', 'mu', 'r']
  };

  /* ---------------- the scene, checked ---------------- */

  const SHAPES = { ball: 'ball', sphere: 'ball', circle: 'ball', stone: 'ball', marble: 'ball', bob: 'ball', disc: 'ball', disk: 'ball',
    box: 'box', block: 'box', cube: 'box', crate: 'box', cart: 'box', trolley: 'box', brick: 'box', rect: 'box', rectangle: 'box', plank: 'box', square: 'box' };
  const shapeOf = (v, dflt) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return SHAPES[s] || (s ? '' : dflt); };
  const colorOf = (v, i) => { const s = typeof v === 'string' ? v.trim().toLowerCase().replace('gray', 'grey').replace('black', 'ink').replace('yellow', 'gold').replace('orange', 'gold') : ''; return COLORS.includes(s) ? s : COLORS[i % 4]; };

  // a body: its shape, size and what it is made of
  function normBody(rb, i, o) {
    if (!isObj(rb)) fail(`body ${i + 1} is not an object`);
    const id = rb.id != null ? String(rb.id).trim() : 'ABCDEFGH'[i];
    if (!ID.test(id)) fail(`body ${i + 1} needs a short id like A (got "${show(rb.id)}")`);
    const shape = shapeOf(pick(rb, ['shape', 'type', 'kind']), o.shape || 'ball');
    if (!shape) fail(`${id}'s shape "${show(pick(rb, ['shape', 'type']))}" is not ball or box`);
    const out = { id, shape, label: txt(pick(rb, ['label', 'name']), 24), color: colorOf(rb.color != null ? rb.color : rb.colour, i) };
    if (shape === 'ball') {
      if (has(rb, 'r') || has(rb, 'radius')) out.r = pnum(rb, ['r', 'radius'], 0.01, 5, undefined, `${id}'s radius`, 'm');
      else if (has(rb, 'diameter') || (has(rb, 'size') && !Array.isArray(rb.size))) out.r = round(pnum(rb, ['diameter', 'size'], 0.02, 10, undefined, `${id}'s diameter`, 'm') / 2);
      else out.r = o.r || 0.1;
    } else {
      let w, h;
      if (Array.isArray(rb.size)) { w = num(rb.size[0]); h = num(rb.size[1]); }
      else if (has(rb, 'size')) { w = h = num(rb.size); }
      else { w = num(pick(rb, ['w', 'width'])); h = num(pick(rb, ['h', 'height'])); }
      if (!Number.isFinite(w)) w = o.size ? o.size[0] : 0.4;
      if (!Number.isFinite(h)) h = o.size ? o.size[1] : w;
      if (!(w >= 0.02 && w <= 20 && h >= 0.02 && h <= 20)) fail(`${id}'s size [${sig(w)}, ${sig(h)}] is outside 0.02 to 20 m`);
      out.size = [round(w), round(h)];
    }
    const vol = volumeOf(out);
    if (has(rb, 'mass') || has(rb, 'm')) out.mass = pnum(rb, ['mass', 'm'], 0.001, 1000, undefined, `${id}'s mass`, 'kg');
    else if (has(rb, 'density')) out.mass = round(clamp(pnum(rb, ['density'], 10, 20000, undefined, `${id}'s density`, 'kg/m³') * vol, 0.001, 1000));
    else out.mass = o.mass || 1;
    if (has(rb, 'density')) out.density = pnum(rb, ['density'], 10, 20000, undefined, `${id}'s density`, 'kg/m³');
    out.e = pnum(rb, ['e', 'restitution', 'bounce', 'bounciness'], 0, 1, o.e != null ? o.e : 0.5, `${id}'s restitution e`, '');
    out.mu = pnum(rb, ['mu', 'friction', 'muk', 'mu_k'], 0, 1.5, o.mu != null ? o.mu : 0.3, `${id}'s friction coefficient`, '');
    out.mus = pnum(rb, ['mus', 'mu_s', 'static'], 0, 2, mx(out.mu, o.mus != null ? o.mus : out.mu), `${id}'s static friction coefficient`, '');
    if (out.mus < out.mu) out.mus = out.mu;
    const noAir = rb.air === false || rb.drag === false || rb.air === 'none' || rb.drag === 'none';
    out.cd = noAir ? 0 : pnum(rb, ['cd', 'Cd', 'dragCoefficient', 'drag_coefficient'], 0, 2, o.cd != null ? o.cd : 0, `${id}'s drag coefficient Cd`, '');
    if (has(rb, 'area')) out.area = pnum(rb, ['area', 'A'], 1e-4, 100, undefined, `${id}'s area`, 'm²');
    out.b = noAir ? 0 : pnum(rb, ['b', 'linearDrag', 'linear'], 0, 1000, 0, `${id}'s linear drag b`, 'N·s/m');
    return out;
  }
  // the volume a body has, for buoyancy and density: a sphere, or a box as deep as it is wide
  function volumeOf(b) { return b.shape === 'ball' ? 4 / 3 * PI * b.r * b.r * b.r : b.size[0] * b.size[1] * b.size[0]; }
  const areaOf = (b) => (b.area != null ? b.area : b.shape === 'ball' ? PI * b.r * b.r : b.size[0] * b.size[0]);
  const half = (b) => (b.shape === 'ball' ? b.r : b.size[1] / 2);
  const ext = (b) => (b.shape === 'ball' ? b.r : mx(b.size[0], b.size[1]) / 2);

  // a speed given on the first body ({"v": 12}) rather than on the scene
  function ownSpeed(raw, lo, hi, dflt) {
    const list = pick(raw, ['bodies', 'objects', 'balls']);
    const b = Array.isArray(list) ? list[0] : raw.ball || raw.body;
    const v = isObj(b) ? num(pick(b, ['speed', 'v', 'velocity'])) : NaN;
    return Number.isFinite(v) && abs(v) >= lo && abs(v) <= hi ? round(abs(v)) : dflt;
  }
  function bodies(raw, lo, hi, o, scene) {
    let list = pick(raw, ['bodies', 'objects', 'balls']);
    if (list === undefined && o.single !== false && (isObj(raw.body) || isObj(raw.ball) || isObj(raw.block) || isObj(raw.bob))) list = [raw.body || raw.ball || raw.block || raw.bob];
    if (list === undefined) list = o.dflt || [{}];
    if (!Array.isArray(list)) fail('"bodies" is not a list');
    if (list.length < lo || list.length > hi) {
      const n = lo === hi ? (lo === 1 ? 'one body' : `${lo} bodies`) : `${lo} to ${hi} bodies`;
      const instead = { wall: ': to compare a slow and a fast ball, give it a "speed" slider', ramp: ': give it a slider instead', push: ': give it a slider instead', spring: ': give it a slider instead' }[scene] || '';
      fail(`a ${scene} scene has ${n} (got ${list.length})${instead}`);
    }
    const out = list.map((b, i) => normBody(b, i, typeof o.each === 'function' ? o.each(i) : o));
    const ids = new Set();
    out.forEach((b) => { if (ids.has(b.id)) fail(`two bodies are called ${b.id}`); ids.add(b.id); });
    return out;
  }

  const SHOW = ['time', 'position', 'height', 'velocity', 'speed', 'acceleration', 'forces', 'weight', 'drag', 'normal', 'friction', 'spring', 'tension',
    'buoyancy', 'applied', 'net', 'momentum', 'energy', 'ke', 'pe', 'total', 'world', 'extension', 'angle', 'period', 'range', 'maxheight', 'impact',
    'terminal', 'submerged'];
  const SHOW_ALIAS = { t: 'time', pos: 'position', x: 'position', y: 'height', v: 'velocity', vel: 'velocity', a: 'acceleration', accel: 'acceleration',
    force: 'forces', p: 'momentum', kinetic: 'ke', potential: 'pe', gpe: 'pe', 'kinetic energy': 'ke', 'potential energy': 'pe', 'total energy': 'energy',
    'max height': 'maxheight', 'maximum height': 'maxheight', 'terminal velocity': 'terminal', 'net force': 'net', 'normal force': 'normal',
    'spring force': 'spring', 'impact force': 'impact', gravity: 'weight', 'air resistance': 'drag', upthrust: 'buoyancy', system: 'total' };
  const SHOW_DEFAULT = {
    drop: ['time', 'height', 'speed', 'acceleration', 'weight', 'drag', 'net', 'terminal', 'world'],
    projectile: ['time', 'position', 'velocity', 'speed', 'maxheight', 'range', 'energy', 'world'],
    collision: ['velocity', 'momentum', 'ke', 'total'],
    ramp: ['time', 'speed', 'acceleration', 'weight', 'normal', 'friction', 'applied', 'net', 'energy'],
    push: ['time', 'speed', 'acceleration', 'applied', 'friction', 'normal', 'weight', 'net'],
    spring: ['time', 'extension', 'velocity', 'acceleration', 'spring', 'weight', 'net', 'energy', 'period'],
    pendulum: ['time', 'angle', 'speed', 'tension', 'weight', 'net', 'energy', 'period'],
    wall: ['speed', 'momentum', 'ke', 'impact'],
    float: ['weight', 'buoyancy', 'net', 'submerged', 'velocity', 'world'],
    free: ['time', 'position', 'velocity', 'speed', 'acceleration', 'forces', 'momentum', 'energy']
  };
  const GRAPHS = ['speed', 'height', 'x', 'vx', 'vy', 'a', 'ke', 'energy', 'extension', 'angle', 'momentum', 'force', 'none'];
  const GRAPH_ALIAS = { velocity: 'speed', v: 'speed', y: 'height', position: 'x', acceleration: 'a', kinetic: 'ke', p: 'momentum', impact: 'force', 'impact force': 'force', 'contact force': 'force', off: 'none', false: 'none' };
  const GRAPH_DEFAULT = { drop: 'speed', projectile: 'height', collision: 'vx', ramp: 'speed', push: 'speed', spring: 'height', pendulum: 'angle', wall: 'speed', float: 'height', free: 'speed' };

  function gravity(raw) {
    const v = pick(raw, ['g', 'gravity', 'planet', 'world']);
    if (v === undefined) return 9.8;
    if (typeof v === 'string' && PLANETS[v.trim().toLowerCase()] != null) return PLANETS[v.trim().toLowerCase()];
    const g = num(v);
    if (!Number.isFinite(g) || g < 0 || g > 30) fail(`g ${show(v)} is not 0 to 30 m/s² (or earth, moon, mars, jupiter)`);
    return round(g);
  }
  function airOf(raw, dflt) {
    const v = pick(raw, ['air', 'airDensity', 'rho', 'air_density']);
    if (v === undefined) return dflt;
    if (v === true) return 1.2;
    if (v === false || v === 'none' || v === 'vacuum') return 0;
    const a = num(v);
    if (!Number.isFinite(a) || a < 0 || a > 5) fail(`air density ${show(v)} is not 0 to 5 kg/m³`);
    return round(a);
  }

  function normSpec(raw) {
    if (!isObj(raw)) fail('the spec is not an object');
    const sceneRaw = typeof raw.scene === 'string' ? raw.scene.trim().toLowerCase() : 'free';
    const ALIAS = { fall: 'drop', 'free fall': 'drop', freefall: 'drop', parachute: 'drop', launch: 'projectile', cannon: 'projectile', throw: 'projectile',
      collide: 'collision', collisions: 'collision', track: 'collision', incline: 'ramp', slope: 'ramp', 'inclined plane': 'ramp', friction: 'push',
      floor: 'push', springs: 'spring', oscillator: 'spring', swing: 'pendulum', bricks: 'wall', breakable: 'wall', buoyancy: 'float', fluid: 'float', water: 'float', sandbox: 'free', custom: 'free' };
    const scene = SCENES.includes(sceneRaw) ? sceneRaw : ALIAS[sceneRaw] || '';
    if (!scene) fail(`unknown scene "${show(raw.scene)}" (${SCENES.join(', ')})`);
    const s = { scene, g: gravity(raw), air: airOf(raw, scene === 'drop' || scene === 'projectile' ? 1.2 : 0) };
    BUILD[scene].norm(raw, s);
    // what the panel shows, and the graph
    let shw = pick(raw, ['show', 'readouts', 'panel']);
    if (typeof shw === 'string') shw = shw.split(/[,;]/);
    const wanted = Array.isArray(shw) ? shw.map((k) => (typeof k === 'string' ? k.trim().toLowerCase() : '')).map((k) => SHOW_ALIAS[k] || k).filter((k) => SHOW.includes(k)) : [];
    s.show = wanted.length ? [...new Set(wanted)] : SHOW_DEFAULT[scene].slice();
    const gr = typeof raw.graph === 'string' ? raw.graph.trim().toLowerCase() : raw.graph === false ? 'none' : '';
    s.graph = GRAPHS.includes(gr) ? gr : GRAPH_ALIAS[gr] || GRAPH_DEFAULT[scene];
    s.arrows = pbool(raw.arrows, true);
    s.trail = pbool(raw.trail, scene === 'projectile' || scene === 'drop' || scene === 'free' || scene === 'pendulum');
    // a zone on the ground to aim at (land tasks add theirs)
    const tg = isObj(raw.target) ? raw.target : null;
    if (tg) {
      const x = Array.isArray(tg.x) ? tg.x : [tg.from, tg.to];
      const a = num(x[0]), b = num(x[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a && a >= -100 && b <= 2000) s.target = { x: [round(a), round(b)] };
    }
    s.labels = [];
    for (const l of Array.isArray(raw.labels) ? raw.labels.slice(0, LIMITS.labels) : []) {
      if (!isObj(l)) continue;
      const at = Array.isArray(l.at) ? l.at : [l.x, l.y];
      const x = num(at[0]), y = num(at[1]), text = txt(l.text, 40);
      if (text && Number.isFinite(x) && Number.isFinite(y) && abs(x) < 2000 && abs(y) < 2000) s.labels.push({ at: [round(x), round(y)], text });
    }
    s.sliders = normSliders(raw, s);
    checkScene(s);
    return s;
  }

  // a slider's variable, as "angle" or "A.mass"; null if this scene has no such thing
  function canonVar(s, name, body) {
    let n = typeof name === 'string' ? name.trim() : '';
    if (!n) return null;
    let id = typeof body === 'string' ? body.trim() : '';
    const dot = n.indexOf('.');
    if (dot > 0) { id = n.slice(0, dot); n = n.slice(dot + 1); }
    const lower = n.toLowerCase();
    const ALIAS = { gravity: 'g', 'air density': 'air', airdensity: 'air', restitution: 'e', friction: 'mu', 'drag coefficient': 'cd', drag: 'cd', radius: 'r',
      size: 'r', velocity: 'v', 'spring constant': 'k', stiffness: 'k', 'launch angle': 'angle', 'launch speed': 'speed', 'drop height': 'height',
      'push force': 'force', 'applied force': 'force', 'breaking strength': 'strength', 'fluid density': 'density', 'natural length': 'length', 'initial speed': 'v' };
    const v = ALIAS[lower] || (lower === 'cd' ? 'cd' : n === 'Cd' ? 'cd' : lower);
    if (!id && sceneVar(s.scene, v)) return v;
    if ((s.scene === 'wall' || s.scene === 'projectile') && (v === 'v' || v === 'speed')) return 'speed';
    if (!id && s.scene === 'collision' && v === 'e') return 'e';
    if (!BODY_VARS[v] || !(BODY_VARS_IN[s.scene] || []).includes(v)) return null;
    const b = id ? s.bodies.find((x) => x.id === id) : s.bodies[0];
    if (!b) return null;
    if (v === 'r' && b.shape !== 'ball') return null;
    return b.id + '.' + v;
  }
  function varInfo(s, name) {
    const dot = name.indexOf('.');
    if (dot < 0) return sceneVar(s.scene, name);
    return BODY_VARS[name.slice(dot + 1)] || null;
  }
  function getVar(s, name) {
    const dot = name.indexOf('.');
    if (dot < 0) return s[name];
    const b = s.bodies.find((x) => x.id === name.slice(0, dot));
    const k = name.slice(dot + 1);
    if (!b) return undefined;
    if (k === 'area') return areaOf(b);
    if (k === 'density') return b.density != null ? b.density : round(b.mass / volumeOf(b));
    return b[k];
  }
  function setVar(s, name, x) {
    const dot = name.indexOf('.');
    if (dot < 0) { s[name] = x; return; }
    const b = s.bodies.find((y) => y.id === name.slice(0, dot));
    const k = name.slice(dot + 1);
    if (!b) return;
    if (k === 'density') { b.density = x; b.mass = round(clamp(x * volumeOf(b), 0.001, 1000)); return; }
    b[k] = x;
    if (k === 'mu' && b.mus < x) b.mus = x;
  }
  const onSlider = (c, x) => {
    const v = Number.isFinite(x) ? mn(c.max, mx(c.min, x)) : c.min;
    return round(c.min + Math.round((v - c.min) / c.step) * c.step);
  };

  function normSliders(raw, s) {
    let list = pick(raw, ['sliders', 'controls', 'vary']);
    if (list === undefined) return [];
    if (!Array.isArray(list)) fail('"sliders" is not a list');
    const out = [];
    const seen = new Set();
    for (const c of list) {
      if (!isObj(c)) fail('a slider is not an object');
      const asked = pick(c, ['var', 'param', 'name', 'set', 'variable', 'of']);
      const v = canonVar(s, asked, pick(c, ['body', 'object']));
      if (!v) fail(`a slider moves "${show(asked)}", which a ${s.scene} scene has no slider for`);
      if (seen.has(v)) continue;
      seen.add(v);
      const info = varInfo(s, v);
      const lo = num(c.min), hi = num(c.max);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) fail(`the ${v} slider needs a min below its max`);
      if (lo < info[0] || hi > info[1]) fail(`the ${v} slider goes outside ${info[0]} to ${info[1]}${info[2] ? ' ' + info[2] : ''}`);
      let step = c.step != null ? num(c.step) : (hi - lo) / 10;
      if (!Number.isFinite(step) || step <= 0) fail(`the ${v} slider needs a step above 0`);
      const n = Math.floor((hi - lo) / step + 1e-9);
      if (n < 1) fail(`the ${v} slider's step is larger than its range`);
      if (n > LIMITS.steps) fail(`the ${v} slider has ${n} steps; give it at most ${LIMITS.steps}`);
      step = round(step);
      const sl = { var: v, min: round(lo), max: round(lo + n * step), step };
      // the scene starts with the slider where its value is (on one of its steps)
      const cur = getVar(s, v);
      const start = c.value != null && Number.isFinite(num(c.value)) ? num(c.value) : cur;
      setVar(s, v, onSlider(sl, start));
      out.push(sl);
    }
    if (out.length > LIMITS.sliders) fail(`more than ${LIMITS.sliders} sliders`);
    return out;
  }

  // what a block (to explore, with no goal) needs besides holding together, or '': a wall that some setting breaks
  function blockProblem(s) {
    if (s.scene !== 'wall') return '';
    let best = null;
    const all = combos(s);
    const tries = all.count <= 400 ? [...all.all()] : [{}];
    for (const v of tries) {
      const o = withVals(s, v), b = o.bodies[0];
      const F = b.mass * (1 + b.e) * o.speed / mx(DT, o.pad);
      if (!best || F / o.strength > best.r) best = { r: F / o.strength, F, strength: o.strength };
    }
    return best.r < 1.03 ? `nothing here can break the wall: the hardest blow is ${sig(best.F)} N (m(1+e)v / contact time) and it takes ${sig(best.strength)} N; make the ball heavier or faster, or the wall weaker` : '';
  }

  // every combination of slider values: [{ var: value }]
  function combos(s) {
    const dims = s.sliders.map((c) => Math.round((c.max - c.min) / c.step) + 1);
    const count = dims.reduce((a, b) => a * b, 1);
    return {
      count,
      * all() {
        const k = new Array(dims.length).fill(0);
        for (let i = 0; i < count; i++) {
          const v = {};
          s.sliders.forEach((c, j) => { v[c.var] = round(c.min + k[j] * c.step); });
          yield v;
          for (let j = 0; j < dims.length; j++) { if (++k[j] < dims[j]) break; k[j] = 0; }
        }
      }
    };
  }
  const startVals = (s) => { const v = {}; s.sliders.forEach((c) => { v[c.var] = getVar(s, c.var); }); return v; };
  // the spec with these slider values (a fresh copy; the spec itself never changes)
  function withVals(s, vals) {
    const o = JSON.parse(JSON.stringify(s));
    if (vals) for (const c of s.sliders) if (Object.prototype.hasOwnProperty.call(vals, c.var)) setVar(o, c.var, onSlider(c, num(vals[c.var])));
    return o;
  }

  // checks that hold for every slider setting: stiff springs, sizes on the ramp...
  function checkScene(s) {
    const all = combos(s);
    const extremes = [];
    if (all.count <= 64) for (const v of all.all()) extremes.push(v);
    else { // the corners are enough for these checks
      const n = s.sliders.length;
      for (let m = 0; m < (1 << n); m++) { const v = {}; s.sliders.forEach((c, j) => { v[c.var] = m & (1 << j) ? c.max : c.min; }); extremes.push(v); }
    }
    if (!extremes.length) extremes.push({});
    for (const v of extremes) BUILD[s.scene].check(withVals(s, v), v);
    let count = 0;
    const w = build(s, null);
    w.bodies.forEach((b) => { if (!b.isStatic || b.mortar) count++; });
    count += s.bodies.reduce((n, b) => n + (b.break && !b.fixed ? b.break.rows * b.break.cols - 1 : 0), 0);
    if (count > LIMITS.bodies) fail(`the scene has ${count} bodies and pieces; at most ${LIMITS.bodies} keep it smooth on a phone`);
  }

  /* ---------------- the engine ---------------- */

  function newWorld(s) {
    return {
      t: 0, n: 0, g: s.g, air: s.air, scene: s.scene, bodies: [], joints: [], springs: [], fluids: [], ground: 0,
      contacts: new Map(), events: [], slop: 0.005, mouse: null, nextKey: 1, meta: {}, broke: []
    };
  }
  function forces() { return { weight: [0, 0], drag: [0, 0], normal: [0, 0], friction: [0, 0], spring: [0, 0], tension: [0, 0], buoyancy: [0, 0], applied: [0, 0], hand: [0, 0] }; }

  // a body; o: { shape, r | w, h | verts, x, y, a, vx, vy, w, mass, static, ... }
  function addBody(W, o) {
    const b = {
      key: W.nextKey++, id: o.id || '', label: o.label || '', color: o.color || 'red', kind: o.kind || '',
      shape: o.shape === 'ball' ? 'ball' : 'poly', r: 0, n: 0, lx: null, ly: null, lnx: null, lny: null, wx: null, wy: null, nx: null, ny: null,
      hw: 0, hh: 0, m: 0, im: 0, I: 0, iI: 0, x: o.x, y: o.y, a: o.a || 0, c: 1, s: 0,
      vx: o.vx || 0, vy: o.vy || 0, w: o.spin || 0,
      e: o.e != null ? o.e : 0.5, mu: o.mu != null ? o.mu : 0.3, mus: o.mus != null ? o.mus : (o.mu != null ? o.mu : 0.3),
      cd: o.cd || 0, area: o.area || 0, b: o.b || 0, fx: o.fx || 0, fy: o.fy || 0, until: o.until != null ? o.until : Infinity,
      isStatic: Boolean(o.isStatic), rail: o.rail != null ? o.rail : null, group: o.group || 0, noRot: Boolean(o.noRot),
      mortar: o.mortar || 0, wallId: o.wallId || '', brk: o.brk || null, volume: o.volume || 0, rest: o.rest || 0, dead: false,
      F: forces(), ax: 0, ay: 0, v0x: o.vx || 0, v0y: o.vy || 0, w0: o.spin || 0, preX: o.vx || 0, preY: o.vy || 0, blow: 0, onGround: null, touch: false, airT: 0, landed: false, toi: null, px: o.x, py: o.y,
      impact: 0, maxY: -Infinity, path: 0, lastHit: null, sub: 0, home: null, ground: false
    };
    if (b.shape === 'ball') b.r = o.r;
    else {
      let vx, vy;
      if (o.verts) { vx = o.verts.map((p) => p[0]); vy = o.verts.map((p) => p[1]); }
      else { b.hw = o.w / 2; b.hh = o.h / 2; vx = [-b.hw, b.hw, b.hw, -b.hw]; vy = [-b.hh, -b.hh, b.hh, b.hh]; }
      b.n = vx.length; b.lx = vx; b.ly = vy; b.lnx = []; b.lny = [];
      for (let i = 0; i < b.n; i++) {
        const j = (i + 1) % b.n, ex = vx[j] - vx[i], ey = vy[j] - vy[i], L = len2(ex, ey);
        b.lnx.push(ey / L); b.lny.push(-ex / L);
      }
      b.wx = new Array(b.n); b.wy = new Array(b.n); b.nx = new Array(b.n); b.ny = new Array(b.n);
    }
    if (!b.isStatic) setMass(b, o.mass);
    if (!b.volume) b.volume = b.shape === 'ball' ? 4 / 3 * PI * b.r * b.r * b.r : (2 * b.hw) * (2 * b.hh) * (2 * b.hw);
    if (!b.rest) b.rest = b.shape === 'ball' ? b.r : b.hh;
    b.c = dcos(b.a); b.s = dsin(b.a);
    sync(b);
    W.bodies.push(b);
    return b;
  }
  function setMass(b, m) {
    b.m = m; b.im = 1 / m;
    b.I = b.shape === 'ball' ? 0.4 * m * b.r * b.r : m * ((2 * b.hw) * (2 * b.hw) + (2 * b.hh) * (2 * b.hh)) / 12;
    b.iI = b.noRot || b.rail != null ? 0 : 1 / b.I;
  }
  function makeStatic(b) { b.isStatic = true; b.m = 0; b.im = 0; b.I = 0; b.iI = 0; b.vx = b.vy = b.w = 0; }
  // world vertices, normals and the box around it
  function sync(b) {
    if (b.shape === 'ball') { b.minx = b.x - b.r; b.maxx = b.x + b.r; b.miny = b.y - b.r; b.maxy = b.y + b.r; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < b.n; i++) {
      const x = b.x + b.c * b.lx[i] - b.s * b.ly[i], y = b.y + b.s * b.lx[i] + b.c * b.ly[i];
      b.wx[i] = x; b.wy[i] = y;
      b.nx[i] = b.c * b.lnx[i] - b.s * b.lny[i]; b.ny[i] = b.s * b.lnx[i] + b.c * b.lny[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    b.minx = x0; b.maxx = x1; b.miny = y0; b.maxy = y1;
  }
  const rotate = (b) => { b.c = dcos(b.a); b.s = dsin(b.a); };
  // the lowest point of a body, for its height above the ground
  const bottom = (b) => (b.shape === 'ball' ? b.y - b.r : b.miny);

  /* ----- contacts ----- */

  // circle against circle
  function collideCircles(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y, R = A.r + B.r, d2 = dx * dx + dy * dy;
    if (d2 > (R + MARGIN) * (R + MARGIN)) return null;
    const d = sqrt(d2);
    const nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : 1;
    const sep = d - R;
    return { nx, ny, pts: [{ x: A.x + nx * (A.r + sep / 2), y: A.y + ny * (A.r + sep / 2), sep, id: 0, type: 0 }] };
  }
  // polygon P (A) against circle C (B); the normal points from P to C
  function collidePolyCircle(P, C) {
    const dx = C.x - P.x, dy = C.y - P.y;
    const cx = P.c * dx + P.s * dy, cy = -P.s * dx + P.c * dy; // the centre in P's frame
    let best = -Infinity, bi = 0;
    for (let i = 0; i < P.n; i++) {
      const s = P.lnx[i] * (cx - P.lx[i]) + P.lny[i] * (cy - P.ly[i]);
      if (s > C.r + MARGIN) return null;
      if (s > best) { best = s; bi = i; }
    }
    const i1 = bi, i2 = (bi + 1) % P.n;
    const v1x = P.lx[i1], v1y = P.ly[i1], v2x = P.lx[i2], v2y = P.ly[i2];
    let lnx, lny, lpx, lpy, sep;
    if (best < 1e-9) { lnx = P.lnx[i1]; lny = P.lny[i1]; lpx = (v1x + v2x) / 2; lpy = (v1y + v2y) / 2; sep = best - C.r; }
    else {
      const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y), u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
      if (u1 <= 0 || u2 <= 0) {
        const vx = u1 <= 0 ? v1x : v2x, vy = u1 <= 0 ? v1y : v2y;
        const ex = cx - vx, ey = cy - vy, d2 = ex * ex + ey * ey;
        if (d2 > (C.r + MARGIN) * (C.r + MARGIN)) return null;
        const d = sqrt(d2) || 1e-9;
        lnx = ex / d; lny = ey / d; lpx = vx; lpy = vy; sep = d - C.r;
      } else { lnx = P.lnx[i1]; lny = P.lny[i1]; lpx = (v1x + v2x) / 2; lpy = (v1y + v2y) / 2; sep = best - C.r; }
    }
    const nx = P.c * lnx - P.s * lny, ny = P.s * lnx + P.c * lny;
    return { nx, ny, pts: [{ x: C.x - nx * (C.r + sep / 2), y: C.y - ny * (C.r + sep / 2), sep, id: bi, type: 1, lnx, lny, lpx, lpy, ipx: 0, ipy: 0, rad: C.r }] };
  }
  function maxSep(A, B) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < A.n; i++) {
      const nx = A.nx[i], ny = A.ny[i], vx = A.wx[i], vy = A.wy[i];
      let si = Infinity;
      for (let j = 0; j < B.n; j++) { const d = nx * (B.wx[j] - vx) + ny * (B.wy[j] - vy); if (d < si) si = d; }
      if (si > best) { best = si; bi = i; }
    }
    return [best, bi];
  }
  // polygon against polygon: the reference face and the incident edge clipped to it (up to two points)
  function collidePolys(A, B, slop) {
    const [sA, eA] = maxSep(A, B); if (sA > MARGIN) return null;
    const [sB, eB] = maxSep(B, A); if (sB > MARGIN) return null;
    let ref, inc, edge, flip;
    if (sB > sA + 0.1 * slop) { ref = B; inc = A; edge = eB; flip = 1; } else { ref = A; inc = B; edge = eA; flip = 0; }
    const nx = ref.nx[edge], ny = ref.ny[edge];
    let ie = 0, md = Infinity;
    for (let i = 0; i < inc.n; i++) { const d = nx * inc.nx[i] + ny * inc.ny[i]; if (d < md) { md = d; ie = i; } }
    const j1 = ie, j2 = (ie + 1) % inc.n;
    let pts = [{ x: inc.wx[j1], y: inc.wy[j1], v: j1 }, { x: inc.wx[j2], y: inc.wy[j2], v: j2 }];
    const v1 = edge, v2 = (edge + 1) % ref.n;
    const ax = ref.wx[v1], ay = ref.wy[v1], bx = ref.wx[v2], by = ref.wy[v2];
    let tx = bx - ax, ty = by - ay; const L = len2(tx, ty); tx /= L; ty /= L;
    pts = clip(pts, -tx, -ty, -(tx * ax + ty * ay));
    if (pts.length < 2) return null;
    pts = clip(pts, tx, ty, tx * bx + ty * by);
    if (pts.length < 2) return null;
    const out = [];
    const lnx = ref.lnx[edge], lny = ref.lny[edge], lpx = (ref.lx[v1] + ref.lx[v2]) / 2, lpy = (ref.ly[v1] + ref.ly[v2]) / 2;
    for (const p of pts) {
      const sep = nx * (p.x - ax) + ny * (p.y - ay);
      if (sep > MARGIN) continue;
      // the incident point in its own body's frame, for the position solver
      const dx = p.x - inc.x, dy = p.y - inc.y;
      out.push({ x: p.x - nx * sep / 2, y: p.y - ny * sep / 2, sep, id: flip * 1000 + edge * 100 + p.v * 10 + (p.c || 0), type: flip ? 3 : 2,
        lnx, lny, lpx, lpy, ipx: inc.c * dx + inc.s * dy, ipy: -inc.s * dx + inc.c * dy, rad: 0 });
    }
    if (!out.length) return null;
    return { nx: flip ? -nx : nx, ny: flip ? -ny : ny, pts: out };
  }
  // keep the part of a segment where n.p <= off
  function clip(pts, nx, ny, off) {
    const d0 = nx * pts[0].x + ny * pts[0].y - off, d1 = nx * pts[1].x + ny * pts[1].y - off;
    const out = [];
    if (d0 <= 0) out.push(pts[0]);
    if (d1 <= 0) out.push(pts[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      out.push({ x: pts[0].x + t * (pts[1].x - pts[0].x), y: pts[0].y + t * (pts[1].y - pts[0].y), v: d0 > 0 ? pts[0].v : pts[1].v, c: 1 + (d0 > 0 ? 0 : 1) });
    }
    return out;
  }
  function collide(A, B, slop) {
    if (A.shape === 'ball' && B.shape === 'ball') return collideCircles(A, B);
    if (A.shape !== 'ball' && B.shape === 'ball') return collidePolyCircle(A, B);
    if (A.shape === 'ball' && B.shape !== 'ball') {
      const m = collidePolyCircle(B, A);
      if (!m) return null;
      m.nx = -m.nx; m.ny = -m.ny; m.pts[0].type = 4; // the polygon is B
      return m;
    }
    return collidePolys(A, B, slop);
  }
  const canTouch = (A, B) => !(A.isStatic && B.isStatic) && !A.dead && !B.dead && !(A.group && A.group === B.group)
    && A.minx <= B.maxx + MARGIN && B.minx <= A.maxx + MARGIN && A.miny <= B.maxy + MARGIN && B.miny <= A.maxy + MARGIN;

  function findContacts(W) {
    const old = W.contacts, now = new Map();
    const bs = W.bodies;
    for (let i = 0; i < bs.length; i++) {
      const A = bs[i];
      if (A.dead) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const B = bs[j];
        if (!canTouch(A, B)) continue;
        const m = collide(A, B, W.slop);
        if (!m) continue;
        const key = A.key * 100000 + B.key;
        const was = old.get(key);
        // warm start: the same point as last step keeps its impulses
        for (const p of m.pts) {
          p.jn = 0; p.jt = 0;
          if (was) { const q = was.pts.find((o) => o.id === p.id); if (q) { p.jn = q.jn; p.jt = q.jt; } }
        }
        now.set(key, { A, B, nx: m.nx, ny: m.ny, pts: m.pts, fresh: !was, age: was ? was.age + 1 : 0, e: 0, mu: 0, mus: 0 });
      }
    }
    W.contacts = now;
  }

  const relVel = (A, B, rax, ray, rbx, rby) => [B.vx - B.w * rby - A.vx + A.w * ray, B.vy + B.w * rbx - A.vy - A.w * rax];

  function prepareContacts(W) {
    for (const c of W.contacts.values()) {
      const { A, B } = c;
      const dynA = !A.isStatic, dynB = !B.isStatic;
      // a static surface takes the body's own e and mu; two bodies, the lower e and the mean mu
      // a buffer (the ends of a track) catches what hits it
      c.e = dynA && dynB ? mn(A.e, B.e) : dynA ? (B.catch ? 0 : A.e) : (A.catch ? 0 : B.e);
      c.mu = dynA && dynB ? (A.mu + B.mu) / 2 : dynA ? A.mu : B.mu;
      c.mus = dynA && dynB ? (A.mus + B.mus) / 2 : dynA ? A.mus : B.mus;
      const tx = c.ny, ty = -c.nx;
      for (const p of c.pts) {
        p.rax = p.x - A.x; p.ray = p.y - A.y; p.rbx = p.x - B.x; p.rby = p.y - B.y;
        const rnA = p.rax * c.ny - p.ray * c.nx, rnB = p.rbx * c.ny - p.rby * c.nx;
        const kn = A.im + B.im + A.iI * rnA * rnA + B.iI * rnB * rnB;
        p.mn = kn > 0 ? 1 / kn : 0;
        const rtA = p.rax * ty - p.ray * tx, rtB = p.rbx * ty - p.rby * tx;
        const kt = A.im + B.im + A.iI * rtA * rtA + B.iI * rtB * rtB;
        p.mt = kt > 0 ? 1 / kt : 0;
        const [dvx, dvy] = relVel(A, B, p.rax, p.ray, p.rbx, p.rby);
        const vn = dvx * c.nx + dvy * c.ny;
        p.vn0 = vn;
        // a bounce; or, for a point not yet touching, room to close the gap (a speculative contact)
        p.bias = vn < -0.25 ? -c.e * vn : p.sep > 0 ? -p.sep / DT : 0;
        // sliding or not: kinetic friction once it slides, static while it holds
        const s0x = B.v0x - B.w0 * p.rby - A.v0x + A.w0 * p.ray, s0y = B.v0y + B.w0 * p.rbx - A.v0y - A.w0 * p.rax;
        p.slide = abs(s0x * tx + s0y * ty) > 0.01;
        // warm start
        const Px = p.jn * c.nx + p.jt * tx, Py = p.jn * c.ny + p.jt * ty;
        applyImp(A, B, p, Px, Py);
      }
    }
  }
  function applyImp(A, B, p, Px, Py) {
    A.vx -= A.im * Px; A.vy -= A.im * Py; A.w -= A.iI * (p.rax * Py - p.ray * Px);
    B.vx += B.im * Px; B.vy += B.im * Py; B.w += B.iI * (p.rbx * Py - p.rby * Px);
  }
  function solveContacts(W) {
    for (const c of W.contacts.values()) {
      const { A, B } = c;
      const tx = c.ny, ty = -c.nx;
      for (const p of c.pts) {
        // friction
        let [dvx, dvy] = relVel(A, B, p.rax, p.ray, p.rbx, p.rby);
        const vt = dvx * tx + dvy * ty;
        const lim = (p.slide ? c.mu : c.mus) * p.jn;
        const jt = clamp(p.jt - p.mt * vt, -lim, lim);
        const dt = jt - p.jt; p.jt = jt;
        applyImp(A, B, p, dt * tx, dt * ty);
        // the push apart
        [dvx, dvy] = relVel(A, B, p.rax, p.ray, p.rbx, p.rby);
        const vn = dvx * c.nx + dvy * c.ny;
        const jn = mx(p.jn - p.mn * (vn - p.bias), 0);
        const dn = jn - p.jn; p.jn = jn;
        applyImp(A, B, p, dn * c.nx, dn * c.ny);
      }
    }
  }
  function slipping(W) {
    let any = false;
    for (const c of W.contacts.values()) {
      if (c.mus <= c.mu || c.pts.some((p) => p.slide)) continue;
      const tx = c.ny, ty = -c.nx;
      // the contact as a whole (its corners share the load unevenly while the solver works)
      let jn = 0, jt = 0;
      for (const p of c.pts) { jn += p.jn; jt += p.jt; }
      if (jn <= 0 || abs(jt) < 0.995 * c.mus * jn) continue;
      for (const p of c.pts) {
        p.slide = true;
        const k = clamp(p.jt, -c.mu * p.jn, c.mu * p.jn), d = k - p.jt;
        p.jt = k;
        applyImp(c.A, c.B, p, d * tx, d * ty);
        any = true;
      }
    }
    return any;
  }
  // pushing overlapping bodies apart (positions only, so no energy is added)
  function solvePositions(W) {
    let worst = 0;
    for (const c of W.contacts.values()) {
      const { A, B } = c;
      if (A.dead || B.dead) continue;
      for (const p of c.pts) {
        let nx, ny, px, py, sep;
        if (p.type === 0) {
          const dx = B.x - A.x, dy = B.y - A.y, d = len2(dx, dy);
          nx = d > 1e-9 ? dx / d : c.nx; ny = d > 1e-9 ? dy / d : c.ny;
          sep = d - A.r - B.r; px = A.x + nx * A.r; py = A.y + ny * A.r;
        } else {
          // the reference face, and the incident point (a corner, or a circle's centre)
          const R = p.type === 3 || p.type === 4 ? B : A, I = R === A ? B : A;
          nx = R.c * p.lnx - R.s * p.lny; ny = R.s * p.lnx + R.c * p.lny;
          const qx = R.x + R.c * p.lpx - R.s * p.lpy, qy = R.y + R.s * p.lpx + R.c * p.lpy;
          px = I.x + I.c * p.ipx - I.s * p.ipy; py = I.y + I.s * p.ipx + I.c * p.ipy;
          sep = (px - qx) * nx + (py - qy) * ny - p.rad;
          if (R === B) { nx = -nx; ny = -ny; }
        }
        worst = mn(worst, sep);
        const C = clamp(0.2 * (sep + W.slop), -0.2, 0);
        if (C >= 0) continue;
        const rax = px - A.x, ray = py - A.y, rbx = px - B.x, rby = py - B.y;
        const rnA = rax * ny - ray * nx, rnB = rbx * ny - rby * nx;
        const K = A.im + B.im + A.iI * rnA * rnA + B.iI * rnB * rnB;
        if (K <= 0) continue;
        const imp = -C / K, Px = imp * nx, Py = imp * ny;
        A.x -= A.im * Px; A.y -= A.im * Py; if (A.iI) { A.a -= A.iI * (rax * Py - ray * Px); rotate(A); }
        B.x += B.im * Px; B.y += B.im * Py; if (B.iI) { B.a += B.iI * (rbx * Py - rby * Px); rotate(B); }
        if (A.rail != null) A.y = A.rail;
        if (B.rail != null) B.y = B.rail;
      }
    }
    return worst;
  }

  /* ----- joints: ropes, rods and the learner's hand ----- */

  // a rope or rod from body A's anchor (local) to body B's (local) or a fixed point (world)
  function addRod(W, A, ax, ay, B, bx, by, L, rope) {
    const j = { type: 'rod', A, B, ax, ay, bx, by, L, rope: Boolean(rope), acc: 0, slack: false };
    W.joints.push(j);
    return j;
  }
  function rodGeom(j) {
    const A = j.A, B = j.B;
    const pax = A.x + A.c * j.ax - A.s * j.ay, pay = A.y + A.s * j.ax + A.c * j.ay;
    const pbx = B ? B.x + B.c * j.bx - B.s * j.by : j.bx, pby = B ? B.y + B.s * j.bx + B.c * j.by : j.by;
    const dx = pbx - pax, dy = pby - pay, L = len2(dx, dy) || 1e-9;
    return { pax, pay, pbx, pby, ux: dx / L, uy: dy / L, len: L, rax: pax - A.x, ray: pay - A.y, rbx: B ? pbx - B.x : 0, rby: B ? pby - B.y : 0 };
  }
  function prepareJoints(W) {
    for (const j of W.joints) {
      if (j.type === 'mouse') { prepareMouse(W, j); continue; }
      const q = rodGeom(j);
      j.q = q;
      const crA = q.rax * q.uy - q.ray * q.ux, crB = q.rbx * q.uy - q.rby * q.ux;
      const B = j.B;
      const K = j.A.im + j.A.iI * crA * crA + (B ? B.im + B.iI * crB * crB : 0);
      j.mass = K > 0 ? 1 / K : 0;
      j.slack = j.rope && q.len < j.L - 1e-4;
      if (j.slack) j.acc = 0;
      // warm start
      if (j.acc) { const Px = j.acc * q.ux, Py = j.acc * q.uy; impRod(j, Px, Py); }
    }
  }
  function impRod(j, Px, Py) {
    const A = j.A, B = j.B, q = j.q;
    A.vx -= A.im * Px; A.vy -= A.im * Py; A.w -= A.iI * (q.rax * Py - q.ray * Px);
    if (B) { B.vx += B.im * Px; B.vy += B.im * Py; B.w += B.iI * (q.rbx * Py - q.rby * Px); }
  }
  function solveJoints(W) {
    for (const j of W.joints) {
      if (j.type === 'mouse') { solveMouse(W, j); continue; }
      if (j.slack) continue;
      const A = j.A, B = j.B, q = j.q;
      const vbx = B ? B.vx - B.w * q.rby : 0, vby = B ? B.vy + B.w * q.rbx : 0;
      const cdot = q.ux * (vbx - (A.vx - A.w * q.ray)) + q.uy * (vby - (A.vy + A.w * q.rax));
      let imp = -j.mass * cdot;
      if (j.rope) { const old = j.acc; j.acc = mn(old + imp, 0); imp = j.acc - old; } else j.acc += imp;
      impRod(j, imp * q.ux, imp * q.uy);
    }
  }
  function solveJointPositions(W) {
    for (const j of W.joints) {
      if (j.type === 'mouse') continue;
      const q = rodGeom(j);
      let C = q.len - j.L;
      if (j.rope && C < 0) continue;
      C = clamp(C, -0.2, 0.2);
      const A = j.A, B = j.B;
      const crA = q.rax * q.uy - q.ray * q.ux, crB = q.rbx * q.uy - q.rby * q.ux;
      const K = A.im + A.iI * crA * crA + (B ? B.im + B.iI * crB * crB : 0);
      if (K <= 0) continue;
      const imp = -C / K, Px = imp * q.ux, Py = imp * q.uy;
      A.x -= A.im * Px; A.y -= A.im * Py; if (A.iI) { A.a -= A.iI * (q.rax * Py - q.ray * Px); rotate(A); }
      if (B) { B.x += B.im * Px; B.y += B.im * Py; if (B.iI) { B.a += B.iI * (q.rbx * Py - q.rby * Px); rotate(B); } }
    }
  }
  // the learner's hand: a soft spring from the grabbed point to the pointer (Box2D's mouse joint)
  function grab(W, b, wx, wy) {
    release(W);
    if (!b || b.isStatic) return null;
    const dx = wx - b.x, dy = wy - b.y;
    const j = { type: 'mouse', B: b, lx: b.c * dx + b.s * dy, ly: -b.s * dx + b.c * dy, tx: wx, ty: wy, ix: 0, iy: 0 };
    W.joints.push(j);
    W.mouse = j;
    return j;
  }
  function release(W) { if (W.mouse) { W.joints = W.joints.filter((j) => j !== W.mouse); W.mouse = null; } }
  function prepareMouse(W, j) {
    const B = j.B;
    const f = 6, zeta = 0.9, w = 2 * PI * f;
    const m = B.m, d = 2 * m * zeta * w, k = m * w * w, h = DT;
    let gamma = h * (d + h * k); gamma = gamma ? 1 / gamma : 0;
    j.gamma = gamma; j.beta = h * k * gamma;
    j.rx = B.c * j.lx - B.s * j.ly; j.ry = B.s * j.lx + B.c * j.ly;
    const k11 = B.im + B.iI * j.ry * j.ry + gamma, k12 = -B.iI * j.rx * j.ry, k22 = B.im + B.iI * j.rx * j.rx + gamma;
    const det = k11 * k22 - k12 * k12 || 1e-12;
    j.m11 = k22 / det; j.m12 = -k12 / det; j.m22 = k11 / det;
    j.cx = B.x + j.rx - j.tx; j.cy = B.y + j.ry - j.ty;
    j.maxF = 60 * m * mx(W.g, 9.8) * h;
    B.w *= 0.98;
    B.vx += B.im * j.ix; B.vy += B.im * j.iy; B.w += B.iI * (j.rx * j.iy - j.ry * j.ix);
  }
  function solveMouse(W, j) {
    const B = j.B;
    const vx = B.vx - B.w * j.ry, vy = B.vy + B.w * j.rx;
    const bx = vx + j.beta * j.cx + j.gamma * j.ix, by = vy + j.beta * j.cy + j.gamma * j.iy;
    let ix = -(j.m11 * bx + j.m12 * by), iy = -(j.m12 * bx + j.m22 * by);
    const ox = j.ix, oy = j.iy;
    j.ix += ix; j.iy += iy;
    const L = len2(j.ix, j.iy);
    if (L > j.maxF) { j.ix *= j.maxF / L; j.iy *= j.maxF / L; }
    ix = j.ix - ox; iy = j.iy - oy;
    B.vx += B.im * ix; B.vy += B.im * iy; B.w += B.iI * (j.rx * iy - j.ry * ix);
  }

  /* ----- springs (Hooke's law, with damping) ----- */

  function addSpring(W, A, ax, ay, B, bx, by, k, L, c) {
    const sp = { A, B, ax, ay, bx, by, k, L, c, F: 0, ext: 0 };
    W.springs.push(sp);
    return sp;
  }
  function springGeom(sp) {
    const A = sp.A, B = sp.B;
    const pax = A ? A.x + A.c * sp.ax - A.s * sp.ay : sp.ax, pay = A ? A.y + A.s * sp.ax + A.c * sp.ay : sp.ay;
    const pbx = B ? B.x + B.c * sp.bx - B.s * sp.by : sp.bx, pby = B ? B.y + B.s * sp.bx + B.c * sp.by : sp.by;
    const dx = pbx - pax, dy = pby - pay, L = len2(dx, dy) || 1e-9;
    return { pax, pay, pbx, pby, ux: dx / L, uy: dy / L, len: L };
  }
  function springForces(W) {
    for (const sp of W.springs) {
      const q = springGeom(sp);
      const A = sp.A, B = sp.B;
      const rax = A ? q.pax - A.x : 0, ray = A ? q.pay - A.y : 0, rbx = B ? q.pbx - B.x : 0, rby = B ? q.pby - B.y : 0;
      const vax = A ? A.vx - A.w * ray : 0, vay = A ? A.vy + A.w * rax : 0, vbx = B ? B.vx - B.w * rby : 0, vby = B ? B.vy + B.w * rbx : 0;
      sp.ext = q.len - sp.L;
      const F = sp.k * sp.ext + sp.c * (q.ux * (vbx - vax) + q.uy * (vby - vay));
      sp.F = sp.k * sp.ext;
      const fx = F * q.ux, fy = F * q.uy; // on A, toward B when stretched
      if (A && !A.isStatic) { push(A, fx, fy, rax, ray); A.F.spring[0] += fx; A.F.spring[1] += fy; }
      if (B && !B.isStatic) { push(B, -fx, -fy, rbx, rby); B.F.spring[0] -= fx; B.F.spring[1] -= fy; }
    }
  }
  function push(b, fx, fy, rx, ry) { b.vx += b.im * fx * DT; b.vy += b.im * fy * DT; b.w += b.iI * (rx * fy - ry * fx) * DT; }

  /* ----- fluids: what is under the surface, and how hard it pushes up ----- */

  function submerged(b, f) {
    if (b.maxx < f.x0 || b.minx > f.x1 || b.miny >= f.level) return { frac: 0, cx: b.x, cy: b.y };
    if (b.shape === 'ball') {
      const h = clamp(f.level - (b.y - b.r), 0, 2 * b.r);
      return { frac: h * h * (3 * b.r - h) / (4 * b.r * b.r * b.r), cx: b.x, cy: b.y };
    }
    // the polygon cut at the surface: its area and centre (the shoelace formula)
    const xs = [], ys = [];
    for (let i = 0; i < b.n; i++) {
      const j = (i + 1) % b.n, ya = b.wy[i], yb = b.wy[j];
      if (ya <= f.level) { xs.push(b.wx[i]); ys.push(ya); }
      if ((ya < f.level) !== (yb < f.level)) { const t = (f.level - ya) / (yb - ya); xs.push(b.wx[i] + t * (b.wx[j] - b.wx[i])); ys.push(f.level); }
    }
    const area = (X, Y) => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < X.length; i++) { const j = (i + 1) % X.length, cr = X[i] * Y[j] - X[j] * Y[i]; a += cr; cx += (X[i] + X[j]) * cr; cy += (Y[i] + Y[j]) * cr; } return a ? [a / 2, cx / (3 * a), cy / (3 * a)] : [0, b.x, b.y]; };
    if (xs.length < 3) return { frac: 0, cx: b.x, cy: b.y };
    const [as, cx, cy] = area(xs, ys), [at] = area(b.wx, b.wy);
    return { frac: clamp(abs(as / at), 0, 1), cx, cy };
  }

  /* ----- one step ----- */

  function step(W) {
    const h = DT;
    W.events = [];
    const bs = W.bodies;
    // forces: gravity, pushes, springs, buoyancy, then drag (solved implicitly, so terminal velocity is exact)
    for (const b of bs) {
      if (b.isStatic || b.dead) continue;
      b.F = forces();
      b.v0x = b.vx; b.v0y = b.vy; b.w0 = b.w;
      b.F.weight[1] = -b.m * W.g;
      b.vy -= W.g * h;
      if ((b.fx || b.fy) && W.t < b.until) { b.F.applied[0] = b.fx; b.F.applied[1] = b.fy; b.vx += b.fx * b.im * h; b.vy += b.fy * b.im * h; }
    }
    springForces(W);
    for (const b of bs) {
      if (b.isStatic || b.dead) continue;
      let k = 0; // the drag: v / (1 + k h), with k from this step's starting speed
      const sp = len2(b.v0x, b.v0y);
      let inFluid = 0;
      for (const f of W.fluids) {
        const s = submerged(b, f);
        if (!s.frac) continue;
        inFluid = mx(inFluid, s.frac);
        const Fb = f.density * s.frac * b.volume * W.g;
        b.F.buoyancy[1] += Fb;
        push(b, 0, Fb, s.cx - b.x, s.cy - b.y);
        const cd = b.cd || (b.shape === 'ball' ? 0.47 : 1.05);
        k += 0.5 * f.density * cd * (b.area || (b.shape === 'ball' ? PI * b.r * b.r : 4 * b.hw * b.hw)) * sp * s.frac * b.im + 2 * s.frac;
        b.w /= 1 + 2 * s.frac * h;
      }
      if (b.cd && W.air) k += 0.5 * W.air * b.cd * b.area * sp * b.im * (1 - inFluid);
      if (b.b) k += b.b * b.im;
      if (k) {
        const vx = b.vx / (1 + k * h), vy = b.vy / (1 + k * h);
        b.F.drag[0] = b.m * (vx - b.vx) / h; b.F.drag[1] = b.m * (vy - b.vy) / h;
        b.vx = vx; b.vy = vy;
      }
      b.w /= 1 + 0.05 * h;
      if (b.rail != null) { b.vy = 0; b.w = 0; }
      b.preX = b.vx; b.preY = b.vy;
    }
    // contacts, joints, and the solver
    findContacts(W);
    prepareContacts(W);
    prepareJoints(W);
    for (let it = 0; it < 10; it++) { solveJoints(W); solveContacts(W); }
    // static friction used to the full means it gives way: kinetic friction from now, and the solver again
    if (slipping(W)) for (let it = 0; it < 4; it++) { solveJoints(W); solveContacts(W); }
    breakage(W);
    record(W);
    // positions
    for (const b of bs) {
      if (b.isStatic || b.dead) continue;
      if (b.rail != null) { b.vy = 0; b.w = 0; }
      b.px = b.x; b.py = b.y;
      b.free = !b.touch && !W.joints.some((j) => j.A === b || j.B === b) && !W.springs.some((sp) => sp.A === b || sp.B === b);
      move(W, b, h);
    }
    for (let it = 0; it < 4; it++) { solvePositions(W); solveJointPositions(W); }
    W.t += h; W.n++;
    for (const b of bs) {
      if (b.isStatic || b.dead) continue;
      if (b.rail != null) { b.y = b.rail; b.vy = 0; }
      sync(b);
      b.ax = (b.vx - b.v0x) / h; b.ay = (b.vy - b.v0y) / h;
      b.path += len2(b.x - b.px, b.y - b.py);
      const hy = b.y - b.rest - W.ground;
      if (hy > b.maxY) b.maxY = hy;
    }
  }
  // move a body; a fast one is moved in small pieces so it can't pass through a wall or the ground
  function move(W, b, h) {
    // in free flight gravity's part of the move is exact (a parabola); otherwise semi-implicit Euler
    const dx = b.vx * h, dy = b.vy * h + (b.free ? 0.5 * W.g * h * h : 0), da = b.w * h;
    const size = b.shape === 'ball' ? b.r : mn(b.hw, b.hh);
    const d = len2(dx, dy);
    b.toi = null;
    if (d > 0.5 * size) {
      const n = mn(64, Math.ceil(d / (0.4 * size)));
      const already = new Set(W.bodies.filter((o) => o.isStatic && !o.dead && canTouch(b, o) && collide(b, o, W.slop)));
      const x0 = b.x, y0 = b.y, a0 = b.a;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        b.x = x0 + dx * f; b.y = y0 + dy * f; b.a = a0 + da * f; rotate(b); sync(b);
        if (hitsStatic(W, b, already)) {
          // back to just touching
          let lo = (i - 1) / n, hi = f;
          for (let k = 0; k < 6; k++) {
            const m = (lo + hi) / 2;
            b.x = x0 + dx * m; b.y = y0 + dy * m; b.a = a0 + da * m; rotate(b); sync(b);
            if (hitsStatic(W, b, already)) hi = m; else lo = m;
          }
          b.x = x0 + dx * lo; b.y = y0 + dy * lo; b.a = a0 + da * lo; rotate(b); sync(b);
          b.toi = { t: W.t + lo * h, x: b.x, y: b.y };
          return;
        }
      }
      return;
    }
    b.x += dx; b.y += dy;
    if (da) { b.a += da; rotate(b); }
  }
  function hitsStatic(W, b, already) {
    for (const o of W.bodies) {
      if (!o.isStatic || o.dead || already.has(o) || !canTouch(b, o)) continue;
      const m = collide(b, o, W.slop);
      if (m && m.pts.some((p) => p.sep < -0.25 * W.slop)) return true;
    }
    return false;
  }

  // what the solver did, as forces on each body (impulse / time), and the moments that matter: landing, hitting
  function record(W) {
    const h = DT;
    for (const b of W.bodies) { b.touch = false; b.hitNow = null; b.blow = 0; }
    for (const c of W.contacts.values()) {
      const { A, B } = c;
      const tx = c.ny, ty = -c.nx;
      let jn = 0, jt = 0, worst = 0;
      for (const p of c.pts) { jn += p.jn; jt += p.jt; worst = mn(worst, p.sep); }
      const Nx = jn * c.nx / h, Ny = jn * c.ny / h, Fx = jt * tx / h, Fy = jt * ty / h;
      if (!A.isStatic) { A.F.normal[0] -= Nx; A.F.normal[1] -= Ny; A.F.friction[0] -= Fx; A.F.friction[1] -= Fy; }
      if (!B.isStatic) { B.F.normal[0] += Nx; B.F.normal[1] += Ny; B.F.friction[0] += Fx; B.F.friction[1] += Fy; }
      const force = jn / mx(h, A.pad || 0, B.pad || 0);
      // a new touch: an impact (a ball that hits two bricks at once hits the wall with both)
      if (c.age < 3) {
        for (const b of [A, B]) if (!b.isStatic) b.blow += force;
        if (c.fresh && !A.isStatic && !B.isStatic) W.events.push({ type: 'hit', a: A, b: B, t: W.t, force });
        if (c.fresh) { if (!A.isStatic) A.hitNow = { other: B, force }; if (!B.isStatic) B.hitNow = { other: A, force }; }
      }
      const st = A.isStatic ? A : B.isStatic ? B : null, dyn = st === A ? B : A;
      if (st) {
        dyn.touch = true;
        if (st.kind === 'ground' && !dyn.onGround) dyn.onGround = { t: W.t, v: len2(dyn.preX, dyn.preY), vx: dyn.preX };
        if (!dyn.landed && dyn.airT >= 3) {
          // the moment it landed, from the step it went in: back up by how deep it went
          const vn = abs(dyn.preX * c.nx + dyn.preY * c.ny) || 1e-9;
          let t, x, y;
          if (dyn.toi) { t = dyn.toi.t; x = dyn.toi.x; y = dyn.toi.y; }
          else { const back = clamp(-worst / vn, 0, DT); t = W.t - back; x = dyn.x - dyn.preX * back; y = dyn.y - dyn.preY * back; }
          const back2 = W.t - t; // its speed then: back along the last step's acceleration (exact in free flight)
          dyn.landed = { t, x, y, speed: len2(dyn.v0x - dyn.ax * back2, dyn.v0y - dyn.ay * back2), ay: dyn.ay, ax: dyn.ax, on: st };
          W.events.push({ type: 'land', b: dyn, t, x, y, speed: dyn.landed.speed, ay: dyn.ay, ground: st.kind === 'ground' });
        }
      }
    }
    for (const j of W.joints) {
      if (j.type === 'mouse') { j.B.F.hand[0] += j.ix / h; j.B.F.hand[1] += j.iy / h; continue; }
      const fx = j.acc * j.q.ux / h, fy = j.acc * j.q.uy / h;
      j.A.F.tension[0] -= fx; j.A.F.tension[1] -= fy;
      if (j.B && !j.B.isStatic) { j.B.F.tension[0] += fx; j.B.F.tension[1] += fy; }
      j.T = abs(j.acc) / h;
    }
    for (const b of W.bodies) {
      if (b.isStatic || b.dead) continue;
      if (b.rail != null) { b.F.normal[1] = b.m * W.g; }
      if (b.blow > b.impact) b.impact = b.blow;
      b.airT = b.touch ? 0 : b.airT + 1;
    }
  }

  /* ----- breaking: mortar that gives way, and bodies that shatter ----- */

  function breakage(W) {
    const h = DT;
    // every blow this step, per thing that can break and per body that struck it: a wall counts all its bricks together
    const blows = new Map();
    for (const c of W.contacts.values()) {
      if (!c.pts.length) continue;
      for (const [X, Y] of [[c.A, c.B], [c.B, c.A]]) {
        const strength = X.mortar || (X.brk && !X.isStatic ? X.brk.strength : 0);
        if (!strength || Y.dead || X.dead || (X.mortar && Y.isStatic)) continue;
        // a brick on a brick is a load, not a blow: only a body from outside the wall breaks it
        if (X.mortar && Y.wallId === X.wallId) continue;
        let jn = 0, px = 0, py = 0;
        for (const p of c.pts) { jn += p.jn; px += p.x * p.jn; py += p.y * p.jn; }
        if (jn <= 0) continue;
        const key = (X.mortar ? 'w:' + X.wallId : 'b:' + X.key) + '/' + Y.key;
        const o = blows.get(key) || { X, Y, J: 0, px: 0, py: 0, strength, best: null, bestJ: 0, tau: mx(h, X.pad || 0) };
        o.J += jn; o.px += px; o.py += py;
        if (jn > o.bestJ) { o.bestJ = jn; o.best = X; }
        blows.set(key, o);
      }
    }
    const hits = [...blows.values()].filter((o) => o.J / o.tau > o.strength);
    if (!hits.length) return;
    const done = new Set();
    for (const o of hits) {
      const X = o.best;
      const tag = X.mortar ? 'w:' + X.wallId : 'b:' + X.key;
      if (done.has(tag) || X.dead || (!X.mortar && !X.brk)) continue;
      done.add(tag);
      const hit = { X, Y: o.Y, F: o.J / o.tau, px: o.px / o.J, py: o.py / o.J };
      if (!o.Y.isStatic && hit.F > o.Y.impact) o.Y.impact = hit.F;
      if (!X.isStatic && hit.F > X.impact) X.impact = hit.F;
      const loose = X.mortar ? looseBricks(W, X, hit) : null;
      const gone = loose ? new Set(loose) : new Set([X]);
      // the bodies that hit it go on as if it weren't there: the pieces then take their share of the blow
      for (const c of W.contacts.values()) {
        const other = gone.has(c.A) ? c.B : gone.has(c.B) ? c.A : null;
        if (!other || other.isStatic || gone.has(other)) continue;
        other.vx = other.preX; other.vy = other.preY;
        c.pts.forEach((p) => { p.jn = 0; p.jt = 0; });
      }
      if (loose) {
        // the bricks take a share of the blow's momentum (more, the harder it struck), nearest the most;
        // the body that struck keeps the rest and goes on through
        const Y = hit.Y, sp = len2(Y.preX, Y.preY) || 1e-9, ux = Y.preX / sp, uy = Y.preY / sp;
        const share = clamp(0.35 + 0.25 * (1 - X.mortar / hit.F), 0.35, 0.6);
        const reach = 3 * (X.hw + X.hh);
        const wts = loose.map((b) => 0.25 + mx(0, 1 - len2(b.x - hit.px, b.y - hit.py) / reach));
        const wsum = wts.reduce((a, b) => a + b, 0);
        loose.forEach((b, i) => {
          b.mortar = 0; b.isStatic = false; setMass(b, b.brickMass); b.loose = true;
          const v = share * Y.m * sp * wts[i] / wsum / b.m;
          b.vx = ux * v; b.vy = uy * v + 0.15 * v * wts[i];
          b.w = (i % 2 ? 1 : -1) * (2 + (i % 3)) * mn(1, v / 2);
          b.v0x = b.vx; b.v0y = b.vy; b.w0 = b.w; b.preX = b.vx; b.preY = b.vy;
        });
        Y.vx = Y.preX * (1 - share); Y.vy = Y.preY * (1 - share);
        W.events.push({ type: 'break', target: X.wallId, t: W.t, force: hit.F, x: hit.px, y: hit.py, pieces: loose.length });
        W.broke.push({ target: X.wallId, t: W.t, force: hit.F });
      } else shatter(W, X, hit);
    }
    for (const [k, c] of W.contacts) if (c.A.dead || c.B.dead) W.contacts.delete(k);
  }
  // the bricks a blow knocks loose: those near where it struck (more for a harder blow), and any no longer held up
  function looseBricks(W, X, hit) {
    const wall = W.bodies.filter((b) => b.mortar && b.wallId === X.wallId);
    const size = X.hw + X.hh;
    const R = size * (0.7 + 0.9 * sqrt(hit.F / X.mortar));
    // a hole the blow's way through the wall: reaching further along the blow than across it
    const sp = len2(hit.Y.preX, hit.Y.preY) || 1e-9, ux = hit.Y.preX / sp, uy = hit.Y.preY / sp;
    const out = new Set([X]);
    wall.forEach((b) => {
      const dx = b.x - hit.px, dy = b.y - hit.py, along = dx * ux + dy * uy, across = dx * uy - dy * ux;
      if (along > -size && len2(0.35 * along, across) < R) out.add(b);
    });
    // what is still held: joined, brick to brick, to a brick on the ground
    const held = new Set();
    const todo = wall.filter((b) => !out.has(b) && b.anchored);
    while (todo.length) {
      const b = todo.pop();
      if (held.has(b)) continue;
      held.add(b);
      wall.forEach((o) => { if (!out.has(o) && !held.has(o) && touching(b, o)) todo.push(o); });
    }
    wall.forEach((b) => { if (!held.has(b)) out.add(b); });
    return [...out];
  }
  const touching = (a, b) => a.minx <= b.maxx + 1e-6 && b.minx <= a.maxx + 1e-6 && a.miny <= b.maxy + 1e-6 && b.miny <= a.maxy + 1e-6
    && (abs(a.minx - b.maxx) < 1e-6 || abs(b.minx - a.maxx) < 1e-6 || abs(a.miny - b.maxy) < 1e-6 || abs(b.miny - a.maxy) < 1e-6);
  // a body that breaks into pieces, each moving as it did
  function shatter(W, X, hit) {
    const { rows, cols } = X.brk;
    X.dead = true;
    const w = 2 * X.hw / cols, hh = 2 * X.hh / rows;
    const vx0 = X.preX, vy0 = X.preY;
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const lx = -X.hw + w * (c + 0.5), ly = -X.hh + hh * (r + 0.5);
      const x = X.x + X.c * lx - X.s * ly, y = X.y + X.s * lx + X.c * ly;
      const out = 0.6 + 0.2 * ((r + c) % 3);
      const p = addBody(W, { shape: 'box', w: w * 0.98, h: hh * 0.98, x, y, a: X.a, mass: X.m / (rows * cols), e: X.e, mu: X.mu, mus: X.mus,
        vx: vx0 - X.w * (y - X.y) + (x - X.x) * out * 2, vy: vy0 + X.w * (x - X.x) + (y - X.y) * out * 2 + 0.5, spin: X.w + ((n++ % 2) ? 3 : -3),
        color: X.color, id: X.id + (n), kind: 'piece', group: 0 });
      p.piece = X.id;
    }
    W.events.push({ type: 'break', target: X.id, t: W.t, force: hit.F, x: hit.px, y: hit.py, pieces: rows * cols });
    W.broke.push({ target: X.id, t: W.t, force: hit.F });
  }

  /* ---------------- the scenes ---------------- */

  const G0 = 0; // the ground is at y = 0
  function ground(W, x0, x1) {
    const g = addBody(W, { shape: 'box', w: x1 - x0, h: 40, x: (x0 + x1) / 2, y: -20, isStatic: true, kind: 'ground' });
    makeStatic(g);
    W.groundBody = g;
    return g;
  }
  function staticBox(W, x, y, w, h, kind) { const b = addBody(W, { shape: 'box', w, h, x, y, isStatic: true, kind: kind || 'wall' }); makeStatic(b); return b; }
  function staticPoly(W, verts, kind) {
    let cx = 0, cy = 0; verts.forEach((p) => { cx += p[0]; cy += p[1]; }); cx /= verts.length; cy /= verts.length;
    const b = addBody(W, { shape: 'poly', verts: verts.map((p) => [p[0] - cx, p[1] - cy]), x: cx, y: cy, isStatic: true, kind: kind || 'ramp' });
    makeStatic(b);
    return b;
  }
  function dyn(W, o, x, y, extra) {
    const e = extra || {};
    return addBody(W, Object.assign({
      id: o.id, label: o.label, color: o.color, shape: o.shape, r: o.r, w: o.size ? o.size[0] : 0, h: o.size ? o.size[1] : 0, x, y,
      mass: o.mass, e: o.e, mu: o.mu, mus: o.mus, cd: o.cd, area: areaOf(o), b: o.b, volume: volumeOf(o)
    }, e));
  }

  const BUILD = {
    drop: {
      norm(raw, s) {
        s.height = pnum(raw, ['height', 'h', 'drop'], 0.1, 1000, 10, 'the drop height', 'm');
        s.bodies = bodies(raw, 1, 4, { dflt: [{ id: 'A', label: 'With air', cd: 0.47 }, { id: 'B', label: 'No air', air: false }], r: 0.1, mass: 0.05, cd: 0.47, e: 0.3 }, 'drop');
      },
      check(s) { s.bodies.forEach((b) => { if (2 * ext(b) > s.height + 2 && s.height > 1) { /* fine: big things fall too */ } }); },
      build(W, s) {
        const gap = mx(0.8, 4 * mx(...s.bodies.map(ext)), mn(0.12 * s.height, 12));
        ground(W, -50, 50 + gap * s.bodies.length);
        s.bodies.forEach((o, i) => { dyn(W, o, i * gap, s.height + half(o), { group: 1 }); });
        W.meta = { lanes: gap, end: 'land' };
      }
    },
    projectile: {
      norm(raw, s) {
        s.angle = pnum(raw, ['angle', 'theta', 'launchAngle'], 0, 90, 45, 'the launch angle', '°');
        s.speed = pnum(raw, ['speed', 'v', 'velocity', 'launchSpeed', 'u'], 0.5, 100, ownSpeed(raw, 0.5, 100, 15), 'the launch speed', 'm/s');
        s.height = pnum(raw, ['height', 'h', 'cliff'], 0, 200, 0, 'the launch height', 'm');
        s.bodies = bodies(raw, 1, 3, { r: 0.1, mass: 0.5, e: 0.3, mu: 0.4 }, 'projectile');
      },
      check(s) { if (s.angle === 0 && s.height === 0) fail('a launch at 0° from the ground never leaves it: give an angle or a height'); },
      build(W, s) {
        const a = rad(s.angle), vx = s.speed * dcos(a), vy = s.speed * dsin(a);
        ground(W, -50, 5000);
        if (s.height > 0) staticBox(W, -5, s.height / 2, 10, s.height, 'cliff');
        W.ground = 0;
        s.bodies.forEach((o) => { const b = dyn(W, o, 0, s.height + half(o) + 1e-4, { vx, vy, group: 1 }); b.launch = [0, s.height]; });
        W.meta = { launch: [0, s.height], angle: s.angle, speed: s.speed, end: 'land' };
      }
    },
    collision: {
      norm(raw, s) {
        const list = pick(raw, ['bodies', 'balls', 'objects']);
        const ab = list === undefined && (isObj(raw.a) || isObj(raw.b) || isObj(raw.A) || isObj(raw.B)) ? [Object.assign({ id: 'A' }, raw.a || raw.A || {}), Object.assign({ id: 'B' }, raw.b || raw.B || {})] : list;
        s.bodies = bodies({ bodies: ab }, 2, 3, { dflt: [{ id: 'A', v: 2 }, { id: 'B' }], each: (i) => ({ r: 0.25, mass: 1, e: 1, mu: 0, shape: 'ball', color: COLORS[i] }) }, 'collision');
        const rawList = Array.isArray(ab) ? ab : [{ v: 2 }, {}];
        // one e for the collision: the scene's, or else the lowest the bodies give
        const given = rawList.filter((r) => has(r, 'e') || has(r, 'restitution')).map((r, i) => pnum(r, ['e', 'restitution'], 0, 1, 1, `body ${i + 1}'s restitution e`, ''));
        s.e = pnum(raw, ['e', 'restitution'], 0, 1, given.length ? mn(...given) : 1, 'the restitution e', '');
        s.bodies.forEach((b, i) => {
          const r = rawList[i] || {};
          const v = pick(r, ['v', 'u', 'velocity', 'speed', 'vx']);
          b.v = v === undefined ? (i === 0 ? 2 : 0) : pnum({ v }, ['v'], -30, 30, 0, `${b.id}'s velocity`, 'm/s');
          b.mu = 0; b.mus = 0; b.e = 1;
          if (has(r, 'x') || has(r, 'at')) b.x = pnum({ x: Array.isArray(r.at) ? r.at[0] : r.at != null ? r.at : r.x }, ['x'], 0.3, 19.7, undefined, `${b.id}'s position`, 'm');
        });
        const r0 = s.bodies[0].shape === 'ball' ? s.bodies[0].r : s.bodies[0].size[1] / 2;
        s.bodies.forEach((b) => { if (b.shape === 'ball') b.r = r0; else b.size = [b.size[0], r0 * 2]; });
        s.length = pnum(raw, ['length', 'track'], 3, 20, 8, 'the track length', 'm');
      },
      check(s) {
        const xs = layoutTrack(s);
        for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < ext(s.bodies[i]) + ext(s.bodies[i - 1]) + 0.02) fail('two bodies on the track overlap at the start: space them out');
        if (!s.bodies.some((b) => b.v)) fail('nothing on the track is moving: give a body a velocity "v"');
      },
      build(W, s) {
        const xs = layoutTrack(s);
        ground(W, -50, 50 + s.length);
        const r = half(s.bodies[0]);
        staticBox(W, -0.1, r * 2, 0.2, r * 4, 'stop').catch = true;
        staticBox(W, s.length + 0.1, r * 2, 0.2, r * 4, 'stop').catch = true;
        s.bodies.forEach((o, i) => { dyn(W, Object.assign({}, o, { e: mn(o.e, s.e) }), xs[i], r, { vx: o.v, rail: r, mu: 0, mus: 0 }); });
        W.meta = { end: 'hit', track: s.length };
      }
    },
    ramp: {
      norm(raw, s) {
        s.angle = pnum(raw, ['angle', 'theta', 'incline'], 5, 60, 30, 'the ramp angle', '°');
        s.length = pnum(raw, ['length', 'L'], 1, 30, 5, 'the ramp length', 'm');
        s.force = pnum(raw, ['force', 'push', 'F'], -5000, 5000, 0, 'the force up the ramp', 'N');
        s.floor = pnum(raw, ['floor'], 0, 30, s.length, 'the floor length', 'm');
        s.bodies = bodies(raw, 1, 1, { shape: 'box', size: [0.5, 0.3], r: 0.15, mass: 1, mu: 0.2, mus: 0.3, e: 0.1 }, 'ramp');
        if (has(raw, 'mu')) s.bodies[0].mu = pnum(raw, ['mu'], 0, 1.5, 0.2, 'the friction coefficient', '');
        if (s.bodies[0].mus < s.bodies[0].mu) s.bodies[0].mus = s.bodies[0].mu;
        s.mu = s.bodies[0].mu;
      },
      check(s) {
        const b = s.bodies[0];
        if (b.shape === 'box' && 2 * ext(b) > s.length * 0.5) fail('the block is too big for the ramp: make it smaller or the ramp longer');
        if (b.shape === 'box' && b.size[1] > b.size[0] * 1.5) fail('a tall, thin block tips over on a ramp: make it wider than it is tall');
      },
      build(W, s) {
        const a = rad(s.angle), D = s.length * dcos(a), H = s.length * dsin(a);
        ground(W, -50, D + s.floor + 50);
        staticPoly(W, [[0, 0], [D, 0], [0, H]], 'ramp');
        staticBox(W, -0.15, (H + 0.6) / 2, 0.3, H + 0.6, 'wall');
        const o = Object.assign({}, s.bodies[0], { mu: s.mu, mus: mx(s.bodies[0].mus, s.mu) });
        const sd = 0.1 + ext(o), hb = half(o); // a little down from the top, sitting on the slope (just touching it)
        const ux = dcos(a), uy = -dsin(a), nx = dsin(a), ny = dcos(a);
        const x = sd * ux + hb * nx, y = H + sd * uy + hb * ny;
        dyn(W, o, x, y, { a: o.shape === 'box' ? -a : 0, fx: s.force * -ux, fy: s.force * -uy });
        W.meta = { foot: D, top: H, end: 'bottom', angle: s.angle };
      }
    },
    push: {
      norm(raw, s) {
        s.force = pnum(raw, ['force', 'push', 'F'], 0, 10000, 10, 'the push', 'N');
        s.time = pnum(raw, ['time', 'for', 'duration'], 0.1, 60, 60, 'how long it pushes', 's');
        s.bodies = bodies(raw, 1, 1, { shape: 'box', size: [0.6, 0.4], mass: 2, mu: 0.3, mus: 0.4, e: 0.1 }, 'push');
        if (has(raw, 'mu')) s.bodies[0].mu = pnum(raw, ['mu'], 0, 1.5, 0.3, 'the friction coefficient', '');
        if (has(raw, 'mus')) s.bodies[0].mus = pnum(raw, ['mus'], 0, 2, 0.4, 'the static friction coefficient', '');
        if (s.bodies[0].mus < s.bodies[0].mu) s.bodies[0].mus = s.bodies[0].mu;
        s.mu = s.bodies[0].mu;
      },
      check(s) {
        const b = s.bodies[0];
        if (b.shape === 'box' && mx(b.mus, s.mu) * b.size[1] > 0.9 * b.size[0]) fail('with that much friction the box would tip over: make it wider than it is tall');
      },
      build(W, s) {
        ground(W, -50, 5000);
        const o = Object.assign({}, s.bodies[0], { mu: s.mu, mus: mx(s.bodies[0].mus, s.mu) });
        dyn(W, o, 1, half(o), { fx: s.force, until: s.time });
        W.meta = { end: 'rest' };
      }
    },
    spring: {
      norm(raw, s) {
        const o = typeof raw.orient === 'string' ? raw.orient : typeof raw.direction === 'string' ? raw.direction : '';
        s.orient = /hor|side|flat/i.test(o) ? 'horizontal' : 'vertical';
        s.k = pnum(raw, ['k', 'stiffness', 'springConstant'], 0.5, 20000, 20, 'the spring constant k', 'N/m');
        s.damping = pnum(raw, ['damping', 'c', 'b'], 0, 500, 0, 'the damping', 'N·s/m');
        s.length = pnum(raw, ['length', 'naturalLength', 'L'], 0.1, 5, s.orient === 'vertical' ? 0.5 : 0.8, 'the natural length', 'm');
        s.pull = pnum(raw, ['pull', 'stretch', 'displacement', 'amplitude', 'x0'], -2, 2, 0.15, 'the pull', 'm');
        s.bodies = bodies(raw, 1, 1, { shape: 'box', size: [0.3, 0.3], r: 0.15, mass: 1, mu: 0, e: 0.2 }, 'spring');
        if (s.orient === 'horizontal') { s.bodies[0].mu = 0; s.bodies[0].mus = 0; }
      },
      check(s) {
        const b = s.bodies[0];
        const w = sqrt(s.k / b.mass);
        if (w * DT > 0.35) fail(`the spring is too stiff for the mass: with k = ${sig(s.k)} N/m and ${sig(b.mass)} kg it swings ${sig(w / TAU)} times a second; keep k / m below ${Math.floor(0.35 * 0.35 / DT / DT)}`);
        if (s.damping * DT / b.mass > 0.5) fail('the damping is too strong for the mass: make it smaller or the mass larger');
        const eq = s.orient === 'vertical' ? b.mass * s.g / s.k : 0;
        const shortest = s.length + eq - abs(s.pull);
        if (shortest < 0.25 * s.length || shortest < 0.05) fail(`the spring would close up completely (it starts ${sig(s.pull)} m from where it rests, and rests ${sig(s.length + eq)} m long): make the pull smaller`);
        const longest = s.length + eq + abs(s.pull);
        if (longest > 12) fail(`the spring would stretch to ${sig(longest)} m: make k larger, the mass smaller or the pull smaller`);
      },
      build(W, s) {
        const o = s.bodies[0], hb = half(o);
        if (s.orient === 'vertical') {
          const eq = o.mass * s.g / s.k;
          const top = s.length + eq + abs(s.pull) + 2 * hb + 0.6;
          ground(W, -50, 50);
          const ceil = staticBox(W, 0, top + 0.1, 1.2, 0.2, 'ceiling');
          const y = top - (s.length + eq + s.pull) - hb;
          const b = dyn(W, o, 0, y);
          addSpring(W, null, 0, top, b, 0, hb, s.k, s.length, s.damping);
          W.meta = { anchor: [0, top], equilibrium: top - s.length - eq - hb, ceil, end: 'none' };
        } else {
          ground(W, -50, 50);
          const wall = staticBox(W, -0.15, 0.6, 0.3, 1.2, 'wall');
          const y = hb;
          const x = s.length + s.pull + (o.shape === 'ball' ? o.r : o.size[0] / 2);
          const b = dyn(W, o, x, y);
          addSpring(W, null, 0, y, b, -(o.shape === 'ball' ? o.r : o.size[0] / 2), 0, s.k, s.length, s.damping);
          W.meta = { anchor: [0, y], equilibrium: s.length + (o.shape === 'ball' ? o.r : o.size[0] / 2), wall, end: 'none' };
        }
      }
    },
    pendulum: {
      norm(raw, s) {
        s.length = pnum(raw, ['length', 'L', 'l'], 0.1, 30, 1, 'the length', 'm');
        s.angle = pnum(raw, ['angle', 'theta', 'amplitude'], 1, 170, 20, 'the starting angle', '°');
        s.rope = !(raw.rod === true || raw.rope === false || /rod|bar|stick/i.test(String(raw.string || raw.type || '')));
        s.bodies = bodies(raw, 1, 3, { r: 0.08, mass: 1, e: 0.8 }, 'pendulum');
        const rawList = pick(raw, ['bodies', 'objects']) || [];
        s.bodies.forEach((b, i) => {
          const r = rawList[i] || {};
          b.length = has(r, 'length') ? pnum(r, ['length'], 0.1, 30, undefined, `${b.id}'s length`, 'm') : s.length;
          b.angle = has(r, 'angle') ? pnum(r, ['angle'], 1, 170, undefined, `${b.id}'s angle`, '°') : s.angle;
        });
        if (s.bodies.length === 1) { s.bodies[0].length = s.length; s.bodies[0].angle = s.angle; }
      },
      check(s) {
        s.bodies.forEach((b) => {
          const L = s.bodies.length === 1 ? s.length : b.length;
          if (ext(b) > L / 3) fail(`${b.id}'s bob is too big for a ${sig(L)} m string: make it smaller`);
        });
      },
      build(W, s) {
        const Ls = s.bodies.map((b) => (s.bodies.length === 1 ? s.length : b.length));
        const top = mx(...Ls) + 0.5 + mx(...s.bodies.map(ext));
        const spread = s.bodies.map((b, i) => Ls[i] * dsin(rad(mn(90, s.bodies.length === 1 ? s.angle : b.angle))) + ext(b));
        let x = 0;
        ground(W, -50, 50);
        const pivots = [];
        s.bodies.forEach((o, i) => {
          if (i) x += spread[i - 1] + spread[i] + 0.3;
          const L = Ls[i], ang = rad(s.bodies.length === 1 ? s.angle : o.angle);
          const b = dyn(W, o, x + L * dsin(ang), top - L * dcos(ang), { group: 0 });
          addRod(W, b, 0, 0, null, x, top, L, s.rope);
          pivots.push([x, top]);
        });
        W.meta = { pivots, top, end: 'none' };
      }
    },
    wall: {
      norm(raw, s) {
        s.speed = pnum(raw, ['speed', 'v', 'velocity'], 0.5, 60, ownSpeed(raw, 0.5, 60, 8), 'the speed', 'm/s');
        s.distance = pnum(raw, ['distance', 'd', 'gap'], 1, 30, 3, 'the distance to the wall', 'm');
        const wl = isObj(raw.wall) ? raw.wall : raw;
        s.strength = pnum(wl, ['strength', 'breakingForce', 'break', 'maxForce'], 1, 1e6, 2000, 'the wall\'s strength', 'N');
        s.rows = Math.round(pnum(wl, ['rows'], 1, 12, 6, 'the rows of bricks', ''));
        s.cols = Math.round(pnum(wl, ['cols', 'columns', 'thick'], 1, 4, 2, 'the columns of bricks', ''));
        const bs = Array.isArray(wl.brick) ? wl.brick : [0.3, 0.15];
        s.brick = [pnum({ w: bs[0] }, ['w'], 0.05, 2, 0.3, 'a brick\'s width', 'm'), pnum({ h: bs[1] }, ['h'], 0.03, 1, 0.15, 'a brick\'s height', 'm')];
        s.brickMass = pnum(wl, ['brickMass', 'mass'], 0.05, 100, 1, 'a brick\'s mass', 'kg');
        // a cushion in front of the wall makes a blow last longer (seconds): the same impulse, a smaller force
        s.pad = pnum(isObj(raw.wall) && has(raw.wall, 'pad') ? raw.wall : raw, ['pad', 'cushion', 'contactTime', 'contact'], 0, 1, 0, 'the cushion\'s contact time', 's');
        s.bodies = bodies(raw, 1, 1, { r: 0.15, mass: 2, e: 0.3, mu: 0 }, 'wall');
        s.bodies[0].mu = 0; s.bodies[0].mus = 0;
      },
      check(s) {
        const n = s.rows * s.cols + Math.floor(s.rows / 2);
        if (n + 1 > LIMITS.bodies) fail(`a wall of ${s.rows} rows and ${s.cols} columns has ${n} bricks; at most ${LIMITS.bodies - 1}`);
        const b = s.bodies[0];
        if (half(b) * 2 > s.rows * s.brick[1] * 1.2 + 0.4) fail('the ball is taller than the wall: make the wall higher or the ball smaller');
      },
      build(W, s) {
        ground(W, -50, 100);
        const o = s.bodies[0];
        const x0 = s.distance + ext(o) + 0.5;
        const [bw, bh] = s.brick;
        let k = 0;
        for (let r = 0; r < s.rows; r++) {
          // a running bond: every other row starts with half a brick
          const odd = r % 2 === 1;
          const widths = odd ? [bw / 2, ...new Array(s.cols - 1).fill(bw), bw / 2] : new Array(s.cols).fill(bw);
          if (s.cols === 1) widths.splice(0, widths.length, bw);
          let x = x0;
          widths.forEach((w) => {
            const b = staticBox(W, x + w / 2, r * bh + bh / 2, w, bh, 'brick');
            b.mortar = s.strength; b.wallId = 'W'; b.pad = s.pad; b.brickMass = s.brickMass * w / bw; b.anchored = r === 0; b.e = 0.2; b.mu = 0.6; b.mus = 0.7;
            b.id = 'W' + (++k); b.color = 'brick';
            x += w;
          });
        }
        dyn(W, o, 0.5, half(o), { vx: s.speed });
        W.meta = { wall: [x0, x0 + s.cols * bw, s.rows * bh], end: 'hit' };
      }
    },
    float: {
      norm(raw, s) {
        const fl = isObj(raw.fluid) ? raw.fluid : raw;
        s.density = pnum(fl, ['density', 'rho', 'fluidDensity'], 1, 3000, 1000, 'the fluid density', 'kg/m³');
        s.depth = pnum(fl, ['depth', 'level'], 0.3, 5, 1.2, 'the fluid depth', 'm');
        s.liquid = txt(typeof fl.name === 'string' ? fl.name : raw.liquid, 16);
        s.bodies = bodies(raw, 1, 4, { shape: 'box', size: [0.3, 0.3], mass: 10, e: 0.1, mu: 0.3, cd: 0 }, 'float');
      },
      check(s) {
        const w = s.bodies.reduce((n, b) => n + 2 * ext(b) + 0.3, 0.3);
        if (w > 12) fail('the bodies don\'t fit in the tank: make them smaller or fewer');
        s.bodies.forEach((b) => { if (2 * ext(b) > s.depth * 1.5 + 0.5) fail(`${b.id} is too big for the tank: make it smaller or the water deeper`); });
      },
      build(W, s) {
        const widths = s.bodies.map((b) => 2 * ext(b) + 0.3);
        const tank = mx(2.4, widths.reduce((a, b) => a + b, 0) + 0.3);
        ground(W, -50, 50);
        staticBox(W, -0.1, (s.depth + 1) / 2, 0.2, s.depth + 1, 'tank');
        staticBox(W, tank + 0.1, (s.depth + 1) / 2, 0.2, s.depth + 1, 'tank');
        W.fluids.push({ x0: 0, x1: tank, level: s.depth, density: s.density });
        let x = 0.3;
        s.bodies.forEach((o, i) => {
          x += widths[i] / 2;
          dyn(W, o, x - 0.15, s.depth + half(o) + 0.25, { group: 0 });
          x += widths[i] / 2;
        });
        W.meta = { tank, end: 'settle' };
      }
    },
    free: {
      norm(raw, s) {
        s.ground = raw.ground === false ? false : true;
        s.bodies = bodies(raw, 1, 12, { r: 0.2, mass: 1 }, 'free');
        const rawList = pick(raw, ['bodies', 'objects', 'balls']) || [];
        s.bodies.forEach((b, i) => {
          const r = rawList[i] || {};
          b.at = pair(r.at != null ? r.at : r.pos != null ? r.pos : [r.x, r.y], `${b.id}'s position "at"`, -100, 1000);
          const vv = r.v != null ? r.v : r.velocity != null ? r.velocity : r.vel;
          b.vel = vv != null ? pair(vv, `${b.id}'s velocity "v"`, -100, 100) : [0, 0];
          if (has(r, 'angle')) b.angle = pnum(r, ['angle'], -360, 360, 0, `${b.id}'s angle`, '°');
          if (has(r, 'spin')) b.spin = pnum(r, ['spin', 'w'], -50, 50, 0, `${b.id}'s spin`, 'rad/s');
          b.fixed = pbool(r.fixed != null ? r.fixed : r.static, false);
          if (r.force != null) b.force = pair(r.force, `${b.id}'s force`, -10000, 10000);
          const br = r.break != null ? r.break : r.breakable;
          if (br != null && br !== false) {
            if (b.shape !== 'box') fail(`${b.id} can break only if it is a box`);
            const bo = isObj(br) ? br : { strength: br };
            b.break = {
              strength: pnum(bo, ['strength', 'force'], 1, 1e6, undefined, `${b.id}'s breaking strength`, 'N'),
              rows: Math.round(pnum(bo, ['rows'], 1, 8, b.fixed ? 4 : 2, `${b.id}'s rows of pieces`, '')),
              cols: Math.round(pnum(bo, ['cols', 'columns'], 1, 8, 2, `${b.id}'s columns of pieces`, ''))
            };
          }
        });
        const L = (k) => (Array.isArray(raw[k]) ? raw[k] : []);
        s.walls = L('walls').slice(0, 4).map((w, i) => {
          const o = isObj(w) ? w : { x: w };
          return { x: pnum(o, ['x'], -100, 1000, undefined, `wall ${i + 1}'s x`, 'm'), height: pnum(o, ['height', 'h'], 0.1, 100, 2, `wall ${i + 1}'s height`, 'm') };
        });
        s.ramps = L('ramps').slice(0, 3).map((w, i) => {
          if (!isObj(w)) fail(`ramp ${i + 1} is not an object`);
          const dir = /left/i.test(String(w.dir || w.down || '')) ? 'left' : 'right';
          return { x: pnum(w, ['x', 'at'], -100, 1000, 0, `ramp ${i + 1}'s x`, 'm'), angle: pnum(w, ['angle'], 3, 70, 30, `ramp ${i + 1}'s angle`, '°'),
            length: pnum(w, ['length'], 0.5, 50, 3, `ramp ${i + 1}'s length`, 'm'), dir };
        });
        const ids = new Set(s.bodies.map((b) => b.id));
        const end = (v, what) => {
          if (typeof v === 'string' && ids.has(v.trim())) return v.trim();
          if (typeof v === 'string') fail(`${what} names "${show(v)}", which is not a body`);
          return pair(v, what, -100, 1000);
        };
        s.springs = L('springs').slice(0, 6).map((p, i) => {
          if (!isObj(p)) fail(`spring ${i + 1} is not an object`);
          return { a: end(p.a != null ? p.a : p.from, `spring ${i + 1}'s "a"`), b: end(p.b != null ? p.b : p.to, `spring ${i + 1}'s "b"`),
            k: pnum(p, ['k'], 0.5, 20000, 20, `spring ${i + 1}'s k`, 'N/m'), length: pnum(p, ['length', 'L'], 0.05, 20, undefined, `spring ${i + 1}'s natural length`, 'm'),
            damping: pnum(p, ['damping', 'c'], 0, 500, 0, `spring ${i + 1}'s damping`, 'N·s/m') };
        });
        s.ropes = L('ropes').concat(L('rods')).slice(0, 6).map((p, i) => {
          if (!isObj(p)) fail(`rope ${i + 1} is not an object`);
          return { a: end(p.a != null ? p.a : p.from, `rope ${i + 1}'s "a"`), b: end(p.b != null ? p.b : p.to, `rope ${i + 1}'s "b"`),
            length: pnum(p, ['length', 'L'], 0.05, 30, undefined, `rope ${i + 1}'s length`, 'm'), rod: L('rods').includes(p) || p.rod === true };
        });
        if (isObj(raw.fluid)) {
          const f = raw.fluid;
          const x = Array.isArray(f.x) ? f.x : [0, 3];
          s.fluid = { x: [pnum({ x: x[0] }, ['x'], -100, 1000, 0, 'the fluid\'s left edge', 'm'), pnum({ x: x[1] }, ['x'], -100, 1000, 3, 'the fluid\'s right edge', 'm')],
            level: pnum(f, ['level', 'depth'], 0.1, 50, 1, 'the fluid level', 'm'), density: pnum(f, ['density'], 1, 3000, 1000, 'the fluid density', 'kg/m³') };
          if (s.fluid.x[1] <= s.fluid.x[0]) fail('the fluid needs x: [left, right]');
        }
      },
      check(s) {
        const W = build(s, null);
        const dynb = W.bodies.filter((b) => !b.isStatic);
        if (!s.bodies.some((b) => !b.fixed)) fail('every body is fixed: nothing can move');
        // nothing starts inside anything else
        for (let i = 0; i < W.bodies.length; i++) for (let j = i + 1; j < W.bodies.length; j++) {
          const A = W.bodies[i], B = W.bodies[j];
          if ((A.isStatic && B.isStatic) || !canTouch(A, B) || (A.wallId && A.wallId === B.wallId)) continue;
          const m = collide(A, B, W.slop);
          if (m && m.pts.some((p) => p.sep < -0.01)) fail(`${A.id || 'the ground'} and ${B.id || 'the ground'} overlap at the start: move them apart`);
        }
        dynb.forEach((b) => { if (b.shape === 'ball' && b.r > 0 && b.mass > 0) { /* fine */ } });
        s.springs.forEach((p) => {
          const m = mn(...[p.a, p.b].filter((x) => typeof x === 'string').map((id) => s.bodies.find((b) => b.id === id).mass));
          if (sqrt(p.k / m) * DT > 0.35) fail(`a spring with k = ${sig(p.k)} N/m is too stiff for ${sig(m)} kg: keep k / m below ${Math.floor(0.35 * 0.35 / DT / DT)}`);
        });
      },
      build(W, s) {
        if (s.ground) ground(W, -500, 5000);
        const byId = {};
        s.bodies.forEach((o) => {
          if (o.break && o.fixed) { bricks(W, o); byId[o.id] = null; return; }
          const b = dyn(W, o, o.at[0], o.at[1], { vx: o.vel[0], vy: o.vel[1], a: rad(o.angle || 0), spin: o.spin || 0, fx: o.force ? o.force[0] : 0, fy: o.force ? o.force[1] : 0 });
          if (o.break) b.brk = o.break;
          if (o.fixed) makeStatic(b);
          byId[o.id] = b;
        });
        s.walls.forEach((w) => staticBox(W, w.x, w.height / 2, 0.2, w.height, 'wall'));
        s.ramps.forEach((r) => {
          const a = rad(r.angle), D = r.length * dcos(a), H = r.length * dsin(a);
          staticPoly(W, r.dir === 'right' ? [[r.x, 0], [r.x + D, 0], [r.x, H]] : [[r.x, 0], [r.x + D, 0], [r.x + D, H]], 'ramp');
        });
        const endOf = (v) => (typeof v === 'string' ? byId[v] : null);
        s.springs.forEach((p) => {
          const A = endOf(p.a), B = endOf(p.b);
          if ((typeof p.a === 'string' && !A) || (typeof p.b === 'string' && !B)) return;
          addSpring(W, A, A ? 0 : p.a[0], A ? 0 : p.a[1], B, B ? 0 : p.b[0], B ? 0 : p.b[1], p.k, p.length, p.damping);
        });
        s.ropes.forEach((p) => {
          let A = endOf(p.a), B = endOf(p.b), bx = 0, by = 0;
          if (!A && B) { A = B; B = null; [bx, by] = p.a; }
          else if (!B) { [bx, by] = Array.isArray(p.b) ? p.b : [0, 0]; }
          if (!A || A.isStatic) return;
          addRod(W, A, 0, 0, B, bx, by, p.length, !p.rod);
        });
        if (s.fluid) W.fluids.push({ x0: s.fluid.x[0], x1: s.fluid.x[1], level: s.fluid.level, density: s.fluid.density });
        W.meta = { end: 'land' };
      }
    }
  };
  // a fixed breakable box in a free scene: a panel of bricks held by mortar
  function bricks(W, o) {
    const { rows, cols, strength } = o.break;
    const [w, h] = o.size, bw = w / cols, bh = h / rows;
    const x0 = o.at[0] - w / 2, y0 = o.at[1] - h / 2;
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const b = staticBox(W, x0 + bw * (c + 0.5), y0 + bh * (r + 0.5), bw, bh, 'brick');
      b.mortar = strength; b.wallId = o.id; b.brickMass = o.mass / (rows * cols); b.anchored = r === 0 || c === 0 || c === cols - 1;
      b.e = o.e; b.mu = o.mu; b.mus = o.mus; b.id = o.id + (++k); b.color = o.color === 'red' ? 'brick' : o.color; b.label = o.label;
    }
  }
  function layoutTrack(s) {
    const n = s.bodies.length;
    return s.bodies.map((b, i) => (b.x != null ? b.x : round(s.length * (n === 2 ? [0.2, 0.55][i] : [0.15, 0.45, 0.75][i]))));
  }

  function build(s, vals) {
    const sp = vals ? withVals(s, vals) : s;
    const W = newWorld(sp);
    BUILD[sp.scene].build(W, sp);
    const small = W.bodies.filter((b) => !b.isStatic).map((b) => (b.shape === 'ball' ? b.r : mn(b.hw, b.hh)));
    W.slop = clamp(0.05 * mn(...small, 0.1), 0.0005, 0.005);
    W.spec = sp;
    W.bodies.forEach((b) => { if (!b.isStatic) b.home = { x: b.x, y: b.y, a: b.a }; });
    return W;
  }
  // a slider moved: change the running world where it can (true), or say it must start again (false)
  function applyVar(W, s, name, x) {
    const info = varInfo(s, name);
    if (!info || !info[3]) return false;
    const dot = name.indexOf('.');
    if (dot < 0) {
      if (name === 'g') W.g = x;
      else if (name === 'air') W.air = x;
      else if (name === 'k' || name === 'damping') W.springs.forEach((sp) => { if (name === 'k') sp.k = x; else sp.c = x; });
      else if (name === 'force') W.bodies.forEach((b) => { if (b.fx || b.fy || b.id === s.bodies[0].id) { if (s.scene === 'ramp') { const a = rad(s.angle); b.fx = -x * dcos(a); b.fy = x * dsin(a); } else b.fx = x; } });
      else if (name === 'mu') W.bodies.forEach((b) => { if (!b.isStatic && b.id === s.bodies[0].id) { b.mu = x; b.mus = mx(b.mus, x); } });
      else if (name === 'e') W.bodies.forEach((b) => { if (!b.isStatic) b.e = x; });
      else if (name === 'strength') W.bodies.forEach((b) => { if (b.mortar) b.mortar = x; });
      else if (name === 'pad') W.bodies.forEach((b) => { if (b.wallId) b.pad = x; });
      else if (name === 'density') W.fluids.forEach((f) => { f.density = x; });
      else return false;
      return true;
    }
    const id = name.slice(0, dot), k = name.slice(dot + 1);
    const b = W.bodies.find((o) => o.id === id && !o.isStatic);
    if (!b) return false;
    if (k === 'mass') setMass(b, x);
    else if (k === 'density') setMass(b, clamp(x * b.volume, 0.001, 1000));
    else if (k === 'cd' || k === 'area' || k === 'b' || k === 'e') b[k] = x;
    else if (k === 'mu') { b.mu = x; b.mus = mx(b.mus, x); }
    else return false;
    return true;
  }

  /* ---------------- reading a body: what the panel shows ---------------- */

  function readout(W, b) {
    const F = b.F;
    const list = ['weight', 'drag', 'normal', 'friction', 'spring', 'tension', 'buoyancy', 'applied', 'hand'];
    let nx = 0, ny = 0;
    list.forEach((k) => { nx += F[k][0]; ny += F[k][1]; });
    const v = len2(b.vx, b.vy);
    const ke = 0.5 * b.m * v * v, spin = 0.5 * b.I * b.w * b.w;
    const pe = b.m * W.g * (b.y - b.rest - W.ground);
    let spe = 0, extn = null;
    W.springs.forEach((sp) => { if (sp.A === b || sp.B === b) { spe += 0.5 * sp.k * sp.ext * sp.ext; extn = sp.ext; } });
    let angle = null;
    W.joints.forEach((j) => { if (j.type === 'rod' && j.A === b && !j.B) angle = Math.atan2(b.x - j.bx, j.by - b.y) * 180 / PI; });
    let sub = null;
    W.fluids.forEach((f) => { const s = submerged(b, f); sub = mx(sub || 0, s.frac); });
    return {
      t: W.t, x: b.x, y: b.y, h: b.y - b.rest - W.ground, vx: b.vx, vy: b.vy, v, ax: b.ax, ay: b.ay, a: len2(b.ax, b.ay),
      F, net: [nx, ny], px: b.m * b.vx, py: b.m * b.vy, p: b.m * v, ke, spin, pe, spe, energy: ke + spin + pe + spe,
      ext: extn, angle, sub, m: b.m, impact: b.impact, maxh: b.maxY,
      terminal: b.cd && W.air ? sqrt(2 * b.m * W.g / (W.air * b.cd * b.area)) : b.b ? b.m * W.g / b.b : null
    };
  }
  // the whole system: total momentum and energy
  function totals(W) {
    let px = 0, py = 0, ke = 0;
    W.bodies.forEach((b) => { if (!b.isStatic && !b.dead && !b.loose && !b.piece) { px += b.m * b.vx; py += b.m * b.vy; ke += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy); } });
    return { px, py, ke };
  }

  /* ---------------- tasks ---------------- */

  const GOALS = ['land', 'value', 'stop', 'break', 'slide', 'float'];
  const GOAL_ALIAS = { target: 'land', zone: 'land', hit: 'land', reach: 'value', measure: 'value', reading: 'value', equal: 'value', rest: 'stop', still: 'stop',
    breaks: 'break', smash: 'break', move: 'slide', moves: 'slide', sink: 'float', floats: 'float' };
  // what a value goal can measure, in which scenes, its unit and the smallest tolerance
  const QUANT = {
    range: { scenes: ['projectile', 'free'], unit: 'm', tol: 0.2 },
    height: { scenes: ['projectile', 'drop', 'free', 'pendulum', 'spring', 'collision', 'ramp', 'float', 'push', 'wall'], unit: 'm', tol: 0.05 },
    time: { scenes: ['projectile', 'drop', 'free', 'ramp', 'collision', 'wall'], unit: 's', tol: 0.03 },
    speed: { scenes: SCENES, unit: 'm/s', tol: 0.05 },
    vx: { scenes: SCENES, unit: 'm/s', tol: 0.05 },
    terminal: { scenes: ['drop', 'free'], unit: 'm/s', tol: 0.05 },
    period: { scenes: ['spring', 'pendulum'], unit: 's', tol: 0.02 },
    extension: { scenes: ['spring'], unit: 'm', tol: 0.005 },
    distance: { scenes: ['ramp', 'push', 'free', 'collision'], unit: 'm', tol: 0.05 },
    accel: { scenes: ['push', 'ramp', 'drop', 'free'], unit: 'm/s²', tol: 0.05 },
    force: { scenes: ['wall', 'free', 'drop', 'projectile'], unit: 'N', tol: 1 },
    submerged: { scenes: ['float', 'free'], unit: '%', tol: 2 }
  };
  const Q_ALIAS = { 'max height': 'height', maxheight: 'height', 'maximum height': 'height', 'fall time': 'time', 'time of flight': 'time', flight: 'time',
    v: 'speed', velocity: 'speed', 'final speed': 'speed', 'landing speed': 'speed', 'terminal velocity': 'terminal', 'terminal speed': 'terminal',
    x: 'vx', 'velocity after': 'vx', after: 'vx', acceleration: 'accel', a: 'accel', stretch: 'extension', 'impact force': 'force', impact: 'force',
    'time period': 'period', T: 'period', slide: 'distance', 'stopping distance': 'distance', fraction: 'submerged' };

  function normGoal(s, raw) {
    if (!isObj(raw)) fail('the goal is not an object');
    const t0 = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
    const type = GOALS.includes(t0) ? t0 : GOAL_ALIAS[t0] || '';
    if (!type) fail(`unknown goal type "${show(raw.type)}" (${GOALS.join(', ')})`);
    const moving = s.bodies.filter((b) => !b.fixed);
    const bodyId = (v) => {
      const id = typeof v === 'string' ? v.trim() : moving[0].id;
      const b = moving.find((x) => x.id === id);
      if (!b) fail(`the goal names body "${show(v)}", which is not a moving body in the scene`);
      return id;
    };
    if (type === 'land') {
      const x = Array.isArray(raw.x) ? raw.x : Array.isArray(raw.zone) ? raw.zone : Array.isArray(raw.between) ? raw.between : [raw.from, raw.to];
      const a = num(x[0]), b = num(x[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) fail('a land goal needs "x": [from, to] with from below to');
      if (a < -100 || b > 5000) fail('the landing zone is off the ground');
      if (!['projectile', 'drop', 'free', 'wall', 'ramp', 'push', 'collision'].includes(s.scene)) fail(`a ${s.scene} scene has nothing that lands`);
      return { type, body: bodyId(raw.body), x: [round(a), round(b)] };
    }
    if (type === 'value') {
      const q0 = typeof raw.of === 'string' ? raw.of.trim() : typeof raw.quantity === 'string' ? raw.quantity.trim() : typeof raw.what === 'string' ? raw.what.trim() : '';
      const q = QUANT[q0.toLowerCase()] ? q0.toLowerCase() : Q_ALIAS[q0] || Q_ALIAS[q0.toLowerCase()] || '';
      if (!q) fail(`a value goal measures "of": one of ${Object.keys(QUANT).join(', ')} (got "${show(q0)}")`);
      if (!QUANT[q].scenes.includes(s.scene)) fail(`a ${s.scene} scene can't measure "${q}"`);
      const out = { type, body: bodyId(raw.body), of: q };
      if (raw.at != null) out.at = pnum(raw, ['at'], 0.05, LIMITS.tmax, undefined, 'the time "at"', 's');
      const lo = num(raw.min), hi = num(raw.max), v = num(raw.value != null ? raw.value : raw.equals);
      if (Number.isFinite(v)) {
        let tol = num(raw.tol != null ? raw.tol : raw.tolerance);
        if (!Number.isFinite(tol) || tol <= 0) tol = mx(0.03 * abs(v), QUANT[q].tol);
        tol = mx(tol, QUANT[q].tol);
        out.value = round(v); out.tol = round(mn(tol, mx(0.25 * abs(v), QUANT[q].tol * 2)));
      } else if (Number.isFinite(lo) || Number.isFinite(hi)) {
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi <= lo) fail('the goal\'s "min" must be below its "max"');
        if (Number.isFinite(lo)) out.min = round(lo);
        if (Number.isFinite(hi)) out.max = round(hi);
      } else fail('a value goal needs a "value" (with "tol"), or "min" and "max"');
      return out;
    }
    if (type === 'stop') return { type, body: bodyId(raw.body) };
    if (type === 'slide') return { type, body: bodyId(raw.body), moves: pbool(raw.moves, true) };
    if (type === 'float') {
      if (s.scene !== 'float' && !s.fluid) fail('a float goal needs a fluid');
      return { type, body: bodyId(raw.body), floats: pbool(raw.floats, true) };
    }
    // break
    const targets = s.scene === 'wall' ? ['W'] : s.bodies.filter((b) => b.break).map((b) => b.id);
    if (!targets.length) fail('a break goal needs something breakable (a wall scene, or a box with "break")');
    const tg = typeof raw.target === 'string' && targets.includes(raw.target.trim()) ? raw.target.trim() : targets[0];
    return { type, target: tg, breaks: pbool(raw.breaks != null ? raw.breaks : raw.want, true) };
  }

  // how long to run, and when the answer is known
  function horizon(s, goal) {
    if (goal.at != null) return goal.at + DT;
    if (goal.type === 'value' && (goal.of === 'period' || goal.of === 'extension')) {
      const T = s.scene === 'spring' ? TAU * sqrt(s.bodies[0].mass / s.k) : TAU * sqrt(mx(...s.bodies.map((b) => (s.bodies.length === 1 ? s.length : b.length))) / mx(s.g, 0.1));
      return mn(LIMITS.tmax, mx(4.2 * T, 2));
    }
    if (goal.type === 'float' || (goal.type === 'value' && goal.of === 'submerged')) return 12;
    return LIMITS.tmax;
  }

  // run the scene with these slider values, watching what the goal needs: { got, ok, ...detail }
  function measure(s0, vals, goal, budget) {
    const W = build(s0, vals);
    const s = W.spec;
    // the body to watch (for a break goal, the first that moves: what hits it, or what falls)
    const b = W.bodies.find((o) => !o.isStatic && (goal.body ? o.id === goal.body : !o.mortar));
    const end = horizon(s, goal);
    const st = { firstHit: null, after: null, broke: null, turns: [], ext: [], extT: [], bottom: null, moved: false, rest: 0, accel: null, startV: b ? len2(b.vx, b.vy) : 0, landed: null };
    const sx = b ? b.x : 0, sy = b ? b.y : 0;
    const prevV = { x: b ? b.vx : 0, y: b ? b.vy : 0 };
    let steps = 0;
    const meta = W.meta;
    const ramp = s.scene === 'ramp' ? meta.foot : null;
    while (W.t < end - 1e-9) {
      step(W);
      steps++;
      if (budget) { budget.left--; if (budget.left < 0) return null; }
      for (const e of W.events) {
        if (e.type === 'land' && e.b === b && !st.landed) st.landed = e;
        if (e.type === 'hit' && b && (e.a === b || e.b === b) && !st.firstHit) st.firstHit = { t: e.t, force: e.force };
        if (e.type === 'break' && !st.broke && (goal.type !== 'break' || e.target === goal.target)) st.broke = e;
      }
      if (!b) break;
      if (b.hitNow && !b.hitNow.other.isStatic && !st.firstHit) st.firstHit = { t: W.t, force: b.hitNow.force };
      if (s.scene === 'wall' && b.hitNow && b.hitNow.other.mortar !== undefined && b.hitNow.other.kind === 'brick' && !st.firstHit) st.firstHit = { t: W.t, force: b.hitNow.force };
      // after a collision: the velocity a tenth of a second later
      if (st.firstHit && !st.after && W.t >= st.firstHit.t + 0.1 - 1e-9) st.after = { vx: b.vx, vy: b.vy, v: len2(b.vx, b.vy), t: W.t };
      if (ramp != null && !st.bottom && b.onGround) st.bottom = b.onGround;
      // turning points, for a period: the moment the velocity turns from + to -
      const coord = s.scene === 'spring' && s.orient === 'vertical' ? 'vy' : 'vx';
      const cur = coord === 'vy' ? b.vy : b.vx, was = coord === 'vy' ? prevV.y : prevV.x;
      if (was > 0 && cur <= 0) st.turns.push(W.t - DT + DT * was / (was - cur));
      if (W.springs.length) { st.ext.push(W.springs[0].ext); st.extT.push(W.t); }
      prevV.x = b.vx; prevV.y = b.vy;
      const v = len2(b.vx, b.vy);
      if (len2(b.x - sx, b.y - sy) > 0.01) st.moved = true;
      st.rest = v < 0.01 && b.touch ? st.rest + 1 : 0;
      if (st.accel == null && (W.t >= 1 - 1e-9 || (st.bottom && s.scene === 'ramp') || (st.landed && s.scene !== 'push'))) st.accel = { a: (v - (st.startV || 0)) / W.t, t: W.t };
      // done early: the goal's answer is known
      if (done(s, goal, st, W, b)) break;
    }
    return result(s, goal, st, W, b, sx, sy, steps);
  }
    function done(s, goal, st, W, b) {
    if (goal.at != null) return false;
    // settled: nothing more will happen
    if (st.rest > 120 && W.t > 2 && goal.type !== 'float' && !(goal.type === 'value' && ['period', 'extension', 'submerged'].includes(goal.of))) return true;
    if (goal.type === 'land') return Boolean(st.landed);
    if (goal.type === 'break') { const first = st.firstHit || st.landed; return Boolean(st.broke) || Boolean(first && W.t > first.t + 1) || W.t > 15; }
    if (goal.type === 'stop') return Boolean(st.after) || (st.rest > 30);
    if (goal.type === 'slide') return st.moved || W.t > 3;
    if (goal.type === 'float') return false;
    switch (goal.of) {
      case 'range': case 'time': case 'terminal': return Boolean(st.landed) || (s.scene === 'ramp' && Boolean(st.bottom)) || (endsOnHit(s) && Boolean(st.firstHit));
      case 'height': return Boolean(st.landed) || (W.t > 1 && b.vy < 0 && !['pendulum', 'spring'].includes(s.scene) && b.touch);
      case 'speed': case 'vx':
        if (endsOnHit(s)) return Boolean(st.after);
        if (s.scene === 'ramp') return Boolean(st.bottom);
        if (s.scene === 'push') return st.rest > 30 && W.t > s.time;
        return Boolean(st.landed);
      case 'distance': return st.moved && st.rest > 30;
      case 'accel': return st.accel != null;
      case 'force': return Boolean(st.firstHit) || Boolean(st.landed) || Boolean(st.broke);
      default: return false;
    }
  }
  const endsOnHit = (s) => s.scene === 'collision' || s.scene === 'wall';
  function result(s, goal, st, W, b, sx, sy, steps) {
    const r = { steps, t: W.t };
    if (goal.type === 'break') { r.got = Boolean(st.broke); r.force = st.broke ? st.broke.force : peakImpact(W); r.strength = strengthOf(s, goal); r.ok = r.got === goal.breaks; return r; }
    if (goal.type === 'land') {
      r.landed = Boolean(st.landed);
      r.got = st.landed ? st.landed.x : null;
      r.ok = r.landed && r.got >= goal.x[0] && r.got <= goal.x[1];
      return r;
    }
    if (goal.type === 'stop') { const v = st.after ? st.after.v : len2(b.vx, b.vy); r.got = v; r.ok = v <= 0.05 + 0.02 * abs(st.startV || 0); r.hit = Boolean(st.firstHit); return r; }
    if (goal.type === 'slide') { r.got = st.moved; r.ok = st.moved === goal.moves; return r; }
    if (goal.type === 'float') {
      r.sub = W.fluids.length ? submerged(b, W.fluids[0]).frac * 100 : 0;
      const onBottom = W.bodies.some((o) => o.isStatic && o.kind === 'ground' && W.contacts.has(mn(o.key, b.key) * 100000 + mx(o.key, b.key)));
      r.got = !onBottom; r.ok = r.got === goal.floats; return r;
    }
    let got = null;
    const at = goal.at != null;
    switch (goal.of) {
      case 'range': got = st.landed ? st.landed.x - (b.launch ? b.launch[0] : sx) : null; break;
      case 'height': got = b.maxY; break;
      case 'time': got = at ? W.t : s.scene === 'ramp' ? (st.bottom ? st.bottom.t : null) : endsOnHit(s) ? (st.firstHit ? st.firstHit.t : null) : st.landed ? st.landed.t : null; break;
      case 'terminal': {
        if (st.landed) { got = st.landed.speed; r.reached = abs(st.landed.ay) < 0.05 * mx(W.g, 0.1); }
        else { got = len2(b.vx, b.vy); r.reached = abs(b.ay) < 0.05 * mx(W.g, 0.1); }
        break;
      }
      case 'speed': case 'vx': {
        const k = goal.of === 'vx' ? 'vx' : 'v';
        if (at) got = k === 'vx' ? b.vx : len2(b.vx, b.vy);
        else if (endsOnHit(s)) got = st.after ? st.after[k] : null;
        else if (s.scene === 'ramp') got = st.bottom ? (k === 'vx' ? st.bottom.vx : st.bottom.v) : null;
        else if (st.landed) got = k === 'vx' ? b.vx : st.landed.speed;
        else got = k === 'vx' ? b.vx : len2(b.vx, b.vy);
        break;
      }
      case 'period': {
        const tt = st.turns;
        got = tt.length >= 3 ? (tt[tt.length - 1] - tt[0]) / (tt.length - 1) : tt.length === 2 ? tt[1] - tt[0] : null;
        break;
      }
      case 'extension': {
        // the mean over whole swings is where it rests
        const tt = st.turns, E = st.ext, T = st.extT;
        if (tt.length >= 2) {
          const t0 = tt[0], t1 = tt[tt.length - 1];
          let area = 0;
          for (let i = 1; i < E.length; i++) {
            const a = mx(T[i - 1], t0), b = mn(T[i], t1);
            if (b <= a) continue;
            const at = (t) => E[i - 1] + (E[i] - E[i - 1]) * (t - T[i - 1]) / (T[i] - T[i - 1]);
            area += (at(a) + at(b)) / 2 * (b - a);
          }
          got = area / (t1 - t0);
        } else got = E.length ? E[E.length - 1] : null;
        break;
      }
      case 'distance': got = len2(b.x - sx, b.y - sy); break;
      case 'accel': got = st.accel ? st.accel.a : null; break;
      case 'force': got = st.broke ? st.broke.force : b.impact; break;
      case 'submerged': got = W.fluids.length ? submerged(b, W.fluids[0]).frac * 100 : 0; break;
    }
    r.got = got;
    if (got == null || !Number.isFinite(got)) { r.ok = false; r.none = true; return r; }
    if (goal.of === 'terminal' && !r.reached) { r.ok = false; return r; }
    r.ok = goal.value != null ? abs(got - goal.value) <= goal.tol + 1e-9 : (goal.min == null || got >= goal.min - 1e-9) && (goal.max == null || got <= goal.max + 1e-9);
    return r;
  }
  const peakImpact = (W) => W.bodies.reduce((m, b) => (b.isStatic ? m : mx(m, b.impact)), 0);
  const strengthOf = (s, goal) => (s.scene === 'wall' ? s.strength : (s.bodies.find((b) => b.id === goal.target) || {}).break ? s.bodies.find((b) => b.id === goal.target).break.strength : 0);

  // met with room to spare: the answer the app gives must not be on a knife's edge
  function robust(s, goal, r) {
    if (!r.ok) return false;
    if (goal.type === 'break') return goal.breaks ? r.force > 1.03 * r.strength : r.force < 0.97 * r.strength;
    if (goal.type === 'land') { const w = goal.x[1] - goal.x[0]; return r.got >= goal.x[0] + 0.1 * w && r.got <= goal.x[1] - 0.1 * w; }
    if (goal.type === 'value') {
      if (goal.value != null) return abs(r.got - goal.value) <= 0.8 * goal.tol;
      const w = goal.min != null && goal.max != null ? goal.max - goal.min : abs(goal.min != null ? goal.min : goal.max) * 0.2 + QUANT[goal.of].tol;
      return (goal.min == null || r.got >= goal.min + 0.05 * w) && (goal.max == null || r.got <= goal.max - 0.05 * w);
    }
    if (goal.type === 'stop') return r.got <= 0.03;
    // floating with some of it showing, not hanging just under the surface
    if (goal.type === 'float') return goal.floats ? r.sub < 95 : true;
    return true;
  }

  // the settings to try, nearest the start first
  function ordered(s) {
    const start = startVals(s);
    const all = [];
    for (const v of combos(s).all()) {
      let d = 0, n = 0;
      s.sliders.forEach((c) => { const k = abs(v[c.var] - start[c.var]) / c.step; d += k; if (k > 1e-9) n++; });
      all.push([n * 1000 + d, v]);
    }
    all.sort((a, b) => a[0] - b[0]);
    return all.map((x) => x[1]);
  }

  // a setting that meets the goal (robustly if one does), or null; and what the settings reached, for the reason
  function search(s, goal) {
    const budget = { left: LIMITS.budget };
    let fallback = null;
    const seen = [];
    for (const v of ordered(s)) {
      const r = measure(s, v, goal, budget);
      if (!r) return { solve: fallback, seen, out: true };
      seen.push(r);
      if (robust(s, goal, r)) return { solve: v, seen };
      if (r.ok && !fallback) fallback = v;
    }
    return { solve: fallback, seen };
  }

  // A task: the scene and its goal, checked: the goal can be met by some slider setting, and isn't met at the start
  function normTask(rawSpec, rawGoal, opts) {
    const spec = normSpec(rawSpec);
    const goal = normGoal(spec, rawGoal);
    if (!spec.sliders.length) fail('the task gives the learner nothing to change: add "sliders"');
    if (combos(spec).count > LIMITS.combos) fail(`the sliders make ${combos(spec).count} settings to check; keep it to ${LIMITS.combos} (fewer steps)`);
    if (goal.type === 'land' && !spec.target) spec.target = { x: goal.x.slice() };
    if (opts && opts.light) {
      if (isObj(rawGoal.solve) && isObj(rawGoal.solve.v)) goal.solve = { v: clean(spec, rawGoal.solve.v) };
      return { spec, goal };
    }
    const r0 = measure(spec, startVals(spec), goal, null);
    if (r0.ok) fail(`the scene already meets the goal as it starts (${said(spec, goal, r0)}): start a slider somewhere else`);
    const found = search(spec, goal);
    if (!found.solve) fail(found.out ? 'too many settings to check: use fewer sliders or fewer steps' : nothing(spec, goal, found.seen));
    goal.solve = { v: found.solve };
    return { spec, goal };
  }
  const clean = (s, v) => { const out = {}; s.sliders.forEach((c) => { out[c.var] = onSlider(c, num(v[c.var] != null ? v[c.var] : getVar(s, c.var))); }); return out; };

  // in words, for the reasons sent back to the AI
  const U = (goal) => (goal.type === 'land' ? 'm' : goal.type === 'value' ? QUANT[goal.of].unit : '');
  const gname = (goal) => (goal.type === 'value' ? goal.of : goal.type);
  function said(s, goal, r) {
    if (goal.type === 'break') return r.got ? `the wall breaks: the impact is ${sig(r.force)} N against a strength of ${sig(r.strength)} N` : `the impact is ${sig(r.force)} N against a strength of ${sig(r.strength)} N`;
    if (goal.type === 'land') return r.landed ? `${goal.body} lands at x = ${sig(r.got)} m` : `${goal.body} never lands`;
    if (goal.type === 'stop') return `${goal.body} moves at ${sig(r.got)} m/s after it`;
    if (goal.type === 'slide') return r.got ? `${goal.body} moves` : `${goal.body} stays put`;
    if (goal.type === 'float') return r.got ? `${goal.body} floats` : `${goal.body} sinks`;
    if (r.none) return `${goal.body}'s ${goal.of} can't be measured`;
    return `${goal.body}'s ${goal.of} is ${sig(r.got)} ${U(goal)}`;
  }
  function wanted(goal) {
    if (goal.type === 'land') return `land between x = ${sig(goal.x[0])} and ${sig(goal.x[1])} m`;
    if (goal.type === 'break') return goal.breaks ? 'break the wall' : 'leave the wall standing';
    if (goal.type === 'stop') return `stop ${goal.body} after the collision`;
    if (goal.type === 'slide') return goal.moves ? `make ${goal.body} move` : `keep ${goal.body} still`;
    if (goal.type === 'float') return goal.floats ? `make ${goal.body} float` : `make ${goal.body} sink`;
    if (goal.value != null) return `make ${goal.body}'s ${goal.of} ${sig(goal.value)} ${U(goal)} (within ${sig(goal.tol)})`;
    return `make ${goal.body}'s ${goal.of} ${goal.min != null ? 'at least ' + sig(goal.min) : ''}${goal.min != null && goal.max != null ? ' and ' : ''}${goal.max != null ? 'at most ' + sig(goal.max) : ''} ${U(goal)}`;
  }
  function nothing(s, goal, seen) {
    const nums = seen.map((r) => (typeof r.got === 'number' && Number.isFinite(r.got) ? r.got : null)).filter((x) => x != null);
    let span = '';
    if (goal.type === 'break') { const f = seen.map((r) => r.force || 0); span = `; the hardest impact is ${sig(mx(...f))} N and the softest ${sig(mn(...f))} N, against a strength of ${sig(seen[0].strength)} N`; }
    else if (goal.type === 'value' && goal.of === 'terminal' && seen.some((r) => r.reached === false)) span = `; ${goal.body} is still speeding up when it lands, so it never reaches its terminal velocity: make the drop higher`;
    else if (nums.length) span = `; across the sliders it ${goal.type === 'land' ? 'lands' : goal.type === 'stop' ? 'moves on at' : 'is'} from ${sig(mn(...nums))} to ${sig(mx(...nums))} ${U(goal) || (goal.type === 'stop' ? 'm/s' : '')}`;
    else if (seen.length && seen.every((r) => r.none || r.landed === false)) span = goal.type === 'land' || ['range', 'time'].includes(goal.of) ? `; ${goal.body} never lands` : `; it can't be measured in this scene`;
    return `no slider setting can ${wanted(goal)}${span}`;
  }

  // the learner's attempt, checked: { correct, invalid?, r }
  function check(s, goal, value) {
    if (!isObj(value) || !isObj(value.v)) return { correct: false, invalid: true };
    const v = clean(s, value.v);
    const r = measure(s, v, goal, null);
    return { correct: Boolean(r && r.ok), r };
  }
  // the setting that does it: the server's, checked, or found here
  function solution(s, goal) {
    if (goal.solve && isObj(goal.solve.v)) {
      const r = measure(s, clean(s, goal.solve.v), goal, null);
      if (r && r.ok) return clean(s, goal.solve.v);
    }
    const f = search(s, goal);
    return f.solve;
  }

  /* ---------------- where the camera looks ---------------- */

  // the part of the world to show: [x0, y0, x1, y1], and whether the camera follows a body
  function view(s) {
    const W = build(s, null);
    let x0 = Infinity, y0 = 0, x1 = -Infinity, y1 = -Infinity;
    const grow = (a, b, c, d) => { x0 = mn(x0, a); y0 = mn(y0, b); x1 = mx(x1, c); y1 = mx(y1, d); };
    W.bodies.forEach((b) => { if (b.kind === 'ground') return; grow(b.minx, b.miny, b.maxx, b.maxy); });
    W.joints.forEach((j) => { if (!j.B) grow(j.bx - 0.2, j.by - 0.2, j.bx + 0.2, j.by + 0.3); });
    W.springs.forEach((sp) => { if (!sp.A) grow(sp.ax - 0.2, sp.ay - 0.2, sp.ax + 0.2, sp.ay + 0.2); });
    W.fluids.forEach((f) => grow(f.x0, 0, f.x1, f.level));
    let follow = null;
    if (s.scene === 'projectile') {
      // the whole flight, for every slider setting
      let R = 1, H = 1;
      const tries = combos(s).count <= 400 ? [...combos(s).all()] : [{}];
      for (const v of tries) {
        const o = withVals(s, v);
        const a = rad(o.angle), ux = o.speed * dcos(a), uy = o.speed * dsin(a), g = mx(o.g, 0.5);
        const T = (uy + sqrt(uy * uy + 2 * g * o.height)) / g;
        R = mx(R, ux * T); H = mx(H, o.height + uy * uy / (2 * g));
      }
      grow(-1, 0, R * 1.06 + 0.5, H * 1.12 + 0.3);
    }
    if (s.scene === 'pendulum') W.meta.pivots.forEach((p, i) => { const L = s.bodies.length === 1 ? s.length : s.bodies[i].length; grow(p[0] - L - 0.2, p[1] - L - 0.3, p[0] + L + 0.2, p[1] + 0.3); });
    if (s.scene === 'collision') grow(-0.5, 0, s.length + 0.5, 1);
    if (s.scene === 'push') { grow(-0.5, 0, 8, 1.5); follow = 'x'; }
    if (s.scene === 'ramp') grow(-0.5, 0, W.meta.foot + mn(s.floor, 8) + 0.5, W.meta.top + 0.6);
    if (s.scene === 'wall') grow(-0.3, 0, W.meta.wall[1] + 2.5, mx(W.meta.wall[2] + 0.6, 1.5));
    if (s.scene === 'spring' && s.orient === 'horizontal') grow(-0.4, 0, s.length * 2.2 + 0.6, 1.2);
    if (s.scene === 'drop') { grow(-W.meta.lanes * 0.6, 0, W.meta.lanes * (s.bodies.length - 0.4), s.height * 1.05 + 0.5); if (s.height > 60) follow = 'y'; }
    if (s.scene === 'free') { grow(-0.5, 0, 0.5, 0.5); if (s.target) grow(s.target.x[0], 0, s.target.x[1], 0.2); }
    if (s.target) grow(s.target.x[0] - 0.5, 0, s.target.x[1] + 0.5, 0.2);
    s.labels.forEach((l) => grow(l.at[0] - 0.3, l.at[1] - 0.2, l.at[0] + 0.3, l.at[1] + 0.2));
    if (!Number.isFinite(x0)) { x0 = -1; x1 = 5; y1 = 3; }
    const pad = 0.06 * mx(x1 - x0, y1 - y0);
    return { x0: x0 - pad, y0: mn(y0, 0) - pad * 0.5 - 0.05 * (y1 - y0), x1: x1 + pad, y1: y1 + pad, follow };
  }

  /* ---------------- numbers, as a textbook writes them ---------------- */

  function fmt(x, unit) {
    if (x == null || !Number.isFinite(x)) return '—';
    const a = abs(x);
    let s;
    if (a < 5e-4) s = '0';
    else if (a >= 1e5) { const e = Math.floor(Math.log10(a)); s = sig(x / Math.pow(10, e)) + ' × 10' + String(e).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d] || d).join(''); }
    else if (a >= 1000) s = String(Math.round(Number(x.toPrecision(3))));
    else s = sig(x);
    if (s === '-0') s = '0';
    return unit ? (unit === '°' || unit === '%' ? s + unit : s + ' ' + unit) : s;
  }

  return {
    DT, LIMITS, SCENES, COLORS, PLANETS, PhysicsError, BODY_VARS, SCENE_VARS, QUANT,
    normSpec, normGoal, normTask, blockProblem, build, step, applyVar, readout, totals, grab, release, rodGeom, springGeom, submerged,
    measure, check, solution, search, view, varInfo, getVar, startVals, onSlider, clean, combos, withVals,
    fmt, sig, dsin, dcos, num, text: txt
  };
});
