import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

// Concept 01 vortex path, traced in the reference comp's pixel space (1672x941).
// Third value = how tightly the point is pinned to the prism (1) vs the viewport
// (0): the far ends follow the screen edges, the middle is locked to the prism
// so the vapor emerges exactly from its bottom-right corner at any prism size.
const PATH = [
  [402, -160, 0],
  [414, 20, 0],
  [432, 140, 0],
  [474, 228, 0.1],
  [545, 305, 0.3],
  [635, 375, 0.6],
  [722, 445, 0.9],
  [800, 548, 1],
  [885, 640, 1],
  [1005, 686, 1],
  [1150, 706, 0.8],
  [1320, 746, 0.5],
  [1450, 795, 0.2],
  [1540, 855, 0],
  [1620, 950, 0],
]
const COMP_H = 941
const COMP_CENTER = [836, 470.5]
// Prism in the comp (px) vs the Prism mesh in world units at prismSize 1.
const COMP_PRISM = { cx: 821.5, base: 690, w: 437, h: 403 }
const WORLD_PRISM = { w: 3.752, h: 3.271, base: -1.457 }
const SEGMENTS = 48

// Signed ribbon width (comp px) along the swirl, from the hand-drawn twist
// sketch. The vapor is a flat ribbon turning in depth: its on-screen width is
// envelope * cos(twist), so it narrows to a line where it goes edge-on and
// re-opens on the OTHER side once it has flipped. Top arc: a wide fan at the
// screen edge twists down to a line on the way in, flips into a small bulge
// just before the prism, and pinches onto the glass. Lower arc: leaves the
// prism corner as a line and slowly fans back out toward the screen corner.
const { lerp, smoothstep } = THREE.MathUtils
function ribbonWidth(t, g) {
  if (t < g) {
    const u = t / g
    const env = lerp(105, 30, smoothstep(u, 0, 0.75)) * (1 - smoothstep(u, 0.88, 1))
    return env * Math.cos(((Math.PI / 2) * u) / 0.6)
  }
  return 85 * smoothstep((t - g) / (1 - g), 0.08, 0.9)
}

function buildPath(vw, vh, prismSize) {
  const s = vh / COMP_H
  const kx = WORLD_PRISM.w / COMP_PRISM.w
  const ky = WORLD_PRISM.h / COMP_PRISM.h
  const pts = PATH.map(([px, py, w]) => {
    const vx = px - COMP_CENTER[0]
    const vy = -(py - COMP_CENTER[1])
    const ax = ((px - COMP_PRISM.cx) * kx * prismSize) / s
    const ay = ((WORLD_PRISM.base - (py - COMP_PRISM.base) * ky) * prismSize) / s
    return new THREE.Vector2(THREE.MathUtils.lerp(vx, ax, w), THREE.MathUtils.lerp(vy, ay, w))
  })
  const curve = new THREE.SplineCurve(pts)
  const points = curve.getSpacedPoints(SEGMENTS - 1)

  const prismCenter = new THREE.Vector2(0, (0.18 * prismSize) / s)
  const behind = points.reduce((best, p, i) => (p.distanceTo(prismCenter) < points[best].distanceTo(prismCenter) ? i : best), 0)

  const gapT = behind / (SEGMENTS - 1)
  // Edge B: edge A (the traced path) pushed out along its haze-side normal by
  // the twist width, as its own polyline so it renders as smooth as edge A.
  const pointsB = points.map((p, i) => {
    const d = points[Math.min(i + 1, SEGMENTS - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize()
    return new THREE.Vector2(d.y, -d.x).multiplyScalar(ribbonWidth(i / (SEGMENTS - 1), gapT)).add(p)
  })

  return {
    points,
    pointsB,
    half: new THREE.Vector2(vw / 2 / s, vh / 2 / s),
    length: curve.getLength(),
    gapT,
    scale: s,
  }
}

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
`

// Everything below runs in comp-pixel space (q), so widths/frequencies read as px.
// o is the signed distance to a path: > 0 left of travel, < 0 right (the haze side).
const vortexFragment = /* glsl */ `
  #define N ${SEGMENTS}
  uniform vec2 uPts[N];
  uniform vec2 uPtsB[N];
  uniform vec2 uHalf;
  uniform float uLen;
  uniform float uGapT;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uDispersion;
  varying vec2 vNdc;
  ${NOISE}

  // Nearest point on edge A (t along it, signed distance o) and signed
  // distance oB to edge B, in one pass.
  void nearestEdges(vec2 q, out float t, out float o, out float oB) {
    float best = 1e12, bestB = 1e12;
    for (int i = 0; i < N - 1; i++) {
      vec2 a = uPts[i], ab = uPts[i + 1] - a;
      float h = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
      vec2 e = q - (a + ab * h);
      float dd = dot(e, e);
      if (dd < best) { best = dd; t = (float(i) + h) / float(N - 1); o = sign(dot(e, vec2(-ab.y, ab.x))) * sqrt(dd); }
      a = uPtsB[i]; ab = uPtsB[i + 1] - a;
      if (dot(ab, ab) < 1e-4) ab = uPts[i + 1] - uPts[i];
      h = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
      e = q - (a + ab * h);
      dd = dot(e, e);
      if (dd < bestB) { bestB = dd; oB = sign(dot(e, vec2(-ab.y, ab.x))) * sqrt(dd); }
    }
  }

  void main() {
    vec2 q = vNdc * uHalf;

    // Very slow, small drift: the edges stay crisp arcs like the concept,
    // only breathing slightly instead of tearing into ragged vapor.
    vec2 w = vec2(noise(q * 0.002 + vec2(uTime * 0.03, 0.0)), noise(q * 0.002 + vec2(5.2, 1.3 - uTime * 0.025))) - 0.5;
    q += w * 8.0;

    float t, o, oB;
    nearestEdges(q, t, o, oB);
    float along = t * uLen;

    // One rim line (edge A) with light dispersing off ONE side of it. Edge B
    // is never drawn: it only says which side the dispersion falls on and how
    // far it reaches. Through the twist B crosses A, so the spray narrows onto
    // the line and re-emerges on the other side, like the concept.
    float dA = abs(o), dB = abs(oB);
    // On B's side of A: between A and B (opposite signs) or beyond B. Blended
    // with a few px of softness (not a hard step) so the ribbon's twist,
    // where this classification flips, reads as a smooth fold instead of a
    // sharp cut seam.
    float bSide = max(smoothstep(-3.0, 3.0, -o * oB), smoothstep(-3.0, 3.0, dA - dB));
    // Local spray reach: A-to-B distance, measured either between or beyond B.
    // Scaled by uDispersion so the spray can be pulled tight to the rim or
    // fanned out wider without retracing edge B.
    float reach = (o * oB < 0.0 ? dA + dB : max(dA - dB, 0.0)) * uDispersion;
    // Varies only along the path (not across it, i.e. no dA term) so the
    // falloff away from the rim stays one smooth gradient instead of reading
    // as concentric bands of different opacity.
    float strands = mix(0.6, 1.0, fbm(vec2(along * 0.006 - uTime * 0.15, along * 0.0015)));
    // Soft falloff from the line, no second edge; a short spray where the
    // ribbon is edge-on (reach ~0), a long wispy one where it faces us.
    float disperse = bSide * exp(-dA / (reach * 0.32 + 2.0)) * strands * smoothstep(0.0, 25.0, reach + 5.0);
    // No haze on the inactive side: the rim line (edges, below) isn't gated by
    // bSide so the thread stays continuous through the twist on its own —
    // the dispersion itself should commit fully to one side at a time, flipping
    // cleanly across the crossing instead of glowing faintly on both.
    float fill = disperse;

    float rimA = exp(-o * o);
    float glow = exp(-pow(o / 4.0, 2.0));

    // Light catching the edges: a slowly shifting sheen plus a few specular
    // glints at the spots where the concept's arc flares (top edge, where it
    // meets the white beam, and along the lower arc right of the prism).
    float sheen = 0.25 + 0.75 * smoothstep(0.3, 0.75, fbm(vec2(along * 0.003 - uTime * 0.05, 3.0)));
    float glint = 0.0;
    const vec4 C = vec4(0.10, 0.35, 0.69, 0.83);
    const vec4 A = vec4(0.8, 1.0, 1.0, 0.5);
    for (int k = 0; k < 4; k++) {
      float c = C[k] + 0.008 * sin(uTime * 0.23 + float(k) * 1.7);
      glint += A[k] * exp(-pow((t - c) / 0.03, 2.0)) * (0.75 + 0.25 * sin(uTime * 0.6 + float(k) * 2.3));
    }

    float gap = 1.0 - 0.95 * exp(-pow((t - uGapT) / 0.08, 2.0));
    float alpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.9, 1.0, t)) * gap;
    float edges = rimA * (0.24 + 1.8 * glint) + glow * (0.05 + 0.22 * glint);
    float lum = (fill * 0.045 + edges * sheen) * alpha;

    gl_FragColor = vec4(vec3(0.90, 0.88, 0.86) * lum * uIntensity, 1.0);
  }
`

// Particles, three kinds interleaved by seed, 1 : 9 : 14 per 24 (so the screen-size draw range
// thins them all evenly), after Atom-RND's OpticalVeil:
//   kind 0 — soft out-of-focus bokeh discs scattered around the swirl
//   kind 1 — fine dust shed off the line, mostly into its dispersing side
//   kind 2 — a stream of specks flowing along the line, thinning out into the
//            side the light disperses on (so they follow the twist), faintly
//            tinted teal / warm like OpticalVeil's.
const bokehVertex = /* glsl */ `
  #define N ${SEGMENTS}
  attribute float aSeed;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uParticleIntensity;
  uniform float uDispersion;
  uniform float uDpr;
  uniform vec2 uPts[N];
  uniform vec2 uPtsB[N];
  uniform float uScale;
  uniform float uGapT;
  uniform float uOffsetX;
  varying float vA;
  varying float vDust;
  varying vec3 vCol;
  float h1(float n) { return fract(sin(n) * 43758.5453); }

  // Point on edge A at t, its haze-side normal, and the matching point on edge B.
  vec2 pathAt(float t, out vec2 side, out vec2 pb) {
    float seg = clamp(t, 0.0, 0.999) * float(N - 1);
    int i = int(seg);
    vec2 a = uPts[i], b = uPts[i + 1];
    vec2 dir = normalize(b - a);
    side = vec2(dir.y, -dir.x);
    pb = mix(uPtsB[i], uPtsB[i + 1], fract(seg));
    return mix(a, b, fract(seg));
  }

  void main() {
    float k = mod(aSeed, 24.0);
    float kind = k < 0.5 ? 0.0 : (k < 9.5 ? 1.0 : 2.0);
    vDust = step(0.5, kind);
    float size = h1(aSeed * 5.3);
    float twinkle = 0.6 + 0.4 * sin(uTime * mix(1.0, 2.5, h1(aSeed * 7.7)) + aSeed);
    vec2 side, pb;
    vec2 q;

    if (kind < 1.5) {
      // Bokeh + shed dust: each lives one cycle, fading in and out, then
      // respawns somewhere new along the swirl.
      float period = mix(7.0, 15.0, h1(aSeed * 1.7)) * mix(1.0, 1.6, kind);
      float life = uTime / period + h1(aSeed * 3.1);
      float cycle = floor(life);
      float f = fract(life);
      vec2 r = vec2(h1(aSeed * 12.9 + cycle * 78.2), h1(aSeed * 39.3 + cycle * 11.7));
      float t = mix(0.04, 0.96, r.x);
      q = pathAt(t, side, pb);
      float S = dot(pb - q, side);
      if (kind < 0.5) {
        q += side * mix(-160.0, 240.0, r.y);
        q += vec2(30.0, 14.0) * (f - 0.5);
      } else {
        // Shed off the line into its dispersing side ONLY (reaching as far as
        // the spray does there), drifting as it fades. Never the other way:
        // the haze is strictly one-sided, so stray counter-side specks read as
        // the twist leaking onto the wrong side.
        float dirOut = S < 0.0 ? -1.0 : 1.0;
        float d = fract(r.y * 5.0);
        q += side * dirOut * (3.0 + d * d * (abs(S) * 0.45 + 10.0) * uDispersion * (0.4 + f));
        q += vec2(18.0, 8.0) * (f - 0.5);
      }
      vA = pow(sin(3.14159 * f), 2.0) * mix(0.35, 1.0, h1(aSeed * 9.1)) *
        (kind < 0.5 ? mix(1.0, 0.45, size) : 0.5 * twinkle);
      vCol = vec3(0.90, 0.88, 0.86);
      gl_PointSize = (kind < 0.5 ? mix(14.0, 56.0, size * size) : mix(1.5, 3.5, size)) * uDpr;
    } else {
      // Stream: flows slowly along the swirl, wrapping at the ends.
      float t = fract(h1(aSeed * 2.3) + uTime * 0.006 * mix(0.8, 1.2, h1(aSeed * 4.1)));
      q = pathAt(t, side, pb);
      // Most ride the line, the rest thin out into the dispersing side. The
      // scatter is one-sided (toward edge B) rather than straddling the line,
      // so no specks sit on the side the haze has left.
      float onEdge = step(0.45, h1(aSeed * 8.3));
      float v = pow(h1(aSeed * 6.7), 2.0) * 0.8 * (1.0 - onEdge);
      float sSign = dot(pb - q, side) < 0.0 ? -1.0 : 1.0;
      q = mix(q, pb, v) + side * sSign * h1(aSeed * 3.7) * 4.0 * uDispersion;
      q += vec2(sin(aSeed * 1.27 + uTime * 0.3), cos(aSeed * 0.91 + uTime * 0.27)) * 3.0;
      float salt = h1(aSeed * 8.9);
      vec3 tint = salt > 0.78 ? vec3(0.95, 0.62, 0.42) : vec3(0.42, 0.72, 0.88);
      vCol = mix(vec3(0.90, 0.88, 0.86), tint, 0.55);
      float gap = 1.0 - exp(-pow((t - uGapT) / 0.05, 2.0));
      vA = smoothstep(0.02, 0.08, t) * (1.0 - smoothstep(0.9, 0.98, t)) * gap *
        twinkle * mix(0.9, 1.8, onEdge) * mix(0.5, 1.0, h1(aSeed * 9.1));
      gl_PointSize = mix(1.5, 3.2, size * size) * uDpr;
    }

    vA *= kind < 0.5 ? uIntensity : uParticleIntensity;
    if (kind < 0.5) q.x += uOffsetX;
    gl_Position = projectionMatrix * viewMatrix * vec4(q * uScale, -2.0, 1.0);
  }
`

const bokehFragment = /* glsl */ `
  varying float vA;
  varying float vDust;
  varying vec3 vCol;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    // Bokeh: flat-ish soft disc with a faint lens-rim, like out-of-focus dust.
    float disc = smoothstep(1.0, 0.7, d) * (0.75 + 0.25 * smoothstep(0.5, 0.9, d)) * 0.014;
    float speck = (1.0 - smoothstep(0.0, 1.0, d)) * 0.5;
    gl_FragColor = vec4(vCol * mix(disc, speck, vDust) * vA, 1.0);
  }
`

const BOKEH_COUNT = 1200

// Background layers: opaque list + negative renderOrder so they draw first
// (and into the prism's transmission buffer, so the glass refracts them).
const layerMaterial = { depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }

export function Atmosphere({ controls, runtimeRef }) {
  const viewport = useThree((s) => s.viewport)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const reveal = useRef(0)

  const path = useMemo(
    () => buildPath(viewport.width, viewport.height, controls.prismSize),
    [viewport.width, viewport.height, controls.prismSize]
  )

  const vortex = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...layerMaterial,
        uniforms: {
          uPts: { value: Array.from({ length: SEGMENTS }, () => new THREE.Vector2()) },
          uPtsB: { value: Array.from({ length: SEGMENTS }, () => new THREE.Vector2()) },
          uHalf: { value: new THREE.Vector2() },
          uLen: { value: 1 },
          uGapT: { value: 0.5 },
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uDispersion: { value: 1 },
        },
        vertexShader: 'varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: vortexFragment,
      }),
    []
  )

  const bokeh = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...layerMaterial,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uParticleIntensity: { value: 0 },
          uDispersion: { value: 1 },
          uDpr: { value: 1 },
          uPts: { value: [] },
          uPtsB: { value: [] },
          uScale: { value: 1 },
          uGapT: { value: 0.5 },
          uOffsetX: { value: 0 },
        },
        vertexShader: bokehVertex,
        fragmentShader: bokehFragment,
      }),
    []
  )

  const bokehGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BOKEH_COUNT * 3), 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(Float32Array.from({ length: BOKEH_COUNT }, (_, i) => i + 1), 1))
    return g
  }, [])
  // Same density as the comp on any screen size.
  bokehGeometry.setDrawRange(0, Math.round(BOKEH_COUNT * Math.min(1, (size.width * size.height) / (1672 * 941))))

  useFrame((state) => {
    reveal.current = THREE.MathUtils.clamp(runtimeRef.current.prism, 0, 1)
    const time = state.clock.elapsedTime

    const u = vortex.uniforms
    u.uPts.value = path.points
    u.uPtsB.value = path.pointsB
    u.uHalf.value.copy(path.half)
    u.uLen.value = path.length
    u.uGapT.value = path.gapT
    u.uTime.value = time
    u.uIntensity.value = controls.vortexIntensity * reveal.current
    u.uDispersion.value = controls.vortexDispersion

    const b = bokeh.uniforms
    b.uTime.value = time
    b.uDpr.value = gl.getPixelRatio()
    b.uPts.value = path.points
    b.uPtsB.value = path.pointsB
    b.uScale.value = path.scale
    b.uGapT.value = path.gapT
    b.uOffsetX.value = controls.bokehOffsetX
    b.uIntensity.value = controls.bokehIntensity * reveal.current
    b.uParticleIntensity.value = controls.particleIntensity * reveal.current
    b.uDispersion.value = controls.vortexDispersion
  })

  return (
    <>
      {controls.vortexIntensity > 0 && (
        <mesh material={vortex} renderOrder={-10} frustumCulled={false}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      )}
      {(controls.bokehIntensity > 0 || controls.particleIntensity > 0) && (
        <points geometry={bokehGeometry} material={bokeh} renderOrder={-9} frustumCulled={false} />
      )}
    </>
  )
}
