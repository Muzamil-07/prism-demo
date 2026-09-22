import * as THREE from 'three'
import { Suspense, useRef, useCallback, useState, useEffect, useMemo } from 'react'
import { Canvas, useLoader, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, LUT } from '@react-three/postprocessing'
import { LUTCubeLoader, Effect, EffectAttribute } from 'postprocessing'
import { Beam } from './components/Beam.jsx'
import { Rainbow } from './components/Rainbow.jsx'
import { Prism } from './components/Prism.jsx'
import { Flare } from './components/Flare.jsx'
import { Atmosphere } from './components/Atmosphere.jsx'
import { PrismControls } from './components/PrismControls.jsx'
import { resolveControls } from './scene-controls.js'

function lerp(object, prop, goal, speed = 0.1) {
  object[prop] = THREE.MathUtils.lerp(object[prop], goal, speed)
}

const vector = new THREE.Vector3()
function lerpV3(value, goal, speed = 0.1) {
  value.lerp(vector.set(...goal), speed)
}

function calculateRefractionAngle(incidentAngle, glassIor = 2.5, airIor = 1.000293) {
  return Math.asin((airIor * Math.sin(incidentAngle)) / glassIor) || 0
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Composition anchors in the prism rig's local space. The rainbow apex stays
// inside/behind the prism so the glass masks the sharp convergence point.
const ENTRY_AIM_LOCAL = new THREE.Vector3(-0.12, -0.2, 0)

// World-space gap kept between the beam source and the prism's left edge, so a
// scaled-up prism never swallows the source (ray would start inside the glass).
const BEAM_SOURCE_CLEARANCE = 1.5
// World units the beam source is kept beyond the left screen edge, enough to
// hide its glow too.
const BEAM_SOURCE_OFFSCREEN = 2
const prismBounds = new THREE.Box3()

// Load-in timeline (seconds): prism fades in and drifts DOWN to rest, then the
// white beam shines in onto the prism, then the rainbow blooms with a flash.
const INTRO = {
  // Opacity finishes early; the gentle downward settle keeps easing longer.
  prism: [0.0, 1.1],
  prismDropDuration: 1.7,
  prismStartY: 0.5,
  // The white beam snaps in almost instantly (~0.12s) once the prism has faded
  // in — light travels too fast to see it crawl, and a near-instant strike also
  // makes the glass swap too quick for the eye to catch it morphing.
  beam: [1.1, 1.22],
  // The rainbow bursts the instant the beam lands — minimal gap so the strike
  // feels causal — then settles from a dramatic flash to steady.
  rainbow: [1.25, 2.35],
  // Reveal the flare as soon as the beam front reaches the prism.
  flareRevealAt: 0.9,
}

// Beam progress at which the prism swaps from its soft pre-beam look to the
// refracting look — the moment the white beam hits. Matches flareRevealAt so
// the swap is masked by the impact.
const BEAM_SNAP_POINT = 0.9

// How much brighter the edge lights get as the beam strikes, so their specular
// highlights keep blooming and the white edge streaks persist into the
// refracted (settled) state instead of fading out with the beam.
const EDGE_STRIKE_BOOST = 4

// Floor reflection under the prism, as in the Concept 01 reference. The camera
// looks straight at the prism (orthographic), so a real floor plane would be
// edge-on; instead the frame above the prism's base is mirrored below it,
// masked to the prism's width, smeared into vertical streaks and faded out.
// All uniforms are in screen uv and are updated each frame from the prism bounds.
const REFLECTION_FRAGMENT = /* glsl */ `
  uniform float uBase;
  uniform float uCenter;
  uniform float uHalfW;
  uniform float uHeight;
  uniform float uStrength;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = inputColor;
    float below = uBase - uv.y;
    if (below <= 0.0 || uStrength <= 0.0 || uHeight <= 0.0) return;
    float fall = below / uHeight;
    float mask = (1.0 - smoothstep(0.0, 0.6, fall)) *
      (1.0 - smoothstep(0.45, 0.95, abs(uv.x - uCenter) / uHalfW));
    if (mask <= 0.0) return;
    vec2 m = vec2(uv.x, uBase + below);
    // Blur widens with distance from the base (wet-floor look), mostly vertical.
    float spread = below * 0.18 + 0.001;
    vec3 acc = vec3(0.0);
    float total = 0.0;
    for (int i = -6; i <= 6; i++) {
      float k = float(i) / 6.0;
      float w = exp(-2.0 * k * k);
      acc += texture2D(inputBuffer, m + vec2(k * spread * 0.1, k * spread)).rgb * w;
      total += w;
    }
    outputColor = vec4(inputColor.rgb + acc / total * mask * mask * uStrength, inputColor.a);
  }
`

class ReflectionEffect extends Effect {
  constructor() {
    super('ReflectionEffect', REFLECTION_FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map(
        ['uBase', 'uCenter', 'uHalfW', 'uHeight', 'uStrength'].map((k) => [k, new THREE.Uniform(0)])
      ),
    })
  }
}

function PostFX({ assetsUrl, controls, reflection }) {
  const lut = useLoader(LUTCubeLoader, `${assetsUrl}/DwlG-F-6800-STD.cube`)
  return (
    <Suspense fallback={null}>
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom
          mipmapBlur
          levels={9}
          radius={controls.bloomRadius}
          intensity={controls.bloomIntensity}
          luminanceThreshold={controls.bloomThreshold}
          luminanceSmoothing={1}
        />
        <primitive object={reflection} />
        <LUT lut={lut} />
      </EffectComposer>
    </Suspense>
  )
}

// The prism has subtle continuous motion, so a pure on-demand canvas would
// eventually stop rendering. Keep demand mode, but explicitly invalidate at
// no more than 60 FPS. This prevents high-refresh monitors from driving the
// expensive WebGL scene at 120/144/165 FPS while preserving smooth motion.
function PrismRenderFrameLimiter() {
  const { invalidate } = useThree()

  useEffect(() => {
    let raf = 0
    let last = 0
    const interval = 1000 / 60

    const frame = (time) => {
      if (!document.hidden && time - last >= interval - 1) {
        last = time
        invalidate()
      }
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [invalidate])

  return null
}

export default function App({ assetsUrl, settings = {}, customJSON = null, sequenceJSON = null, hostElement }) {
  // Memoized so it keeps one stable identity across App re-renders (e.g. the
  // beamRevealed/isPrismHit state flips): the Edit Mode GUI mutates this
  // object's fields directly, and a fresh object each render would wipe that.
  const controls = useMemo(() => resolveControls(settings), [settings])
  const backgroundColor = settings.backgroundColor || '#000000'
  const reflection = useMemo(() => new ReflectionEffect(), [])

  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 100], zoom: 70 }}
    >
      <PrismRenderFrameLimiter />
      <color attach="background" args={[backgroundColor]} />
      <Scene
        assetsUrl={assetsUrl}
        controls={controls}
        settings={settings}
        customJSON={customJSON}
        sequenceJSON={sequenceJSON}
        hostElement={hostElement}
        reflection={reflection}
      />
      <PostFX assetsUrl={assetsUrl} controls={controls} reflection={reflection} />
    </Canvas>
  )
}

function Scene({ assetsUrl, controls, settings, customJSON, sequenceJSON, hostElement, reflection }) {
  const [isPrismHit, hitPrism] = useState(false)
  const [beamRevealed, setBeamRevealed] = useState(false)
  const flare = useRef(null)
  const ambient = useRef(null)
  const spot = useRef(null)
  const edgeLights = useRef(null)
  const beam = useRef(null)
  const rainbow = useRef(null)
  const baseRig = useRef(null)
  const rig = useRef(null)
  // Dedicated layer for the mouse-move parallax rotation. Nested INSIDE rig so
  // it composes with (never overwrites) the scroll sequencer's rig animation.
  const mouseRig = useRef(null)
  const { camera } = useThree()

  const entryAimWorld = useRef(new THREE.Vector3())
  const exitWorld = useRef(new THREE.Vector3())
  const animatedEntryAim = useRef(new THREE.Vector3())
  const opticalRefractionAngle = useRef(null)
  const opticalRefractionBaseline = useRef(null)
  // Last stable dynamic refraction delta, held while scrolling out so the
  // rainbow angle doesn't wobble as the scroll builder sweeps the prism.
  const appliedRefractionDelta = useRef(0)

  // Shared runtime read by Beam (opacity) and Prism (opacity), and written by
  // the scroll builder (light). prism/beam/rainbow are load-in progress 0..1;
  // light is the scroll-driven beam channel 1..0.
  const runtime = useRef({ prism: 0, beam: 0, rainbow: 0, light: 1, chromaticAberration: 1 })
  const introStart = useRef(null)
  // Smoothly fades the flare (dot/glow/streak) in and out instead of popping.
  const flareReveal = useRef(0)
  // Residual floor the flare glow/streak hold in the prism's transmission
  // buffer so the prism stays lit once the flare has faded from view.
  const flareResidual = useRef(0)
  // The rainbow's main-pass emissive intensity (what the frame loop lerps), and
  // the floor it holds ONLY in the prism's transmission buffer so its refracted
  // colour stays on the prism's faces after the visible rainbow beam fades.
  const rainbowMain = useRef(0)
  const rainbowFloor = useRef(0)

  // Global pointer, normalized to -1..1 (R3F convention: y up). Tracked on the
  // window rather than the canvas so it keeps updating even when the fixed
  // prism sits BEHIND other page elements (z-index 0/-1) that would otherwise
  // swallow the canvas's own pointer events. Falls back to R3F's state.pointer
  // if no move has been seen yet.
  const globalPointer = useRef({ x: 0, y: 0, seen: false })
  useEffect(() => {
    const onMove = (e) => {
      // Ignore touch input: on phones/tablets the gyroscope already drives the
      // model, and letting a finger drag move it too makes the two inputs fight.
      // Mouse and pen still work (including on hybrid touch laptops).
      if (e.pointerType === 'touch') return
      globalPointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      globalPointer.current.y = -(e.clientY / window.innerHeight) * 2 + 1
      globalPointer.current.seen = true
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // True on primary-touch devices (phones/tablets). Used to disable the
  // pointer-driven light nudge and the pre-gyro pointer fallback there, so on
  // those devices ONLY the gyroscope moves the model — touching does nothing.
  const coarsePointer = useRef(false)
  useEffect(() => {
    coarsePointer.current =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
  }, [])

  // Gyroscope (mobile): device tilt drives the SAME normalized pointer the
  // mouse writes to, so it inherits the identical strength / easing / gate /
  // vertical-tilt settings — no separate controls. gamma (left-right tilt) maps
  // to horizontal turn, beta (front-back tilt, relative to a comfortable ~45°
  // holding angle) to the vertical nod. The first reading sets the neutral so
  // "level for how you're holding it" is centered. Values are clamped to a
  // small tilt range so a gentle tilt reaches full deflection. iOS 13+ gates
  // DeviceOrientationEvent behind a permission call that must run from a user
  // gesture, so we request it on the first touch/click.
  useEffect(() => {
    const TILT_RANGE_DEG = 25
    let betaNeutral = null
    let active = false

    const onOrient = (e) => {
      if (e.gamma === null || e.beta === null) return
      if (betaNeutral === null) betaNeutral = e.beta
      const landscape = Math.abs(window.orientation ?? 0) === 90
      // In landscape the device's left-right tilt shows up on beta, not gamma.
      const rawX = landscape ? e.beta - (betaNeutral ?? 0) : e.gamma
      const rawY = landscape ? e.gamma : e.beta - (betaNeutral ?? 0)
      globalPointer.current.x = THREE.MathUtils.clamp(rawX / TILT_RANGE_DEG, -1, 1)
      globalPointer.current.y = THREE.MathUtils.clamp(-rawY / TILT_RANGE_DEG, -1, 1)
      globalPointer.current.seen = true
    }

    const enable = () => {
      if (active) return
      active = true
      window.addEventListener('deviceorientation', onOrient)
    }

    // iOS 13+: must ask permission from a user gesture. Elsewhere: just listen.
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined
    const needsPermission = DOE && typeof DOE.requestPermission === 'function'
    let onGesture = null
    if (needsPermission) {
      onGesture = () => {
        DOE.requestPermission()
          .then((res) => {
            if (res === 'granted') enable()
          })
          .catch(() => {})
        window.removeEventListener('touchend', onGesture)
        window.removeEventListener('click', onGesture)
      }
      window.addEventListener('touchend', onGesture, { passive: true })
      window.addEventListener('click', onGesture)
    } else if (DOE) {
      enable()
    }

    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      if (onGesture) {
        window.removeEventListener('touchend', onGesture)
        window.removeEventListener('click', onGesture)
      }
    }
  }, [])

  // Per-pass rainbow intensity: the main/postprocessing pass uses the real
  // (possibly faded-to-0) intensity so the visible rainbow beam disappears on
  // scroll-out, while the SQUARE transmission-buffer pass is floored to
  // rainbowFloor so the glass keeps refracting the rainbow onto the prism (the
  // left-face reflections). Same square-FBO detection the beam residual uses.
  useEffect(() => {
    const mesh = rainbow.current
    if (!mesh) return
    mesh.onBeforeRender = (renderer, _scene, _camera, _geometry, material) => {
      const rt = renderer.getRenderTarget()
      const isBuffer = rt !== null && rt.width === rt.height
      material.emissiveIntensity = isBuffer
        ? Math.max(rainbowMain.current, rainbowFloor.current)
        : rainbowMain.current
    }
    return () => {
      mesh.onBeforeRender = () => {}
    }
  }, [])

  // Hold the load-in entrance while a page preloader is still showing. Many
  // themes add a class to <html> while a loading overlay is up (the reported
  // selector is ".first--load.loading"); if the prism entrance plays underneath
  // that overlay it finishes before the visitor ever sees it. While the
  // selector matches <html>, introHeld stays true and the frame loop parks the
  // prism in its hidden pre-intro state; the moment the class is removed the
  // entrance plays fresh from the very start. If the selector is empty or never
  // matches (no preloader), nothing is held and the intro plays immediately.
  const introHeld = useRef(false)
  useEffect(() => {
    const selector = (settings.introHoldSelector || '').trim()
    const root = typeof document !== 'undefined' ? document.documentElement : null
    if (!selector || !root) return

    let matches
    try {
      // Validate the selector once so a typo can't throw every mutation.
      root.matches(selector)
      matches = () => root.matches(selector)
    } catch {
      console.warn('[Prysmal Prism] Invalid Intro Hold selector, ignoring:', selector)
      return
    }

    // Optional extra pause (ms) AFTER the preloader class clears, before the
    // entrance plays — lets the intro line up with the tail end of a fade-out
    // overlay instead of firing the instant the class flips.
    const delayMs = Math.max(0, parseInt(settings.introHoldDelay ?? 0, 10) || 0)

    let delayTimer = null
    let fallback = null
    const clearFallback = () => {
      if (fallback) { clearTimeout(fallback); fallback = null }
    }
    const cancelRelease = () => {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null }
    }

    // Arm (or re-arm) the hold: hide the prism and reset the intro clock so the
    // entrance replays FRESH once the selector clears. Called at mount and again
    // whenever the selector re-appears later — e.g. an AJAX page transition that
    // re-adds ".loading" to <html> without ever reloading the widget.
    const hold = () => {
      cancelRelease()
      clearFallback()
      introHeld.current = true
      introStart.current = null
      // Safety net: never leave the prism hidden forever if the class is
      // misconfigured or never removed — fail visible, not blank.
      fallback = setTimeout(() => {
        console.warn('[Prysmal Prism] Intro hold selector still present after 15s; playing entrance anyway.')
        release()
      }, 15000)
    }

    const release = () => {
      if (!introHeld.current) return
      introHeld.current = false // frame loop starts the intro clock next frame
      cancelRelease()
      clearFallback()
    }

    const scheduleRelease = () => {
      if (delayTimer) return
      if (delayMs > 0) {
        delayTimer = setTimeout(release, delayMs)
      } else {
        release()
      }
    }

    // Observe for the widget's whole lifetime so page transitions that add the
    // class AFTER mount (AJAX navigation) re-trigger the hold + replay, not just
    // a fresh page load where the class is already present at mount.
    if (matches()) hold()
    const observer = new MutationObserver(() => {
      if (matches()) {
        // Selector present: hold if we weren't already, or cancel a pending
        // release if the class flickered back during the delay window.
        if (!introHeld.current) hold()
        else cancelRelease()
      } else if (introHeld.current) {
        // Selector cleared: play the entrance (after the optional delay).
        scheduleRelease()
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      cancelRelease()
      clearFallback()
    }
  }, [settings.introHoldSelector, settings.introHoldDelay])

  const rayOut = useCallback(() => hitPrism(false), [])

  const rayOver = useCallback((e) => {
    e.stopPropagation()
    hitPrism(true)
    // Do NOT set emissiveIntensity here: the ray strikes the prism while the
    // beam is still invisible during load-in, and an instant burst would flash
    // the rainbow early. The gated lerp in useFrame blooms it in at the right time.
    if (rainbow.current?.material) rainbow.current.material.speed = 1
  }, [])

  const vec = useRef(new THREE.Vector3())

  const rayMove = useCallback(({ api, position, direction, normal }) => {
    if (!normal || !rainbow.current || !flare.current || !spot.current) return

    vec.current.toArray(api.positions, api.number++ * 3)
    flare.current.position.set(position.x, position.y, -0.5)
    flare.current.rotation.set(0, 0, -Math.atan2(direction.x, direction.y))

    let angleScreenCenter = Math.atan2(-position.y, -position.x)
    const normalAngle = Math.atan2(normal.y, normal.x)
    const incidentAngle = angleScreenCenter - normalAngle
    const refractionAngle = calculateRefractionAngle(incidentAngle) * 6
    angleScreenCenter += refractionAngle
    if (window.__dbg) console.log('[dbg]', 'incident', incidentAngle.toFixed(3), 'refr', refractionAngle.toFixed(3), 'delta', THREE.MathUtils.radToDeg(Math.atan2(Math.sin(angleScreenCenter-(opticalRefractionBaseline.current??angleScreenCenter)), Math.cos(angleScreenCenter-(opticalRefractionBaseline.current??angleScreenCenter)))).toFixed(2))

    opticalRefractionAngle.current = angleScreenCenter
    if (opticalRefractionBaseline.current === null) {
      opticalRefractionBaseline.current = angleScreenCenter
    }

    lerpV3(spot.current.target.position, [Math.cos(angleScreenCenter), Math.sin(angleScreenCenter), 0], 0.05)
    spot.current.target.updateMatrixWorld()
  }, [])

  useFrame((state) => {
    if (!beam.current || !rig.current || !baseRig.current || !rainbow.current?.material || !spot.current || !ambient.current) return

    const elapsed = state.clock.elapsedTime

    // Load-in timeline off the first rendered frame (skippable via setting).
    // While the preloader hold is active, keep the prism in its hidden pre-intro
    // state and DON'T start the clock, so the entrance plays fresh the instant
    // the preloader class is removed (introHeld flips to false).
    if (controls.introEnabled && introHeld.current) {
      runtime.current.prism = 0
      runtime.current.beam = 0
      runtime.current.rainbow = 0
      introStart.current = null
    } else if (controls.introEnabled) {
      if (introStart.current === null) introStart.current = elapsed
      const introT = elapsed - introStart.current
      runtime.current.prism = smoothstep(INTRO.prism[0], INTRO.prism[1], introT)
      runtime.current.beam = smoothstep(INTRO.beam[0], INTRO.beam[1], introT)
      runtime.current.rainbow = smoothstep(INTRO.rainbow[0], INTRO.rainbow[1], introT)
    } else {
      runtime.current.prism = 1
      runtime.current.beam = 1
      runtime.current.rainbow = 1
    }

    // Publish the white-light master so the Beam frame loop can scale streak +
    // glow by the same value the flare uses below.
    runtime.current.white = THREE.MathUtils.clamp(controls.whiteLightIntensity, 0, 8)
    // Publish the residual floor the Beam holds in its transmission-buffer pass,
    // so the glass keeps refracting the beam into colour on the prism after the
    // beam fades from view on scroll. Scale-compensated: as the sequencer scales
    // the prism up (rig.scale) the fixed-size internal light spreads thinner and
    // reads dimmer, so residualScaleComp lifts the floor in proportion to the
    // LIVE combined scale (Prism Size x the sequencer's animated scale). At
    // comp 0 or scale 1 this is just residualIllumination — look unchanged.
    const liveScale = THREE.MathUtils.clamp(controls.prismSize, 0.01, 20) * (rig.current.scale?.x ?? 1)
    const scaleExcess = Math.max(0, liveScale - 1)
    const compResidual =
      controls.residualIllumination * (1 + THREE.MathUtils.clamp(controls.residualScaleComp, 0, 4) * scaleExcess)
    runtime.current.residual = THREE.MathUtils.clamp(compResidual, 0, 1)

    // Reveal the flare only once the beam front reaches the prism, then fade it
    // in smoothly. Scaled by the white master AND the scroll light channel, so
    // the flare dot/glow track the beam brightness and fade out together on scroll.
    if (!beamRevealed && runtime.current.beam >= INTRO.flareRevealAt) setBeamRevealed(true)
    // The flare (dot/glow/streak) fades out fully in the MAIN view together with
    // the beam as the scroll light channel -> 0. The colour it casts on the
    // prism is preserved separately via flareResidual, which floors the glow +
    // streak in the transmission-buffer pass only (see Flare.jsx). This is the
    // "beam is gone but the prism stays lit" effect.
    const scrollLight = THREE.MathUtils.clamp(runtime.current.light, 0, 1)
    const flareTarget = (isPrismHit && beamRevealed ? 1 : 0) * runtime.current.white * scrollLight
    flareReveal.current = THREE.MathUtils.lerp(flareReveal.current, flareTarget, 0.12)
    // Uses the scale-compensated floor published above so the flare's on-prism
    // colour brightens with scale the same way the beam's does.
    flareResidual.current = (isPrismHit && beamRevealed ? 1 : 0) * runtime.current.residual

    // Subtle mouse-move parallax rotation on the dedicated mouseRig layer. The
    // gate ramps it in only as the beam fades (white x scroll light -> 0) at
    // gate 1, so it never swings the refraction while the beam is lit. At gate 0
    // it is always active. Strength is signed (negative flips direction).
    if (mouseRig.current) {
      // Use the window-tracked pointer so rotation still responds when the
      // prism is behind other elements; fall back to R3F's until the first move.
      // On phones/tablets, before any gyro reading has arrived, DON'T fall back
      // to R3F's pointer (which a touch would move) — hold center instead.
      const px = globalPointer.current.seen ? globalPointer.current.x : (coarsePointer.current ? 0 : state.pointer.x)
      const py = globalPointer.current.seen ? globalPointer.current.y : (coarsePointer.current ? 0 : state.pointer.y)
      const beamPresence =
        THREE.MathUtils.clamp(runtime.current.white ?? 1, 0, 1) * THREE.MathUtils.clamp(runtime.current.light, 0, 1)
      const beamGoneGate = THREE.MathUtils.clamp(1 - beamPresence / 0.6, 0, 1)
      const mouseGate = THREE.MathUtils.lerp(1, beamGoneGate, THREE.MathUtils.clamp(controls.mouseRotateGate, 0, 1))
      const damping = THREE.MathUtils.clamp(controls.mouseRotateDamping, 0.01, 1)
      const targetRotY = px * controls.mouseRotateStrength * mouseGate
      const targetRotX =
        -py * controls.mouseRotateStrength * THREE.MathUtils.clamp(controls.mouseRotateVertical, 0, 1) * mouseGate
      mouseRig.current.rotation.y = THREE.MathUtils.lerp(mouseRig.current.rotation.y, targetRotY, damping)
      mouseRig.current.rotation.x = THREE.MathUtils.lerp(mouseRig.current.rotation.x, targetRotX, damping)
    }

    // Cinematic default: light approaches from the left with a small organic
    // drift, nudged only subtly toward the pointer (Pointer Influence setting).
    // Pointer light nudge: disabled on phones/tablets so touching the screen
    // doesn't shift the beam — only the gyroscope should move things there.
    const pointerInfluence = coarsePointer.current ? 0 : THREE.MathUtils.clamp(controls.pointerInfluence, 0, 1) * 0.12
    const pointerX = (state.pointer.x * state.viewport.width) / 2
    const pointerY = (state.pointer.y * state.viewport.height) / 2
    // Source stays left of the prism's live bounds (Prism Size x sequencer/edit
    // scale x position), however large it gets or wherever the pointer pulls it.
    prismBounds.setFromObject(baseRig.current)
    const maxStartX = prismBounds.isEmpty() ? Infinity : prismBounds.min.x - BEAM_SOURCE_CLEARANCE
    const baseStartX = Math.min(-state.viewport.width * 0.58, maxStartX)

    // Feed the floor reflection the prism's on-screen base / centre / size.
    if (!prismBounds.isEmpty()) {
      const ru = reflection.uniforms
      // NDC -> uv. Read each projected value immediately: `vector` is shared.
      const uvX = (x) => vector.set(x, 0, 0).project(state.camera).x * 0.5 + 0.5
      const uvY = (y) => vector.set(0, y, 0).project(state.camera).y * 0.5 + 0.5
      const base = uvY(prismBounds.min.y)
      ru.get('uBase').value = base
      ru.get('uCenter').value = uvX((prismBounds.min.x + prismBounds.max.x) / 2)
      ru.get('uHeight').value = uvY(prismBounds.max.y) - base
      ru.get('uHalfW').value = (uvX(prismBounds.max.x) - uvX(prismBounds.min.x)) / 2
      ru.get('uStrength').value = controls.reflectionIntensity
    }

    animatedEntryAim.current.copy(ENTRY_AIM_LOCAL)
    animatedEntryAim.current.y += Math.sin(elapsed * 0.34) * 0.035
    entryAimWorld.current.copy(animatedEntryAim.current)
    rig.current.localToWorld(entryAimWorld.current)

    const whiteBeamAngle = THREE.MathUtils.degToRad(controls.whiteBeamAngle)
    const beamDx = entryAimWorld.current.x - baseStartX
    const baseStartY = entryAimWorld.current.y - Math.tan(whiteBeamAngle) * beamDx + Math.sin(elapsed * 0.48) * 0.07

    let startX = Math.min(THREE.MathUtils.lerp(baseStartX, pointerX, pointerInfluence), maxStartX)
    let startY = THREE.MathUtils.lerp(baseStartY, pointerY, pointerInfluence)
    // The pointer nudge pulls the source toward the pointer, which with the
    // pointer on the right dragged the source (and its glow) into view. Slide
    // it back along its own ray until it's past the left edge: the beam's
    // angle still follows the pointer, but the source never shows.
    const offscreenX = -state.viewport.width / 2 - BEAM_SOURCE_OFFSCREEN
    if (startX > offscreenX) {
      const k = (entryAimWorld.current.x - offscreenX) / (entryAimWorld.current.x - startX)
      startY = entryAimWorld.current.y + (startY - entryAimWorld.current.y) * k
      startX = offscreenX
    }

    beam.current.setRay([startX, startY, 0], [entryAimWorld.current.x, entryAimWorld.current.y, entryAimWorld.current.z])

    // Intro settle is applied to baseRig so it never fights the scroll builder,
    // which animates rig. Uses its own longer easeOut window so the downward
    // drift stays visible after the prism is opaque. prismSize scales baseRig.
    if (controls.introEnabled && introStart.current !== null) {
      const dropRaw = THREE.MathUtils.clamp((elapsed - introStart.current) / INTRO.prismDropDuration, 0, 1)
      const dropEase = 1 - Math.pow(1 - dropRaw, 3)
      baseRig.current.position.y = THREE.MathUtils.lerp(INTRO.prismStartY, 0, dropEase)
    } else if (controls.introEnabled) {
      // Held pre-intro (clock not started yet): park at the entrance start Y so
      // the prism drops in from the same place once the hold clears.
      baseRig.current.position.y = INTRO.prismStartY
    } else {
      baseRig.current.position.y = 0
    }

    exitWorld.current.set(controls.exitX, controls.exitY, controls.exitZ)
    rig.current.localToWorld(exitWorld.current)
    rainbow.current.position.copy(exitWorld.current)

    rainbow.current.material.endRadius = controls.rainbowEndRadius
    rainbow.current.material.fade = controls.rainbowFade
    rainbow.current.material.originFade = controls.rainbowOriginFade

    const rainbowBaseAngle = THREE.MathUtils.degToRad(controls.rainbowAngle)
    // Only recompute the dynamic refraction angle while NOT scrolling out. The
    // scroll builder moves and rotates the prism, which sweeps the beam's hit
    // point and makes the recomputed angle swing (the rainbow tilting down then
    // back up). Freezing the last stable delta once the scroll light channel
    // dips below ~1 lets the rainbow simply fade instead of wobbling.
    const rainbowTrackingActive = runtime.current.light > 0.001
    if (
      rainbowTrackingActive &&
      opticalRefractionAngle.current !== null &&
      opticalRefractionBaseline.current !== null
    ) {
      appliedRefractionDelta.current = Math.atan2(
        Math.sin(opticalRefractionAngle.current - opticalRefractionBaseline.current),
        Math.cos(opticalRefractionAngle.current - opticalRefractionBaseline.current)
      )
    }

    rainbow.current.rotation.z =
      rainbowBaseAngle + appliedRefractionDelta.current + Math.sin(elapsed * 0.22) * 0.008

    // Scroll light channel: as light -> 0 the beam fades out (handled in Beam),
    // while the rainbow only drops to a residual floor so color keeps drifting.
    const residual = THREE.MathUtils.clamp(controls.residualColor, 0, 1)
    const light = THREE.MathUtils.clamp(runtime.current.light, 0, 1)
    const scrollFactor = residual + (1 - residual) * light
    const baseIntensity = isPrismHit ? controls.rainbowIntensity : 0

    // During its intro the rainbow overshoots into a bright flash (sin
    // envelope) with a shimmer speed spike, then settles to the steady value —
    // a dramatic emergence rather than a flat fade-in.
    let rainbowGoal
    if (controls.introEnabled && runtime.current.rainbow < 1) {
      const p = runtime.current.rainbow
      const flash = Math.sin(p * Math.PI)
      rainbowGoal = baseIntensity * (p + 1.9 * flash) * scrollFactor
      rainbow.current.material.speed = 1 + 4 * flash
    } else {
      rainbowGoal = baseIntensity * scrollFactor
      rainbow.current.material.speed = 1
    }
    // Lerp the MAIN-pass emissive; the per-pass onBeforeRender floors it in the
    // square transmission buffer. The spotlight follows the main-pass value, so
    // the residual floor never adds real scene light — only the glass's
    // refracted view of the rainbow persists after the beam fades.
    rainbowMain.current = THREE.MathUtils.lerp(rainbowMain.current, rainbowGoal, 0.25)
    rainbow.current.material.emissiveIntensity = rainbowMain.current
    // Rainbow residual floor, gated by "beam is striking the prism" like the
    // flare residual, and scale-compensated with the same scaleExcess computed
    // above so it survives the prism scaling up.
    rainbowFloor.current =
      (isPrismHit && beamRevealed ? 1 : 0) *
      THREE.MathUtils.clamp(controls.rainbowResidual, 0, 4) *
      (1 + THREE.MathUtils.clamp(controls.residualScaleComp, 0, 4) * scaleExcess)
    spot.current.intensity = rainbowMain.current

    // Edge lights: before the beam arrives there is no light in the scene for
    // the glass to reflect, so the prism would read as pure black. These lights
    // illuminate the prism edges so they catch specular highlights (the "as if
    // light is beaming in" look). They ramp up with the prism fade-in and are
    // KEPT ON through and after the strike (boosted) so the soft white edge
    // streaks persist into the refracted state rather than fading with the beam.
    if (edgeLights.current) {
      const boost = 1 + (EDGE_STRIKE_BOOST - 1) * smoothstep(BEAM_SNAP_POINT, 1, runtime.current.beam)
      const edgeEnv = runtime.current.prism * boost
      for (const child of edgeLights.current.children) {
        const target = child.userData.target ?? 1
        child.intensity = edgeEnv * target
      }
    }
  })

  return (
    <>
      <ambientLight ref={ambient} intensity={0} />
      <pointLight position={[10, -10, 0]} intensity={0.05} />
      <pointLight position={[0, 10, 0]} intensity={0.05} />
      <pointLight position={[-10, 0, 0]} intensity={0.05} />
      <spotLight ref={spot} intensity={1} distance={7} angle={1} penumbra={1} position={[0, 0, 1]} />

      {/* Edge lights (intensity driven in useFrame). One light grazing each of
          the three visible prism edges (L-B, R-B, and the top internal L-R),
          ramping 0 -> 1 as the prism enters and boosted at the strike so the
          soft streaks persist into the settled refracted state. */}
      <group ref={edgeLights}>
        {/* L-B (lower-left edge) */}
        <pointLight position={[-2, -4.5, 1]} intensity={0} distance={6} userData={{ target: 1 }} />
        {/* R-B (lower-right edge) */}
        <pointLight position={[4, -0.5, 0]} intensity={0} distance={4} userData={{ target: 1 }} />
        {/* L-R (top internal vertical edge) */}
        <pointLight position={[1, 5.5, 0]} intensity={0} distance={7} userData={{ target: 1 }} />
      </group>

      <Atmosphere controls={controls} runtimeRef={runtime} />

      <Beam ref={beam} bounce={10} far={20} assetsUrl={assetsUrl} runtimeRef={runtime}>
        <group ref={baseRig} scale={controls.prismSize}>
          <group ref={rig}>
            <group ref={mouseRig}>
              <Prism
                assetsUrl={assetsUrl}
                controls={controls}
                runtimeRef={runtime}
                scale={1.15}
                position={[0, -0.35, 0]}
                onRayOver={rayOver}
                onRayOut={rayOut}
                onRayMove={rayMove}
              />
            </group>
          </group>
        </group>
      </Beam>

      <Rainbow ref={rainbow} startRadius={0} endRadius={0.62} fade={0.12} emissiveIntensity={0} />
      <Flare ref={flare} assetsUrl={assetsUrl} revealRef={flareReveal} residualRef={flareResidual} renderOrder={10} scale={1} streak={[10, 18, 1]} />

      <PrismControls
        hostElement={hostElement}
        rigRef={rig}
        runtimeRef={runtime}
        camera={camera}
        rainbowRef={rainbow}
        controls={controls}
        customJSON={customJSON}
        sequenceJSON={sequenceJSON}
        editMode={Boolean(settings.editMode)}
        sequenceBuilder={Boolean(settings.sequenceBuilder)}
        scrollSequence={Boolean(settings.scrollSequence)}
      />
    </>
  )
}
