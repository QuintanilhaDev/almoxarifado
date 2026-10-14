'use client';
import { useEffect, useRef, useState } from 'react';
import { MaxFace } from './MaxFace';
import { MaxCap } from './MaxCap';
import { frameTick, orbHidden, renderRatio } from '@/lib/gpuBudget';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * A esfera da Max: uma massa 3D viva (a versão em três dimensões do círculo gelatinoso
 * da entrada), desenhada em WebGL por "ray marching". Muda de cor conforme o estado:
 * lilás em repouso, verde ouvindo, clara pensando, pulsando ao falar.
 * Sem WebGL, cai para a versão em SVG.
 */
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_pulse;
uniform vec3 u_light;
uniform vec3 u_mid;
uniform vec3 u_deep;

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float map(vec3 p){
  float t = u_time;
  float e = u_energy;
  // núcleo que respira e ondula (gelatina macia)
  vec3 q = p;
  float br = 0.04 * sin(t * 2.3);
  q.x *= 1.0 + br; q.y *= 1.0 - br;
  q.y += 0.035 * smoothstep(-0.2, -0.6, q.y); // base levemente achatada, apoiada
  float d = length(q) - (0.60 + 0.035 * u_pulse);
  d += (0.018 + 0.026 * e) * sin(p.x * 5.2 + t * 2.1) * sin(p.y * 5.6 - t * 1.7) * sin(p.z * 4.6 + t * 2.6);
  // gotas que se esticam e voltam, só dos lados e de baixo (o topo é do boné)
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float a = t * (0.85 + 0.21 * fi) * dir + fi * 1.7;
    float reach = mix(0.22, 0.66 + 0.14 * e, 0.5 + 0.5 * sin(t * (1.5 + 0.33 * fi) + fi * 2.1));
    vec3 c = vec3(cos(a), sin(a), 0.0) * reach;
    c.yz = rot(fi * 1.15 + 0.25 * t) * c.yz;
    c.xz = rot(fi * 0.7) * c.xz;
    c.y = min(c.y, 0.08);
    d = smin(d, length(p - c) - (0.195 - 0.02 * fi), 0.30);
  }
  return d;
}

vec3 normalAt(vec3 p){
  vec2 e = vec2(0.0022, -0.0022);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  vec3 ro = vec3(0.0, 0.0, 3.1);
  vec3 rd = normalize(vec3(uv, -2.45));
  // fora da esfera que envolve a gelatina (com as gotas): pixel vazio, sem cálculo
  float bb = dot(ro, rd);
  float hh = bb * bb - (dot(ro, ro) - 1.12 * 1.12);
  if (hh < 0.0) { gl_FragColor = vec4(0.0); return; }
  hh = sqrt(hh);
  float t = max(0.0, -bb - hh);
  float tEnd = -bb + hh;
  float minD = 10.0;
  bool hit = false;
  for (int i = 0; i < 56; i++) {
    float d = map(ro + rd * t);
    minD = min(minD, d);
    if (d < 0.0015) { hit = true; break; }
    t += d * 0.9;
    if (t > tEnd) break;
  }
  float px = 2.6 / min(u_res.x, u_res.y);
  vec3 col;
  float alpha;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 v = -rd;
    vec3 key = normalize(vec3(-0.55, 0.8, 0.7));
    vec3 rim = normalize(vec3(0.75, 0.2, -0.6));
    float ndl = dot(n, key);
    float wrap = clamp(0.5 + 0.5 * ndl, 0.0, 1.0);
    float diff = max(ndl, 0.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    // brilho principal nítido + brilho largo (aspecto de gelatina polida)
    vec3 h = normalize(key + v);
    float spec = pow(max(dot(n, h), 0.0), 90.0);
    float sheen = pow(max(dot(n, h), 0.0), 12.0);
    // luz atravessando a gelatina (translucidez)
    float sss = pow(clamp(dot(v, -rim + n * 0.55), 0.0, 1.0), 2.4);
    float thick = clamp(dot(n, v) * 1.2, 0.0, 1.0);
    // oclusão nas dobras onde as gotas encontram o corpo
    float ao = clamp(0.35 + 0.65 * map(p + n * 0.12) / 0.12, 0.0, 1.0);
    // reflexo de estúdio (céu claro em cima, chão escuro embaixo)
    vec3 r = reflect(-v, n);
    vec3 env = mix(u_deep * 0.35, u_light, smoothstep(-0.15, 0.85, r.y));
    col = mix(u_deep * 0.7, u_mid, wrap * wrap);
    col = mix(col, u_light, diff * diff * 0.42);
    col *= mix(0.72, 1.0, ao);
    col += u_light * sss * (1.0 - thick) * 0.42;
    col += env * fres * 0.5;
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

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

interface Look {
  light: RGB;
  mid: RGB;
  deep: RGB;
  energy: number;
  speed: number;
  pulse: number;
}
const LOOKS: Record<OrbState, Look> = {
  idle: { light: hex('#f1e9ff'), mid: hex('#c6a8ff'), deep: hex('#7a52dd'), energy: 0.25, speed: 0.75, pulse: 0 },
  listening: { light: hex('#e6fff2'), mid: hex('#57eba0'), deep: hex('#0f9a61'), energy: 0.9, speed: 1.35, pulse: 0.35 },
  thinking: { light: hex('#ffffff'), mid: hex('#dccdff'), deep: hex('#9173f0'), energy: 0.6, speed: 2.1, pulse: 0.15 },
  speaking: { light: hex('#f6efff'), mid: hex('#cdb3ff'), deep: hex('#7f58e2'), energy: 0.55, speed: 1.15, pulse: 1 },
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function MaxOrb({ size, state = 'idle', className }: { size: number; state?: OrbState; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      const opts = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' as const };
      gl = (canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) {
      setFallback(true);
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    const U = (n: string) => gl!.getUniformLocation(prog, n);
    const uRes = U('u_res');
    const uTime = U('u_time');
    const uEnergy = U('u_energy');
    const uPulse = U('u_pulse');
    const uLight = U('u_light');
    const uMid = U('u_mid');
    const uDeep = U('u_deep');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur: Look = { ...LOOKS[stateRef.current], light: [...LOOKS[stateRef.current].light], mid: [...LOOKS[stateRef.current].mid], deep: [...LOOKS[stateRef.current].deep] };
    let phase = Math.random() * 40;
    let last = performance.now();
    let raf = 0;
    let lost = false;

    let drawn = 0;
    let sleep: ReturnType<typeof setTimeout> | null = null;
    const fit = () => {
      const dpr = renderRatio();
      const px = Math.max(2, Math.round(canvas.clientWidth * dpr));
      const py = Math.max(2, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== px || canvas.height !== py) {
        canvas.width = px;
        canvas.height = py;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (lost || !gl) return;
      // escondida (a Max saiu correndo do canto): não desenha, só confere de vez em quando
      if (orbHidden(canvas)) {
        if (!sleep) sleep = setTimeout(() => ((sleep = null), (last = performance.now()), schedule()), 250);
        return;
      }
      frameTick(now);
      // parada, a gelatina se mexe devagar: 30 quadros por segundo bastam
      if (stateRef.current === 'idle' && now - drawn < 31) return schedule();
      drawn = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = LOOKS[stateRef.current];
      const k = 1 - Math.exp(-dt * 7);
      for (const key of ['light', 'mid', 'deep'] as const) for (let i = 0; i < 3; i++) cur[key][i] += (target[key][i] - cur[key][i]) * k;
      cur.energy += (target.energy - cur.energy) * k;
      cur.speed += (target.speed - cur.speed) * k;
      cur.pulse += (target.pulse - cur.pulse) * k;
      phase += dt * cur.speed * (reduce ? 0.3 : 1);
      fit();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, phase);
      gl.uniform1f(uEnergy, cur.energy);
      // ao falar, o pulso acompanha um ritmo de fala
      const talk = 0.5 + 0.5 * Math.sin(now / 95) * Math.sin(now / 173 + 1.3);
      gl.uniform1f(uPulse, cur.pulse * (stateRef.current === 'speaking' ? talk : 0.6 + 0.4 * Math.sin(now / 420)));
      gl.uniform3f(uLight, cur.light[0], cur.light[1], cur.light[2]);
      gl.uniform3f(uMid, cur.mid[0], cur.mid[1], cur.mid[2]);
      gl.uniform3f(uDeep, cur.deep[0], cur.deep[1], cur.deep[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      schedule();
    };
    const schedule = () => {
      if (!raf && !lost && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
    };
    const onVis = () => {
      last = performance.now();
      schedule();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      setFallback(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    document.addEventListener('visibilitychange', onVis);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      if (sleep) clearTimeout(sleep);
      raf = 0;
      lost = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', onVis);
      try {
        gl?.deleteProgram(prog);
        gl?.deleteShader(vs);
        gl?.deleteShader(fs);
        gl?.deleteBuffer(buf);
      } catch {
        /* contexto já descartado */
      }
    };
  }, []);

  return (
    <span className={`max-orb is-${state}${className ? ' ' + className : ''}`} style={{ width: size, height: size }} aria-hidden>
      {fallback ? <OrbFallback /> : <canvas ref={canvasRef} />}
      <MaxFace state={state} />
      <MaxCap />
    </span>
  );
}

/** Versão em SVG (sem WebGL): o mesmo círculo gelatinoso, com a cor do estado. */
function OrbFallback() {
  return (
    <svg className="slime max-orb-svg" viewBox="0 0 280 280">
      <defs>
        <filter id="max-goo" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
        </filter>
      </defs>
      <g filter="url(#max-goo)" fill="var(--orb-color, #c6a8ff)">
        <circle className="core" cx="140" cy="140" r="78" />
        <g className="orbit orbit-1">
          <circle className="blob blob-1" cx="140" cy="140" r="28" />
        </g>
        <g className="orbit orbit-2">
          <circle className="blob blob-2" cx="140" cy="140" r="24" />
        </g>
        <g className="orbit orbit-3">
          <circle className="blob blob-3" cx="140" cy="140" r="30" />
        </g>
        <g className="orbit orbit-4">
          <circle className="blob blob-4" cx="140" cy="140" r="20" />
        </g>
      </g>
    </svg>
  );
}
