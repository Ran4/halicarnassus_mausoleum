// First-person walking (and optional flying) with pointer lock, simple AABB collision and ground following.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { clamp } from './util.js';

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera; this.world = world;
    this.controls = new PointerLockControls(camera, dom);
    this.keys = new Set();
    this.fly = false;
    this.eye = 1.7;
    this.vel = new THREE.Vector3();
    this.vy = 0; this.grounded = true;
    this.pos = camera.position;
    dom.ownerDocument.addEventListener('keydown', e => {
      if (e.code === 'KeyF') { this.fly = !this.fly; this.vy = 0; this.onFlyChange?.(this.fly); }
      this.keys.add(e.code);
    });
    dom.ownerDocument.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.ownerDocument.addEventListener('blur', () => this.keys.clear());
  }
  get locked() { return this.controls.isLocked; }
  lock() { this.controls.lock(); }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const right = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0));
    const wish = new THREE.Vector3().addScaledVector(this.fly ? dir : flat, fwd).addScaledVector(right, side);
    if (this.fly) { if (k.has('Space') || k.has('KeyE')) wish.y += 1; if (k.has('ControlLeft') || k.has('KeyQ') || k.has('KeyC')) wish.y -= 1; }
    if (wish.lengthSq() > 0) wish.normalize();
    const speed = this.fly ? (run ? 60 : 18) : (run ? 7.5 : 3.2) * 2.25;   // walking +125%, unrealistically brisk on purpose
    // smooth acceleration
    const target = wish.multiplyScalar(speed);
    const accel = this.fly ? 6 : 12;
    this.vel.lerp(target, 1 - Math.exp(-accel * dt));

    const p = this.pos;
    if (this.fly) {
      p.addScaledVector(this.vel, dt);
      const g = this.world.groundHeight(p.x, p.z) + 0.5;
      if (p.y < g) p.y = g;
      return;
    }
    // walking: move on XZ with collision, then follow ground
    const feet = p.y - this.eye;
    const tryMove = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      if (this.world.blocked(nx, nz, feet) || this.world.dynamicBlocked?.(nx, nz, p.x, p.z)) return false;
      const gh = this.world.groundHeight(nx, nz);
      if (gh - feet > 0.55) return false;      // too high to step up
      p.x = nx; p.z = nz; return true;
    };
    if (!tryMove(this.vel.x * dt, this.vel.z * dt)) {
      if (!tryMove(this.vel.x * dt, 0)) this.vel.x = 0;
      if (!tryMove(0, this.vel.z * dt)) this.vel.z = 0;
    }
    const gh = this.world.groundHeight(p.x, p.z);
    const targetY = gh + this.eye;
    if (k.has('Space') && this.grounded) { this.vy = 4.2; this.grounded = false; }
    if (!this.grounded) {
      this.vy -= 12 * dt; p.y += this.vy * dt;
      if (p.y <= targetY) { p.y = targetY; this.vy = 0; this.grounded = true; }
    } else {
      // smooth stepping
      p.y += (targetY - p.y) * (1 - Math.exp(-14 * dt));
      if (targetY - p.y < -1.0) { this.grounded = false; this.vy = 0; }
    }
  }
}
