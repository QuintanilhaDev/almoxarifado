'use client';
import { useEffect, useRef } from 'react';
import { frameTick, renderRatio } from '@/lib/gpuBudget';

/**
 * Corpo inteiro da Max em 3D (corpo, braços, mãos, pernas e pés), desenhado em WebGL
 * por "ray marching", com a mesma luz da esfera. Os membros saem de dentro da gelatina
 * e se fundem a ela nos ombros e quadris.
 *
 * O canvas tem o dobro do tamanho da esfera e fica centrado nela. As juntas chegam
 * em `rig` (coordenadas do mundo: raio do corpo = 0.6, y para cima, z para a câmera).
 */
export interface Rig {
  /** 12 juntas × xyz: ombroE, cotoveloE, mãoE, ombroD, cotoveloD, mãoD, quadrilE, joelhoE, péE, quadrilD, joelhoD, péD */
  j: Float32Array;
  /** quanto os membros já brotaram (0..1) */
  k: number;
  /** tamanho de cada mão (1 = normal) */
  fistL: number;
  fistR: number;
  /** para onde os pés apontam (-1 esquerda, 1 direita) */
  dir: number;
}

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_pulse;
uniform vec3 u_j[12];
uniform float u_k;
uniform vec2 u_fist;
uniform float u_dir;
uniform vec3 u_light;
uniform vec3 u_mid;
uniform vec3 u_deep;
/* esferas que envolvem cada membro (xyz centro, w raio) e o corpo inteiro: o que está longe nem é calculado */
uniform vec4 u_lb[4];
uniform vec4 u_all;

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float capsule(vec3 p, vec3 a, vec3 b, float ra, float rb){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float ellipsoid(vec3 p, vec3 r){
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

float body(vec3 p){
  float t = u_time;
  vec3 q = p;
  float br = 0.035 * sin(t * 2.3);
  q.x *= 1.0 + br; q.y *= 1.0 - br;
  q.y += 0.035 * smoothstep(-0.2, -0.6, q.y);
  float d = length(q) - (0.60 + 0.03 * u_pulse);
  d += 0.016 * sin(p.x * 5.2 + t * 2.1) * sin(p.y * 5.6 - t * 1.7) * sin(p.z * 4.6 + t * 2.6);
  return d;
}

/* membros: distância e se o ponto é mão/pé (para clarear a ponta) */
float chain(vec3 p, vec3 a, vec3 b, vec3 c, float r, float rTip, vec4 bound, out float tip){
  // longe do membro: a distância até a esfera que o envolve já basta (e é bem mais barata)
  float far = length(p - bound.xyz) - bound.w;
  if (far > 0.12) { tip = far; return far; }
  float d = smin(capsule(p, a, b, r * 1.1, r), capsule(p, b, c, r, r * rTip), 0.07);
  tip = 0.0;
  return d;
}

/* membros: distância e se o ponto é mão/pé */
vec2 limbs(vec3 p){
  float k = clamp(u_k * 1.4, 0.0, 1.0);
  float ra = 0.135 * k, rl = 0.152 * k;
  float tA, tB, tC, tD;
  float aL = chain(p, u_j[0], u_j[1], u_j[2], ra, 0.92, u_lb[0], tA);
  float aR = chain(p, u_j[3], u_j[4], u_j[5], ra, 0.92, u_lb[1], tB);
  float lL = chain(p, u_j[6], u_j[7], u_j[8], rl, 0.95, u_lb[2], tC);
  float lR = chain(p, u_j[9], u_j[10], u_j[11], rl, 0.95, u_lb[3], tD);
  float d = min(min(aL, aR), min(lL, lR));
  // mãos e pés só perto de onde estão
  float tips = 9.0;
  if (tA < 0.12) tips = min(tips, length(p - u_j[2]) - 0.17 * k * u_fist.x);
  if (tB < 0.12) tips = min(tips, length(p - u_j[5]) - 0.17 * k * u_fist.y);
  vec3 fo = vec3(0.06 * u_dir, -0.05, 0.03) * k;
  vec3 fr = vec3(0.19, 0.11, 0.15) * max(k, 0.001);
  if (tC < 0.12) tips = min(tips, ellipsoid(p - u_j[8] - fo, fr));
  if (tD < 0.12) tips = min(tips, ellipsoid(p - u_j[11] - fo, fr));
  d = smin(d, tips, 0.07);
  return vec2(d, 0.0);
}

vec2 scene(vec3 p){
  float b = body(p);
  if (u_k < 0.01) return vec2(b, 0.0);
  vec2 l = limbs(p);
  // y: quanto o ponto pertence aos membros (0 = corpo, 1 = membro)
  return vec2(smin(b, l.x, 0.09), smoothstep(0.0, 0.1, b - l.x));
}
float map(vec3 p){ return scene(p).x; }

vec3 normalAt(vec3 p){
  vec2 e = vec2(0.0022, -0.0022);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main(){
  // o canvas tem o dobro do tamanho da esfera: mesma escala da esfera, com espaço para os membros
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y) * 2.0;
  vec3 ro = vec3(0.0, 0.0, 3.1);
  vec3 rd = normalize(vec3(uv, -2.45));
  // o raio nem passa perto dela: pixel vazio, sem cálculo nenhum
  vec3 oc = ro - u_all.xyz;
  float bb = dot(oc, rd);
  float hh = bb * bb - (dot(oc, oc) - u_all.w * u_all.w);
  if (hh < 0.0) { gl_FragColor = vec4(0.0); return; }
  hh = sqrt(hh);
  float t = max(0.0, -bb - hh);
  float tEnd = -bb + hh;
  float minD = 10.0;
  bool hit = false;
  for (int i = 0; i < 64; i++) {
    float d = map(ro + rd * t);
    minD = min(minD, d);
    if (d < 0.0015) { hit = true; break; }
    t += d * 0.9;
    if (t > tEnd) break;
  }
  float px = 5.2 / min(u_res.x, u_res.y);
  vec3 col;
  float alpha;
  if (hit) {
    vec3 p = ro + rd * t;
    vec2 sc = scene(p);
    vec3 n = normalAt(p);
    vec3 v = -rd;
    vec3 key = normalize(vec3(-0.55, 0.8, 0.7));
    vec3 rim = normalize(vec3(0.75, 0.2, -0.6));
    float ndl = dot(n, key);
    float wrap = clamp(0.5 + 0.5 * ndl, 0.0, 1.0);
    float diff = max(ndl, 0.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 h = normalize(key + v);
    float spec = pow(max(dot(n, h), 0.0), 90.0);
    float sheen = pow(max(dot(n, h), 0.0), 12.0);
    float sss = pow(clamp(dot(v, -rim + n * 0.55), 0.0, 1.0), 2.4);
    // espessura aproximada pela borda (sem mais uma consulta à cena)
    float thick = clamp(dot(n, v) * 1.2, 0.0, 1.0);
    float ao = clamp(0.3 + 0.7 * map(p + n * 0.1) / 0.1, 0.0, 1.0);
    // sombra de contato: o corpo escurece o que está logo atrás/abaixo dele
    vec3 r = reflect(-v, n);
    vec3 env = mix(u_deep * 0.35, u_light, smoothstep(-0.15, 0.85, r.y));
    // membros com a mesma cor do corpo: menos luz atravessando e menos brilho de borda
    float limb = sc.y;
    col = mix(u_deep * 0.7, u_mid, wrap * wrap);
    col = mix(col, u_light, diff * diff * mix(0.42, 0.3, limb));
    col *= mix(0.6, 1.0, ao);
    col += u_light * sss * (1.0 - thick) * 0.42 * (1.0 - 0.85 * limb);
    col += env * fres * mix(0.5, 0.28, limb);
    col += u_mid * pow(max(dot(n, rim), 0.0), 2.0) * 0.28;
    col += vec3(1.0) * spec * 0.9 + u_light * sheen * 0.1;
    col = pow(col, vec3(0.94));
    alpha = 1.0;
  } else {
    alpha = 1.0 - smoothstep(0.0, px * 1.6, minD);
    col = mix(u_mid, u_light, 0.5);
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`;

const hex = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as const;
const LIGHT = hex('#f6efff');
const MID = hex('#cdb3ff');
const DEEP = hex('#7f58e2');

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[max] shader', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * `active` falso: o desenho fica pronto (o "shader" já compilado, o que leva um instante),
 * mas parado, sem gastar nada. Assim, quando ela sai correndo, não há engasgo.
 */
export function MaxBody3D({ size, rig, onFail, active = true }: { size: number; rig: React.MutableRefObject<Rig>; onFail?: () => void; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const kick = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (active) kick.current();
  }, [active]);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false }) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    const fail = () => failRef.current?.();
    if (!gl) return fail();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return fail();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fail();
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    const U = (n: string) => gl!.getUniformLocation(prog, n);
    const u = { res: U('u_res'), time: U('u_time'), pulse: U('u_pulse'), j: U('u_j[0]') ?? U('u_j'), k: U('u_k'), fist: U('u_fist'), dir: U('u_dir'), lb: U('u_lb[0]') ?? U('u_lb'), all: U('u_all'), light: U('u_light'), mid: U('u_mid'), deep: U('u_deep') };
    gl.uniform3f(u.light, ...LIGHT);
    gl.uniform3f(u.mid, ...MID);
    gl.uniform3f(u.deep, ...DEEP);

    let raf = 0;
    let dead = false;
    const bounds = new Float32Array(16);
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (dead || !gl) return;
      if (!activeRef.current) return;
      frameTick(now);
      const dpr = renderRatio();
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const R = rig.current;
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.time, (now - t0) / 1000);
      gl.uniform1f(u.pulse, 0.5 + 0.5 * Math.sin(now / 95) * Math.sin(now / 173 + 1.3));
      gl.uniform3fv(u.j, R.j);
      // esferas que envolvem cada membro e o corpo inteiro
      const k = Math.min(1, R.k * 1.4);
      let ar = 0.72; // o corpo (com a ondulação) cabe numa esfera de 0,72 no centro
      for (let m = 0; m < 4; m++) {
        let x0 = 9, y0 = 9, z0 = 9, x1 = -9, y1 = -9, z1 = -9;
        for (let q = 0; q < 3; q++) {
          const o = (m * 3 + q) * 3;
          x0 = Math.min(x0, R.j[o]); x1 = Math.max(x1, R.j[o]);
          y0 = Math.min(y0, R.j[o + 1]); y1 = Math.max(y1, R.j[o + 1]);
          z0 = Math.min(z0, R.j[o + 2]); z1 = Math.max(z1, R.j[o + 2]);
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
        const r = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.26 * k * Math.max(1, m < 2 ? (m === 0 ? R.fistL : R.fistR) : 1) + 0.02;
        bounds[m * 4] = cx; bounds[m * 4 + 1] = cy; bounds[m * 4 + 2] = cz; bounds[m * 4 + 3] = r;
        ar = Math.max(ar, Math.hypot(cx, cy, cz) + r);
      }
      gl.uniform4fv(u.lb, bounds);
      gl.uniform4f(u.all, 0, 0, 0, ar + 0.06);
      gl.uniform1f(u.k, R.k);
      gl.uniform2f(u.fist, R.fistL, R.fistR);
      gl.uniform1f(u.dir, R.dir);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    };
    kick.current = () => {
      if (!raf && !dead) raf = requestAnimationFrame(frame);
    };
    // um quadro de verdade, minúsculo e invisível, força o navegador a terminar de preparar
    // o desenho agora (com a página parada), e não no primeiro passo da corrida
    if (!activeRef.current) {
      canvas.width = 24;
      canvas.height = 24;
      gl.viewport(0, 0, 24, 24);
      gl.uniform2f(u.res, 24, 24);
      gl.uniform1f(u.k, 1);
      gl.uniform2f(u.fist, 1, 1);
      const warmJ = new Float32Array(36);
      for (let q = 0; q < 12; q++) warmJ.set([q % 6 < 3 ? -0.5 : 0.5, q < 6 ? -0.1 - (q % 3) * 0.3 : -0.5 - (q % 3) * 0.3, 0.1], q * 3);
      gl.uniform3fv(u.j, warmJ);
      gl.uniform4fv(u.lb, new Float32Array([-0.5, -0.4, 0.1, 0.6, 0.5, -0.4, 0.1, 0.6, -0.5, -0.8, 0.1, 0.6, 0.5, -0.8, 0.1, 0.6]));
      gl.uniform4f(u.all, 0, 0, 0, 1.6);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(4);
      gl.readPixels(12, 12, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // espera o desenho terminar
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (activeRef.current) kick.current();
    const onLost = (e: Event) => {
      e.preventDefault();
      dead = true;
      fail();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      try {
        gl?.deleteProgram(prog);
        gl?.deleteShader(vs);
        gl?.deleteShader(fs);
        gl?.deleteBuffer(buf);
      } catch {
        /* já descartado */
      }
    };
  }, [rig]);

  return <canvas ref={ref} className="mr-3d" style={{ width: size * 2, height: size * 2, left: -size / 2, top: -size / 2 }} />;
}
