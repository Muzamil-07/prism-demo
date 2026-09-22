import * as THREE from 'three'
import { useRef, useLayoutEffect } from 'react'
import { useLoader, useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Pre-beam glass preset. A clean, reflective configuration with no dispersion or
// distortion, so the scene's point lights catch soft highlights on the prism
// edges — the "before the light beams in" look. As the beam lands, the material
// blends from this to the artistic control values. Dispersion/distortion
// channels animate from 0, so only these need values.
const ENTRANCE_GLASS = {
  thickness: 2.3,
  ior: 1.65,
  reflectivity: 0.75,
  // Softer, wider edge streaks so the pre-beam highlights read as gentle glints
  // rather than sharp mirror lines.
  roughness: 0.15,
  clearcoatRoughness: 0.6,
}

// Beam progress at which the glass swaps from the soft pre-beam preset to the
// refracting control values — a single-frame snap the moment the beam hits,
// rather than a blend across the sweep (which read as a visible "correction").
const BEAM_SNAP_POINT = 0.9

// Patch drei's MeshTransmissionMaterial transmission shader for a clean,
// grain-free refraction, chained after drei's own onBeforeCompile.
//
// (A) Decouple surface roughness from transmission roughness. drei reuses
// `roughnessFactor` (= material.roughness) inside the transmission shader, so
// raising roughness to soften the edge-light STREAKS (a surface-specular
// effect) also roughens the REFRACTION. We rewrite the transmission block so it
// always behaves as if roughness were 0, while the standard PBR specular still
// uses the real roughness for soft streaks:
//   - `if (false)`: skip the per-sample normal jitter
//   - thickness smear: drop the roughness term, keep anisotropicBlur
//   - framebuffer sample roughness -> 0: sharpest mip, no roughness blur
//
// (B) De-noise the chromatic dispersion. After (A), the ONLY remaining
// per-pixel randomness in the sample loop is `randomCoords = rand(...)`, which
// keyed off gl_FragCoord gives every pixel a different dispersion phase — the
// fine grain, worst in the blue channel (largest IOR offset). Raising
// samples/resolution can't remove it because it's per-pixel, not per-sample.
// Forcing it to a fixed phase turns the grain into a smooth dispersion gradient
// (the `samples` count then controls how smooth). We use 0.5 (mid-phase) so the
// average sample thickness/aberration is unchanged from the dithered mean.
function patchTransmission(shader) {
  const before = shader.fragmentShader
  let s = before
  s = s.replace('max(pow(roughnessFactor, 0.33), anisotropicBlur)', 'anisotropicBlur')
  s = s.replace('if (roughnessFactor > 0.0) {', 'if (false) {')
  s = s.replace(/sampleNorm, v, material\.roughness, material\.diffuseColor/g, 'sampleNorm, v, 0.0, material.diffuseColor')
  s = s.replace('float randomCoords = rand(runningSeed++);', 'float randomCoords = 0.5;')
  shader.fragmentShader = s
  if (s === before) {
    console.log('[prysmal] transmission patch applied no changes (drei shader may have changed)')
  }
}

export function Prism({ onRayOver, onRayOut, onRayMove, assetsUrl = '', controls, runtimeRef, ...props }) {
  const { nodes } = useLoader(GLTFLoader, `${assetsUrl}/prism.glb`)
  const material = useRef(null)

  // Chain the transmission patch onto the material. Keyed on samples/resolution
  // because drei recreates the material (via the mesh key below) when those
  // change, yielding a fresh un-patched instance each time.
  useLayoutEffect(() => {
    const m = material.current
    if (!m || m.__transmissionPatched) return
    const original = m.onBeforeCompile
    m.onBeforeCompile = function (shader, renderer) {
      original?.call(this, shader, renderer)
      patchTransmission(shader)
    }
    m.__transmissionPatched = true
    m.needsUpdate = true
  }, [controls.samples, controls.resolution])

  // Load-in: fade the glass in. Transmission materials read as invisible at
  // opacity 0, so this reveals the prism before the beam sweeps in. Once
  // revealed we restore the exact opaque state so the look is unchanged.
  useFrame(() => {
    const m = material.current
    if (!m) return
    const p = runtimeRef ? THREE.MathUtils.clamp(runtimeRef.current.prism, 0, 1) : 1
    // Snap (don't blend) between the pre-beam and refracting looks: flip in a
    // single frame the moment the white beam hits, so the bright impact masks
    // the swap. b is exactly 0 or 1, matching the v0 preview.
    const b = (runtimeRef ? runtimeRef.current.beam : 1) >= BEAM_SNAP_POINT ? 1 : 0

    if (p < 1) {
      m.transparent = true
      m.opacity = p
    } else {
      m.transparent = false
      m.opacity = 1
    }

    // Before the beam arrives (b -> 0) the glass uses the clean reflective
    // preset so the point lights read as soft edge highlights. As the beam
    // lands (b -> 1) blend to the artistic control values. At rest b = 1, so
    // this equals the control values.
    m.thickness = THREE.MathUtils.lerp(ENTRANCE_GLASS.thickness, controls.thickness, b)
    m.ior = THREE.MathUtils.lerp(ENTRANCE_GLASS.ior, controls.ior, b)
    m.reflectivity = THREE.MathUtils.lerp(ENTRANCE_GLASS.reflectivity, controls.reflectivity, b)

    // Surface roughness controls how the edge lights reflect: at 0 the glass is
    // a perfect mirror (sharp pinpoint highlights), a little roughness scatters
    // them into soft, wide streaks. Settled value is the tunable controls.roughness
    // (transmission is decoupled above, so this never grains the rainbow).
    // clearcoatRoughness (the surface coat) is held at the soft entrance value.
    m.roughness = THREE.MathUtils.lerp(ENTRANCE_GLASS.roughness, controls.roughness, b)
    m.clearcoatRoughness = ENTRANCE_GLASS.clearcoatRoughness
    const caAmount = THREE.MathUtils.clamp(runtimeRef?.current?.chromaticAberration ?? 1, 0, 1)
    m.chromaticAberration = THREE.MathUtils.lerp(0, controls.chromaticAberration * caAmount, b)
    m.anisotropicBlur = THREE.MathUtils.lerp(0, controls.anisotropicBlur, b)
    m.distortion = THREE.MathUtils.lerp(0, controls.distortion, b)
    m.distortionScale = THREE.MathUtils.lerp(0, controls.distortionScale, b)
    m.temporalDistortion = THREE.MathUtils.lerp(0, controls.temporalDistortion, b)
  })

  return (
    <group {...props}>
      {/* Low-res invisible proxy the raycaster actually hits. */}
      <mesh visible={false} scale={1.9} rotation={[Math.PI / 2, Math.PI, 0]} onRayOver={onRayOver} onRayOut={onRayOut} onRayMove={onRayMove}>
        <cylinderGeometry args={[1, 1, 1, 3, 1]} />
      </mesh>

      {/* Visible hi-res prism. MeshTransmissionMaterial samples the scene
          (including the rainbow behind it) into an FBO and refracts it with
          chromatic dispersion, so the spectrum bends and reflects through the glass. */}
      <mesh position={[0, 0, 0.6]} renderOrder={10} scale={2} dispose={null} geometry={nodes.Cone.geometry}>
        <MeshTransmissionMaterial
          ref={material}
          key={`${controls.samples}-${controls.resolution}`}
          transmission={1}
          thickness={controls.thickness}
          roughness={controls.roughness}
          chromaticAberration={controls.chromaticAberration}
          anisotropicBlur={controls.anisotropicBlur}
          distortion={controls.distortion}
          distortionScale={controls.distortionScale}
          temporalDistortion={controls.temporalDistortion}
          ior={controls.ior}
          clearcoat={1}
          clearcoatRoughness={0.04}
          reflectivity={controls.reflectivity}
          samples={controls.samples}
          resolution={controls.resolution}
          background={undefined}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
