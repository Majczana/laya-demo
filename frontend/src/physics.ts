/**
 * Minimal position-based physics for the emoji pile.
 *
 * Grounded bodies fall under gravity, collide as circles and fall asleep once
 * they stop moving, so the pile lies perfectly still. Lifted bodies are
 * kinematic ghosts: a damped spring pulls them to their slot in the floating
 * row and they pass through the pile, letting whatever rested on them fall into
 * the gap. Releasing a body simply returns it to gravity, so it drops limply
 * and lands on the pile.
 */

const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 6;
const GRAVITY = 2600;
const ITERATIONS = 4;
const FLOOR_FRICTION = 0.92;
const AIR_DAMPING = 0.999;
const SLEEP_SPEED = 14;
const SLEEP_STEPS = 40;
const WAKE_SPEED = 260;
const TIP_PX = 0.25;
const SPRING = 90;
const SPRING_DAMPING = 17;
export const LIFT_SCALE = 1.55;

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  scale: number;
  lifted: boolean;
  asleep: boolean;
  still: number;
  targetX: number;
  targetY: number;
  phase: number;
};

export class World {
  bodies: Body[] = [];
  width = 0;
  height = 0;
  radius = 20;
  private accumulator = 0;
  private time = 0;
  private prevX = new Float64Array(0);
  private prevY = new Float64Array(0);
  private order: number[] = [];

  constructor(count: number, width: number, height: number) {
    this.resize(width, height);
    for (let index = 0; index < count; index += 1) {
      const r = this.radius;
      this.bodies.push({
        x: r + Math.random() * Math.max(1, width - 2 * r),
        y: -r - Math.random() * height * 1.4 - index * 3,
        vx: (Math.random() - 0.5) * 120,
        vy: 0,
        r,
        angle: (Math.random() - 0.5) * Math.PI,
        scale: 1,
        lifted: false,
        asleep: false,
        still: 0,
        targetX: 0,
        targetY: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    // Keep the resting pile at roughly a quarter of the screen height.
    this.radius = Math.min(26, Math.max(14, Math.sqrt(width * height) * 0.026));
    for (const body of this.bodies) {
      body.r = this.radius;
      body.asleep = false;
      body.still = 0;
    }
  }

  lift(index: number, targetX: number, targetY: number) {
    const body = this.bodies[index];
    body.targetX = targetX;
    body.targetY = targetY;
    if (body.lifted) return;
    body.lifted = true;
    body.asleep = false;
    this.wakeAround(body);
  }

  release(index: number) {
    const body = this.bodies[index];
    if (!body.lifted) return;
    body.lifted = false;
    body.asleep = false;
    body.still = 0;
    // Drop from rest: no leftover spring momentum, just gravity.
    body.vx *= 0.2;
    body.vy = Math.max(0, body.vy);
  }

  advance(seconds: number) {
    this.accumulator = Math.min(
      this.accumulator + seconds,
      STEP * MAX_STEPS_PER_FRAME,
    );
    while (this.accumulator >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
  }

  private wakeAround(source: Body) {
    const reach = source.r * 4;
    for (const body of this.bodies) {
      if (body === source || body.lifted) continue;
      if (Math.hypot(body.x - source.x, body.y - source.y) < reach) {
        body.asleep = false;
        body.still = 0;
      }
    }
  }

  private step(dt: number) {
    this.time += dt;
    const bodies = this.bodies;
    if (this.prevX.length !== bodies.length) {
      this.prevX = new Float64Array(bodies.length);
      this.prevY = new Float64Array(bodies.length);
      this.order = bodies.map((_, index) => index);
    }
    const { prevX, prevY } = this;

    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      prevX[index] = body.x;
      prevY[index] = body.y;
      const targetScale = body.lifted ? LIFT_SCALE : 1;
      body.scale += (targetScale - body.scale) * Math.min(1, dt * 9);

      if (body.lifted) {
        const bob = Math.sin(this.time * 2.1 + body.phase) * body.r * 0.12;
        const ax = SPRING * (body.targetX - body.x) - SPRING_DAMPING * body.vx;
        const ay =
          SPRING * (body.targetY + bob - body.y) - SPRING_DAMPING * body.vy;
        body.vx += ax * dt;
        body.vy += ay * dt;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.angle *= 1 - Math.min(1, dt * 6);
        continue;
      }
      if (body.asleep) continue;

      body.vy += GRAVITY * dt;
      body.vx *= AIR_DAMPING;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }

    // Sweep and prune: sorted by x, a pair can only touch while their x ranges
    // overlap. Insertion sort is near-linear because order barely changes.
    const order = this.order;
    for (let i = 1; i < order.length; i += 1) {
      const current = order[i];
      const x = bodies[current].x;
      let j = i - 1;
      while (j >= 0 && bodies[order[j]].x > x) {
        order[j + 1] = order[j];
        j -= 1;
      }
      order[j + 1] = current;
    }

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      this.solveContacts();
      this.solveBounds();
    }

    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      if (body.lifted || body.asleep) continue;

      body.vx = (body.x - prevX[index]) / dt;
      body.vy = (body.y - prevY[index]) / dt;

      const onFloor = body.y + body.r >= this.height - 0.5;
      if (onFloor) body.vx *= FLOOR_FRICTION;
      // Roll with horizontal motion so landings look like a real tumble.
      body.angle += (body.vx * dt) / body.r;

      if (Math.hypot(body.vx, body.vy) < SLEEP_SPEED) {
        body.still += 1;
        if (body.still >= SLEEP_STEPS) {
          body.asleep = true;
          body.vx = 0;
          body.vy = 0;
        }
      } else {
        body.still = 0;
      }
    }
  }

  private solveContacts() {
    const bodies = this.bodies;
    const order = this.order;
    const maxReach = this.radius * 2 * LIFT_SCALE + 1.5;
    for (let i = 0; i < order.length; i += 1) {
      const a = bodies[order[i]];
      if (a.lifted) continue;
      for (let j = i + 1; j < order.length; j += 1) {
        const b = bodies[order[j]];
        if (b.x - a.x > maxReach) break;
        if (b.lifted) continue;
        if (a.asleep && b.asleep) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r * a.scale + b.r * b.scale;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq >= (reach + 1.5) * (reach + 1.5)) continue;
        const distance = Math.sqrt(distanceSq) || 0.001;

        if (a.asleep || b.asleep) {
          const awake = a.asleep ? b : a;
          const sleeper = a.asleep ? a : b;
          const fast = Math.hypot(awake.vx, awake.vy) > WAKE_SPEED;
          // A body falling away from underneath removes the sleeper's support.
          const supportLost = awake.y > sleeper.y && awake.vy > 20;
          if (fast || supportLost) {
            sleeper.asleep = false;
            sleeper.still = 0;
          }
        }

        const overlap = reach - distance;
        if (overlap <= 0) continue;

        const weightA = a.asleep ? 0 : 1;
        const weightB = b.asleep ? 0 : 1;
        const total = weightA + weightB;
        if (total === 0) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const push = overlap / total;
        a.x -= nx * push * weightA;
        a.y -= ny * push * weightA;
        b.x += nx * push * weightB;
        b.y += ny * push * weightB;

        if (Math.abs(nx) < 0.05) {
          // A perfectly vertical stack is only stable on paper: tip the upper
          // body towards the screen centre so it rolls off.
          const upper = a.y < b.y ? a : b;
          if (!upper.asleep) {
            upper.x += upper.x < this.width / 2 ? TIP_PX : -TIP_PX;
          }
        }
      }
    }
  }

  private solveBounds() {
    for (const body of this.bodies) {
      if (body.lifted || body.asleep) continue;
      const r = body.r * body.scale;
      // Walls lean slightly inwards so nothing stays stuck against them.
      if (body.x < r) body.x = r + TIP_PX;
      if (body.x > this.width - r) body.x = this.width - r - TIP_PX;
      if (body.y > this.height - r) body.y = this.height - r;
    }
  }
}
