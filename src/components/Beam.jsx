import * as THREE from 'three'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { Reflect } from './Reflect.jsx'

export const Beam = forwardRef(
  ({ children, position, assetsUrl = '', stride = 4, width = 8, runtimeRef, ...props }, fRef) => {
    const streaks = useRef(null)
    const glow = useRef(null)
    const reflect = useRef(null)
    // Per-pass opacities: [main camera pass, square transmission-buffer pass].
    // The buffer value holds a residual floor so the glass keeps refracting the
    // beam into colour on the prism even after the beam has faded from view.
    const passOpacity = useRef({ streakMain: 1.5, streakFbo: 1.5, glowMain: 1, glowFbo: 1 })

    const [streakTexture, glowTexture] = useTexture([`${assetsUrl}/beam-streak.png`, `${assetsUrl}/beam-glow.jpeg`])

    const obj = new THREE.Object3D()
    const f = new THREE.Vector3()
    const t = new THREE.Vector3()
    const t2 = new THREE.Vector3()
    const n = new THREE.Vector3()
    const fSeg = new THREE.Vector3()
    const tSeg = new THREE.Vector3()

    // Taper for the entry segment only (light source -> first prism hit): wide
    // and soft near the source, narrowing down to the normal beam width right
    // where it strikes the glass, so it reads as the light focusing in rather
    // than a uniform bar.
    const ENTRY_TAPER_WIDTHS = [2.6, 1.6, 1]

    const config = {
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }

    useEffect(() => {
      streaks.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      glow.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

      // MeshTransmissionMaterial renders the scene into a SQUARE FBO to build
      // the prism's refraction; the main pass uses the non-square viewport.
      // Detect the square pass and hold the beam at its residual-floor opacity
      // there (so the glass still refracts it) while the main pass uses the
      // real, faded opacity (beam invisible on scroll).
      const perPass = (which) => (renderer, _s, _c, _g, material) => {
        const rt = renderer.getRenderTarget()
        const isBuffer = rt !== null && rt.width === rt.height
        const p = passOpacity.current
        material.transparent = true
        material.opacity =
          which === 'streak' ? (isBuffer ? p.streakFbo : p.streakMain) : isBuffer ? p.glowFbo : p.glowMain
      }
      if (streaks.current) streaks.current.onBeforeRender = perPass('streak')
      if (glow.current) glow.current.onBeforeRender = perPass('glow')
      return () => {
        if (streaks.current) streaks.current.onBeforeRender = () => {}
        if (glow.current) glow.current.onBeforeRender = () => {}
      }
    }, [])

    useFrame(() => {
      if (!reflect.current || !streaks.current || !glow.current) return
      const range = reflect.current.update() - 1
      const positions = reflect.current.positions

      const rt = runtimeRef?.current
      // Load-in reveal (ray grows in) and scroll light channel (dims/hides the
      // beam) are separate: reveal shapes geometry, light scales opacity.
      const beamReveal = rt ? THREE.MathUtils.clamp(rt.beam, 0, 1) : 1
      // Brightness = scroll light channel (0..1) x white-light master (base).
      const light =
        (rt ? THREE.MathUtils.clamp(rt.light, 0, 1) : 1) * (rt && rt.white != null ? rt.white : 1)
      // Buffer-pass brightness is floored at the residual so the prism stays lit
      // as the beam fades on scroll; the main pass follows `light` exactly.
      const fboLight = Math.max(light, rt && rt.residual != null ? rt.residual : 0)
      passOpacity.current.streakMain = 1.5 * light
      passOpacity.current.streakFbo = 1.5 * fboLight
      passOpacity.current.glowMain = 1 * light
      passOpacity.current.glowFbo = 1 * fboLight

      // Load-in: the ray "shines in", growing from the source along the first
      // segment toward the prism. Bounce/refraction segments and glow points
      // stay hidden until the front lands, then the full beam snaps on.
      if (beamReveal < 1 && range > 0) {
        f.fromArray(positions, 0)
        t.fromArray(positions, 3)
        t2.copy(f).lerp(t, beamReveal)
        n.subVectors(t2, f).normalize()
        obj.position.addVectors(f, t2).divideScalar(2)
        obj.scale.set(f.distanceTo(t2) * stride, width, 1)
        obj.rotation.set(0, 0, Math.atan2(n.y, n.x))
        obj.updateMatrix()
        streaks.current.setMatrixAt(0, obj.matrix)
        streaks.current.count = 1
        streaks.current.instanceMatrix.needsUpdate = true
        glow.current.count = 0
        glow.current.instanceMatrix.needsUpdate = true
        // Opacity (per pass) is applied in onBeforeRender from passOpacity.
        return
      }

      let idx = 0
      for (let i = 0; i < range; i++) {
        f.fromArray(positions, i * 3)
        t.fromArray(positions, i * 3 + 3)
        n.subVectors(t, f).normalize()
        if (i === 0) {
          const steps = ENTRY_TAPER_WIDTHS.length
          for (let s = 0; s < steps; s++) {
            fSeg.copy(f).lerp(t, s / steps)
            tSeg.copy(f).lerp(t, (s + 1) / steps)
            obj.position.addVectors(fSeg, tSeg).divideScalar(2)
            obj.scale.set(tSeg.distanceTo(fSeg) * stride, width * ENTRY_TAPER_WIDTHS[s], 1)
            obj.rotation.set(0, 0, Math.atan2(n.y, n.x))
            obj.updateMatrix()
            streaks.current.setMatrixAt(idx++, obj.matrix)
          }
        } else {
          obj.position.addVectors(f, t).divideScalar(2)
          obj.scale.set(t.distanceTo(f) * stride, width, 1)
          obj.rotation.set(0, 0, Math.atan2(n.y, n.x))
          obj.updateMatrix()
          streaks.current.setMatrixAt(idx++, obj.matrix)
        }
      }
      streaks.current.count = idx
      streaks.current.instanceMatrix.needsUpdate = true

      // Soft oversized blur right at the true light source, tapering down as
      // the beam approaches the prism (see ENTRY_TAPER_WIDTHS above) — reads
      // as the light focusing into a sharp line by the time it hits the glass.
      obj.position.fromArray(positions, 0)
      obj.scale.setScalar(2.4)
      obj.rotation.set(0, 0, 0)
      obj.updateMatrix()
      glow.current.setMatrixAt(0, obj.matrix)

      for (let i = 1; i < range; i++) {
        obj.position.fromArray(positions, i * 3)
        obj.scale.setScalar(0.75)
        obj.rotation.set(0, 0, 0)
        obj.updateMatrix()
        glow.current.setMatrixAt(i, obj.matrix)
      }
      glow.current.count = range
      glow.current.instanceMatrix.needsUpdate = true
      // Beam brightness (per pass) is applied in onBeforeRender from passOpacity:
      // the main pass follows the scroll light channel to 0 (beam fades out),
      // while the buffer pass holds the residual floor (prism stays lit).
    })

    useImperativeHandle(fRef, () => reflect.current, [])

    return (
      <group position={position}>
        <Reflect {...props} ref={reflect}>
          {children}
        </Reflect>

        <instancedMesh ref={streaks} args={[undefined, undefined, 100]}>
          <planeGeometry />
          <meshBasicMaterial map={streakTexture} opacity={1.5} {...config} transparent={false} />
        </instancedMesh>

        <instancedMesh ref={glow} args={[undefined, undefined, 100]}>
          <planeGeometry />
          <meshBasicMaterial map={glowTexture} {...config} />
        </instancedMesh>
      </group>
    )
  }
)

Beam.displayName = 'Beam'
