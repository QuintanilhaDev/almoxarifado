'use client';
import { useEffect, useRef } from 'react';

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
vec2 limbs(vec3 p){
  float k = clamp(u_k * 1.4, 0.0, 1.0);
  float ra = 0.135 * k, rl = 0.152 * k;
  // braços: ombro grosso afinando até o punho, cotovelo arredondado
  float aL = smin(capsule(p, u_j[0], u_j[1], ra * 1.1, ra), capsule(p, u_j[1], u_j[2], ra, ra * 0.92), 0.07);
  float aR = smin(capsule(p, u_j[3], u_j[4], ra * 1.1, ra), capsule(p, u_j[4], u_j[5], ra, ra * 0.92), 0.07);
  // mãos: bolinhas fofas
  float hL = length(p - u_j[2]) - 0.17 * k * u_fist.x;
  float hR = length(p - u_j[5]) - 0.17 * k * u_fist.y;
  // pernas
  float lL = smin(capsule(p, u_j[6], u_j[7], rl * 1.1, rl), capsule(p, u_j[7], u_j[8], rl, rl * 0.95), 0.07);
  float lR = smin(capsule(p, u_j[9], u_j[10], rl * 1.1, rl), capsule(p, u_j[10], u_j[11], rl, rl * 0.95), 0.07);
  // pés: gotinhas achatadas apontando para onde ela vai (sem sapato)
  vec3 fo = vec3(0.06 * u_dir, -0.05, 0.03) * k;
  vec3 fr = vec3(0.19, 0.11, 0.15) * max(k, 0.001);
  float fL = ellipsoid(p - u_j[8] - fo, fr);
  float fR = ellipsoid(p - u_j[11] - fo, fr);
  float tips = min(min(hL, hR), min(fL, fR));
  float d = min(min(aL, aR), min(lL, lR));
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
  float t = 1.5;
  float minD = 10.0;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float d = map(ro + rd * t);
    minD = min(minD, d);
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.85;
    if (t > 4.9) break;
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
    float thick = clamp(map(p - n * 0.16) / -0.16, 0.0, 1.0);
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

export function MaxBody3D({ size, rig, onFail }: { size: number; rig: React.MutableRefObject<Rig>; onFail?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    const u = { res: U('u_res'), time: U('u_time'), pulse: U('u_pulse'), j: U('u_j[0]') ?? U('u_j'), k: U('u_k'), fist: U('u_fist'), dir: U('u_dir'), light: U('u_light'), mid: U('u_mid'), deep: U('u_deep') };
    gl.uniform3f(u.light, ...LIGHT);
    gl.uniform3f(u.mid, ...MID);
    gl.uniform3f(u.deep, ...DEEP);

    let raf = 0;
    let dead = false;
    const t0 = performance.now();
    const frame = (now: number) => {
      if (dead || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      gl.uniform1f(u.k, R.k);
      gl.uniform2f(u.fist, R.fistL, R.fistR);
      gl.uniform1f(u.dir, R.dir);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
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
