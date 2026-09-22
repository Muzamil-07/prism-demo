// Single source of truth for the look. These defaults are the exact tuned (v3)
// values from the v0 preview, so the widget renders identically out of the box.
// The Elementor backend passes overrides through data-settings; anything it
// omits falls back to these numbers.
export const CONTROL_DEFAULTS = {
  // Glass (MeshTransmissionMaterial props)
  thickness: 1.2,
  chromaticAberration: 0.65,
  anisotropicBlur: 0.1,
  distortion: 0.35,
  distortionScale: 0.4,
  temporalDistortion: 0.1,
  ior: 1.5,
  reflectivity: 0.4,
  // Settled surface roughness for the edge-light STREAKS only — transmission is
  // decoupled (see patchTransmissionRoughness in Prism.jsx) so this never
  // grains the rainbow. Softens the edge streaks in the refracted state.
  roughness: 0.25,
  samples: 6,
  resolution: 512,
  // Rainbow / composition (read inside the frame loop)
  exitX: 0.08,
  exitY: 0.0,
  exitZ: -0.25,
  rainbowAngle: 7,
  rainbowEndRadius: 0.62,
  // Tightened from 0.12: the concept's rainbow keeps its bands distinct
  // instead of washing together into one glowy blur.
  rainbowFade: 0.09,
  rainbowIntensity: 3.15,
  // Fraction of the beam length over which the rainbow ramps up from the
  // prism tip: leaves faded/barely dispersed, then builds up with distance.
  rainbowOriginFade: 0.05,
  // Scroll: residual floor for the RAINBOW held only in the prism's SQUARE
  // transmission buffer, analogous to residualIllumination for the white beam.
  // Keeps the rainbow's refracted colour on the prism's faces (the "nice
  // left-face reflections") even when the visible rainbow beam intensity fades
  // to 0 on scroll-out. The main-pass rainbow still fades normally; only the
  // glass's internal view of it is floored. 0 = off (reflections fade with the
  // beam). Scale-compensated by residualScaleComp so they survive the prism
  // scaling up.
  rainbowResidual: 0,
  // Bloom (post-processing). Pulled back from 1 / 0.45: the concept reads
  // clean and contained, not a diffuse glowy halo around everything bright.
  bloomIntensity: 0.6,
  bloomThreshold: 1,
  bloomRadius: 0.28,
  // Behavior
  prismSize: 1.35,
  pointerInfluence: 1,
  whiteBeamAngle: 1.5,
  // White light master: scales the beam streak, soft glow, and flare dot as a
  // group. The scroll Light channel multiplies this base brightness down to 0.
  whiteLightIntensity: 1,
  // Load-in entrance
  introEnabled: true,
  // Scroll: fraction of rainbow color that lingers when the light channel
  // reaches 0. Default 0 = the rainbow fades out completely with the beam on
  // scroll. Raise it to keep some color drifting in the glass after the beam.
  residualColor: 0,
  // Scroll: residual illumination floor kept in the prism's SQUARE transmission
  // buffer when the light channel fades to 0. The beam + flare stay invisible in
  // the main view, but the glass still "sees" them in its refraction buffer, so
  // its chromatic dispersion keeps casting the coloured reflections on the prism
  // as if the beam were still striking it. 0 = prism goes dark with the beam.
  residualIllumination: 0.7,
  // Compensation that brightens the residual illumination as the prism scales
  // up. A larger prism spreads the fixed-size internal light thinner, so the
  // residual reads dimmer; this reads the LIVE combined scale each frame
  // (Prism Size x the sequencer's animated scale) and lifts the residual floor
  // in proportion. 0 = off (current look); ~1 ≈ roughly proportional.
  residualScaleComp: 0,
  // Mouse-move parallax rotation of the prism (applied to a dedicated layer so
  // it never fights the scroll sequencer's rig animation). Strength is the max
  // deflection in radians (signed — negative flips direction; 0 = off); damping
  // is the easing toward the target; vertical scales how much vertical mouse
  // adds an X-axis nod on top of the horizontal Y-axis turn.
  mouseRotateStrength: 0,
  mouseRotateDamping: 0.06,
  mouseRotateVertical: 0,
  // Gate: 0 = rotation always active; 1 = active only once the beam has faded
  // (white x scroll light ≈ 0), so it never swings the refraction while the
  // beam is present. Values between blend the two.
  mouseRotateGate: 1,
  // Concept 01 atmosphere behind the prism: vapor vortex + drifting bokeh.
  // 0 disables a layer. The swirl itself always anchors to the prism's lower
  // output corner (see Atmosphere.jsx buildPath), so it tracks prismSize.
  // Pulled back from 1/1: the concept's vapor + bokeh are a faint backdrop
  // texture, not a bright glowy layer competing with the prism.
  vortexIntensity: 0.5,
  bokehIntensity: 0.3,
  // Shifts the whole bokeh particle field left(-)/right(+), comp-px units.
  // Lets the drifting dust be nudged off the vapor line without moving it.
  bokehOffsetX: 0,
  // Soft floor reflection mirrored under the prism's base. 0 = off.
  reflectionIntensity: 0.6,
}

const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Merge a raw data-settings object over the defaults, coercing numbers. */
export function resolveControls(settings = {}) {
  const c = { ...CONTROL_DEFAULTS }
  for (const key of Object.keys(CONTROL_DEFAULTS)) {
    if (settings[key] === undefined || settings[key] === null) continue
    c[key] = typeof CONTROL_DEFAULTS[key] === 'boolean' ? Boolean(settings[key]) : num(settings[key], CONTROL_DEFAULTS[key])
  }
  return c
}
