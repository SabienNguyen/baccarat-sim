// Just enough mat4 for one card: column-major Float32Array, the same
// layout WebGL's uniformMatrix4fv expects.

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Rodrigues rotation about a unit axis through a point. */
export function rotationAboutAxis(p: [number, number, number], axis: [number, number, number], rad: number): Mat4 {
  const [x, y, z] = axis;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  const r = identity();
  r[0] = t * x * x + c;
  r[4] = t * x * y - s * z;
  r[8] = t * x * z + s * y;
  r[1] = t * x * y + s * z;
  r[5] = t * y * y + c;
  r[9] = t * y * z - s * x;
  r[2] = t * x * z - s * y;
  r[6] = t * y * z + s * x;
  r[10] = t * z * z + c;
  return multiply(translation(p[0], p[1], p[2]), multiply(r, translation(-p[0], -p[1], -p[2])));
}

export function scaleAboutPoint(s: number, p: [number, number, number]): Mat4 {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return multiply(translation(p[0], p[1], p[2]), multiply(m, translation(-p[0], -p[1], -p[2])));
}

/** Apply m to a point, with the perspective divide. */
export function transformPoint(m: Mat4, v: [number, number, number]): [number, number, number] {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] || 1;
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w,
  ];
}
