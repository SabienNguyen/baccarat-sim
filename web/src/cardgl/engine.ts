// The card micro-engine: one subdivided quad, two canvas textures, two
// draw passes (projected shadow, then the lit curled card). Everything a
// squeeze needs and nothing else — no scene graph, no dependencies.
import { VERT, FRAG } from "./shaders";
import {
  identity,
  multiply,
  perspective,
  translation,
  rotationAboutAxis,
  scaleAboutPoint,
  type Mat4,
} from "./mat4";
import type { CurlParams, BodyPose } from "./curlMath";

const COLS = 48;
const ROWS = 64;
/** Camera focal length in px — matches the CSS perspective(640px). */
const FOCAL = 640;

const UNIFORMS = [
  "uCard",
  "uGrab",
  "uDir",
  "uPerp",
  "uApex",
  "uRadius",
  "uTheta",
  "uModel",
  "uPV",
  "uShadowPass",
  "uTop",
  "uBot",
  "uLight",
] as const;
type UniformName = (typeof UNIFORMS)[number];

export class CardGLEngine {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private indexCount: number;
  private uni = {} as Record<UniformName, WebGLUniformLocation | null>;
  private texTop: WebGLTexture;
  private texBot: WebGLTexture;
  private cardW: number;
  private cardH: number;
  private canvas: HTMLCanvasElement;
  private lostHandler: (e: Event) => void;
  onContextLost?: () => void;

  static isSupported(): boolean {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, cardW: number, cardH: number, pad: number, dpr: number) {
    this.cardW = cardW;
    this.cardH = cardH;
    const w = cardW + 2 * pad;
    const h = cardH + 2 * pad;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.canvas = canvas;
    this.lostHandler = (e: Event) => {
      e.preventDefault();
      this.onContextLost?.();
    };
    canvas.addEventListener("webglcontextlost", this.lostHandler);

    this.program = this.link(VERT, FRAG);
    gl.useProgram(this.program);
    for (const name of UNIFORMS) {
      this.uni[name] = gl.getUniformLocation(this.program, name);
    }

    // grid mesh over the card rectangle, positions in card-local px
    const verts = new Float32Array((COLS + 1) * (ROWS + 1) * 2);
    let vi = 0;
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        verts[vi++] = (c / COLS) * cardW;
        verts[vi++] = (r / ROWS) * cardH;
      }
    }
    const idx = new Uint16Array(COLS * ROWS * 6);
    let ii = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + 1;
        const d = a + (COLS + 1);
        const e = d + 1;
        idx[ii++] = a;
        idx[ii++] = b;
        idx[ii++] = d;
        idx[ii++] = b;
        idx[ii++] = e;
        idx[ii++] = d;
      }
    }
    this.indexCount = idx.length;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.texTop = this.makeTexture();
    this.texBot = this.makeTexture();

    // Camera over the card center at the CSS focal length, world in
    // card-local px with y down. The fov spans the padded canvas, so the
    // pad needs no translation of its own. Flipping y into NDC mirrors
    // handedness — the index winding above accounts for it.
    const fovY = 2 * Math.atan(h / 2 / FOCAL);
    const proj = perspective(fovY, w / h, 100, 2000);
    const flipY = identity();
    flipY[5] = -1;
    const view = translation(-cardW / 2, -cardH / 2, -FOCAL);
    const pv = multiply(proj, multiply(flipY, view));

    // y-down world through a y-flipping projection: what's CCW on the
    // card reads as CW in NDC — declare CW the front so the flat card's
    // up-side is gl_FrontFacing (verified against the glprobe page)
    gl.frontFace(gl.CW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const L: [number, number, number] = [-0.35, -0.5, 0.79];
    const ll = Math.hypot(...L);
    gl.uniform3f(this.uni.uLight, L[0] / ll, L[1] / ll, L[2] / ll);
    gl.uniform2f(this.uni.uCard, cardW, cardH);
    gl.uniform1i(this.uni.uTop, 0);
    gl.uniform1i(this.uni.uBot, 1);
    gl.uniformMatrix4fv(this.uni.uPV, false, pv);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
    }
    return p;
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private upload(tex: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  setTopTexture(src: TexImageSource) {
    this.upload(this.texTop, src);
  }

  setBotTexture(src: TexImageSource) {
    this.upload(this.texBot, src);
  }

  private modelMatrix(pose: BodyPose): Mat4 {
    const cx = this.cardW / 2;
    const cy = this.cardH / 2;
    let m = scaleAboutPoint(pose.scale, [cx, cy, 0]);
    if (pose.tipRad !== 0) {
      m = multiply(
        m,
        rotationAboutAxis([pose.tipPivot[0], pose.tipPivot[1], 0], [pose.tipAxis[0], pose.tipAxis[1], 0], pose.tipRad),
      );
    }
    if (pose.slide[0] !== 0 || pose.slide[1] !== 0) {
      m = multiply(translation(pose.slide[0], pose.slide[1], 0), m);
    }
    return m;
  }

  render(curl: CurlParams, pose: BodyPose) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texTop);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texBot);

    gl.uniform2f(this.uni.uGrab, curl.gx, curl.gy);
    gl.uniform2f(this.uni.uDir, curl.nx, curl.ny);
    gl.uniform2f(this.uni.uPerp, curl.ux, curl.uy);
    gl.uniform1f(this.uni.uApex, curl.apex);
    gl.uniform1f(this.uni.uRadius, curl.radius);
    gl.uniform1f(this.uni.uTheta, curl.theta);
    gl.uniformMatrix4fv(this.uni.uModel, false, this.modelMatrix(pose));

    // pass 1: the shadow flattened onto the felt — no depth write
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(this.uni.uShadowPass, 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    // pass 2: the card itself
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(this.uni.uShadowPass, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    // Detach the listener FIRST: loseContext() fires webglcontextlost
    // asynchronously, after a disposing owner has already moved on —
    // a stale event must never reach onContextLost (StrictMode mounts
    // the owner twice and the ghost event would kill the live engine).
    this.canvas.removeEventListener("webglcontextlost", this.lostHandler);
    this.onContextLost = undefined;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
