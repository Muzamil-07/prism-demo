import * as THREE from 'three'
import { forwardRef, useEffect, useRef } from 'react'
import { useTexture, Instances, Instance } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'

export const Flare = forwardRef(
  ({ streak = [8, 20, 1], visible, assetsUrl = '', revealRef, residualRef, ...props }, fRef) => {
  const ref = useRef(null)
  const dotMat = useRef(null)
  const glowMat = useRef(null)
  const streakMat = useRef(null)
  const glowMesh = useRef(null)
  const streakMesh = useRef(null)
  // Per-pass opacity: [main camera pass, square transmission-buffer pass].
  const passOpacity = useRef({ main: 0, fbo: 0 })
  const [streakTexture, dotTexture, glowTexture] = useTexture([
    `${assetsUrl}/beam-streak.png`,
    `${assetsUrl}/flare-dot.png`,
    `${assetsUrl}/beam-glow.jpeg`,
  ])

  const config = {
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }

  // Hold the glow/streak at a residual floor in the square transmission-buffer
  // pass so the prism keeps its lit look after the flare has faded from the
  // main view. (Same render-target trick used by the beam.)
  useEffect(() => {
    const perPass = (renderer, _s, _c, _g, material) => {
      const rt = renderer.getRenderTarget()
      const isBuffer = rt !== null && rt.width === rt.height
      material.transparent = true
      material.opacity = isBuffer ? passOpacity.current.fbo : passOpacity.current.main
    }
    if (glowMesh.current) glowMesh.current.onBeforeRender = perPass
    if (streakMesh.current) streakMesh.current.onBeforeRender = perPass
    return () => {
      if (glowMesh.current) glowMesh.current.onBeforeRender = () => {}
      if (streakMesh.current) streakMesh.current.onBeforeRender = () => {}
    }
  }, [])

  useFrame((state) => {
    // Smoothly fade the whole flare (dot cluster, glow, streak) via the reveal
    // value instead of a hard visibility toggle, so it never pops in.
    const v = revealRef ? revealRef.current : visible ? 1 : 0
    // The dot cluster (sharp sparkle) always tracks the visible reveal; the
    // soft glow + streak keep a residual floor in the buffer pass so the prism
    // stays lit as if the beam were still striking it.
    if (dotMat.current) dotMat.current.opacity = v
    passOpacity.current.main = v
    passOpacity.current.fbo = Math.max(v, residualRef ? residualRef.current : 0)

    ref.current?.children.forEach((instance) => {
      instance.position.x =
        (Math[instance.scale.x > 1 ? 'sin' : 'cos']((state.clock.elapsedTime * instance.scale.x) / 2) *
          instance.scale.x) /
        8
      instance.position.y =
        (Math[instance.scale.x > 1 ? 'cos' : 'atan'](state.clock.elapsedTime * instance.scale.x) * instance.scale.x) / 5
    })
  })

  return (
    <group ref={fRef} {...props} dispose={null}>
      <Instances frames={Infinity}>
        <planeGeometry />
        <meshBasicMaterial ref={dotMat} map={dotTexture} {...config} />
        <group ref={ref}>
          <Instance scale={0.5} />
          <Instance scale={1.25} />
          <Instance scale={0.75} />
          <Instance scale={1.5} />
          <Instance scale={2} position={[0, 0, -0.7]} />
        </group>
      </Instances>

      <mesh ref={glowMesh} scale={1}>
        <planeGeometry />
        <meshBasicMaterial ref={glowMat} map={glowTexture} {...config} />
      </mesh>

      <mesh ref={streakMesh} rotation={[0, 0, Math.PI / 2]} scale={streak}>
        <planeGeometry />
        <meshBasicMaterial ref={streakMat} map={streakTexture} {...config} />
      </mesh>
    </group>
  )
  }
)

Flare.displayName = 'Flare'
