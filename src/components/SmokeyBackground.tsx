/**
 * Smokey shader background — adapted from Origikit's SmokeyShader for this
 * app: fixed full-viewport, pointer interaction via window listeners so the
 * ripple follows the pointer even above the glass cards, and two battery
 * guards (renders stop for hidden tabs; `prefers-reduced-motion` gets a
 * static field).
 */
import { useEffect, useMemo, useRef } from 'react';

const VERTEX_SRC = `
attribute vec4 a_position;
void main() { gl_Position = a_position; }
`;

const FRAGMENT_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 iResolution;
uniform float iTime;
uniform vec2 iMouse;
uniform vec3 u_colors[8];
uniform int u_colorCount;
uniform float u_speed;
uniform float u_scale;
uniform float u_hover;
uniform float u_pointer;
uniform float u_reach;
uniform float u_glowEdge;

const int WARP_OCTAVES = 4;
const int DETAIL_OCTAVES = 8;
const float D_LO = 0.33;
const float D_HI = 0.77;

vec3 gradientColor(float t){
    if (u_colorCount <= 1) return u_colors[0];
    float segments = float(u_colorCount - 1);
    float scaled = clamp(t, 0.0, 1.0) * segments;
    float idx = floor(scaled);
    float f = fract(scaled);
    vec3 c0 = u_colors[0];
    vec3 c1 = u_colors[0];
    for (int i = 0; i < 8; i++) {
        if (float(i) == idx) c0 = u_colors[i];
        if (float(i) == idx + 1.0) c1 = u_colors[i];
    }
    return mix(c0, c1, f);
}

float hash(vec2 p){
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.45);
    return fract(p.x * p.y);
}

float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 OCTAVE_ROTATE = mat2(0.6603, -0.7509, 0.7509, 0.6603);

float fbm(vec2 p, int octaves){
    float sum = 0.0;
    float amp = 0.5;
    vec2 pp = p;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        sum += amp * noise(pp);
        pp = OCTAVE_ROTATE * pp * 2.0 + vec2(3.1, 1.7);
        amp *= 0.5;
    }
    return sum;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    float shortSide = min(iResolution.x, iResolution.y);
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / shortSide;
    vec2 mouseUV = (2.0 * iMouse - iResolution.xy) / shortSide;

    vec2 toMouse = uv - mouseUV;
    float mouseDist = length(toMouse);
    float reach = max(u_reach, 0.01);
    float falloff = 1.0 - smoothstep(0.0, reach, mouseDist);
    float core = smoothstep(0.0, 0.35 * reach, mouseDist);
    vec2 radial = toMouse / max(mouseDist, 0.0001);
    vec2 tangent = vec2(-radial.y, radial.x);
    vec2 swirl = mix(radial, tangent, 0.7);
    vec2 push = swirl * falloff * core * u_hover * u_pointer * 0.6;

    vec2 p = (uv + push) * u_scale;
    float time = iTime * u_speed;

    vec2 q = vec2(
        fbm(p + time * 0.15, WARP_OCTAVES),
        fbm(p + vec2(5.2, 1.3) - time * 0.1, WARP_OCTAVES)
    );
    vec2 r = vec2(
        fbm(p + 4.0 * q + vec2(1.7, 9.2) + time * 0.12, WARP_OCTAVES),
        fbm(p + 4.0 * q + vec2(8.3, 2.8) - time * 0.09, WARP_OCTAVES)
    );
    float density = fbm(p + 4.0 * r, DETAIL_OCTAVES);
    float normalized = clamp((density - D_LO) / (D_HI - D_LO), 0.0, 1.0);

    float glow = smoothstep(u_glowEdge, 1.0, normalized);
    fragColor = vec4(gradientColor(normalized) * glow, glow);
}
void main() { mainImage(gl_FragColor, gl_FragCoord.xy); }
`;

const MAX_COLORS = 8;
const MAX_DPR = 1.5; // fill-rate cap: past this the GPU, not the API, is the bottleneck
const POINTER_LAG_MS = 70;
const PRESENCE_LAG_MS = 180;
const MAX_FRAME_MS = 50;

function parseColor(input: string): [number, number, number] {
  const fallback: [number, number, number] = [1, 1, 1];
  if (!input) return fallback;
  const str = input.trim();
  if (str[0] === '#') {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r / 255, g / 255, b / 255];
    }
    return fallback;
  }
  const m = str.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])) / 255,
      Math.min(255, parseFloat(m[1])) / 255,
      Math.min(255, parseFloat(m[2])) / 255,
    ];
  }
  return fallback;
}

function parseColors(input: string[]): Float32Array {
  const out = new Float32Array(MAX_COLORS * 3);
  const count = Math.min(input.length, MAX_COLORS);
  for (let i = 0; i < MAX_COLORS; i++) {
    const src = i < count ? input[i] : input[count - 1];
    const [r, g, b] = parseColor(src);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('smoke bg: shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface Props {
  colors?: string[];
  background?: string;
  /** 0-100 motion speed; 0 freezes the field. */
  speed?: number;
  scale?: number;
  glow?: number;
  hover?: number;
  reach?: number;
}

export function SmokeyBackground({
  colors = ['#231b4d', '#38246e', '#6d28d9', '#8b5cf6', '#f472b6'],
  background = '#0b0d12',
  speed = 8,
  scale = 150,
  glow = 72,
  hover = 38,
  reach = 100,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const colorKey = colors.join('|');
  const parsedColors = useMemo(() => parseColors(colors), [colorKey]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) {
      console.error('smoke bg: WebGL context unavailable');
      return; // root background stays visible — plain colour fallback
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('smoke bg: program link failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'iResolution');
    const uTime = gl.getUniformLocation(program, 'iTime');
    const uMouse = gl.getUniformLocation(program, 'iMouse');
    const uColors = gl.getUniformLocation(program, 'u_colors[0]') ?? gl.getUniformLocation(program, 'u_colors');
    const uColorCount = gl.getUniformLocation(program, 'u_colorCount');
    const uSpeed = gl.getUniformLocation(program, 'u_speed');
    const uScale = gl.getUniformLocation(program, 'u_scale');
    const uHover = gl.getUniformLocation(program, 'u_hover');
    const uPointer = gl.getUniformLocation(program, 'u_pointer');
    const uReach = gl.getUniformLocation(program, 'u_reach');
    const uGlowEdge = gl.getUniformLocation(program, 'u_glowEdge');

    let cssWidth = root.offsetWidth || 1;
    let cssHeight = root.offsetHeight || 1;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      cssWidth = Math.max(1, box.width);
      cssHeight = Math.max(1, box.height);
    });
    ro.observe(root);

    const uniforms = {
      colors: parsedColors,
      colorCount: Math.min(colors.length, MAX_COLORS),
      speed: speed / 100,
      scale: scale / 100,
      hover: hover / 100,
      reach: reach / 100,
      // 72 keeps the shipped smoothstep(0.2, 0.9, density) proximity; the
      // range extends past it both ways for tuning room.
      glowEdge: 0.9 - (glow / 100) * 1.2,
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const pointer = { x: 0.5, y: 0.5, active: false, seeded: false };
    let rect: DOMRect | null = null;
    const readRect = () => {
      if (!rect) rect = root.getBoundingClientRect();
      return rect;
    };
    const invalidateRect = () => {
      rect = null;
    };

    let rafId = 0;
    let lastFrame = performance.now();
    let elapsed = 0;
    let smoothX = 0.5;
    let smoothY = 0.5;
    let presence = 0;

    const render = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const bw = Math.max(1, Math.round(cssWidth * dpr));
      const bh = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        gl.viewport(0, 0, bw, bh);
      }

      const dt = Math.min(now - lastFrame, MAX_FRAME_MS);
      lastFrame = now;
      elapsed += dt;

      if (pointer.seeded) {
        const posEase = 1 - Math.exp(-dt / POINTER_LAG_MS);
        smoothX += (pointer.x - smoothX) * posEase;
        smoothY += (pointer.y - smoothY) * posEase;
      } else {
        smoothX = pointer.x;
        smoothY = pointer.y;
      }
      const presenceEase = 1 - Math.exp(-dt / PRESENCE_LAG_MS);
      const target = pointer.active && uniforms.hover > 0 ? 1 : 0;
      presence += (target - presence) * presenceEase;

      gl.uniform2f(uResolution, bw, bh);
      gl.uniform1f(uTime, elapsed / 1000);
      gl.uniform1f(uSpeed, reduced ? 0 : uniforms.speed);
      gl.uniform1f(uScale, uniforms.scale);
      gl.uniform1f(uHover, reduced ? 0 : uniforms.hover);
      gl.uniform1f(uPointer, presence);
      gl.uniform1f(uReach, uniforms.reach);
      gl.uniform1f(uGlowEdge, uniforms.glowEdge);
      if (uColors) gl.uniform3fv(uColors, uniforms.colors);
      gl.uniform1i(uColorCount, uniforms.colorCount);
      gl.uniform2f(uMouse, smoothX * bw, (1 - smoothY) * bh);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = requestAnimationFrame(render);
    };

    const start = () => {
      cancelAnimationFrame(rafId);
      lastFrame = performance.now();
      rafId = requestAnimationFrame(render);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(rafId);
      else start();
    };

    // Pointer over the whole document (the background itself sits *under*
    // the cards and sees no direct events).
    const onMove = (e: PointerEvent) => {
      const r = readRect();
      if (!r.width || !r.height) return;
      pointer.x = (e.clientX - r.left) / r.width;
      pointer.y = (e.clientY - r.top) / r.height;
      pointer.active = true;
      pointer.seeded = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerout', onLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('scroll', invalidateRect, true);
    window.addEventListener('resize', invalidateRect, true);

    start();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerout', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', invalidateRect, true);
      window.removeEventListener('resize', invalidateRect, true);
    };
    // parsedColors is memoised on the joined colour key; props are static
    // per mount in this app, so an empty dep list is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      id="smoke-bg"
      style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', background, pointerEvents: 'none' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
