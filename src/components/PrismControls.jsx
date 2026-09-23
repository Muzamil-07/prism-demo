import { useEffect } from 'react'
import GUI from 'lil-gui'

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * IMPORTANT:
 * The host theme already loads GSAP + ScrollTrigger globally. We intentionally
 * reuse that runtime instead of bundling a second GSAP copy, because a second
 * copy can replace window.gsap and break the theme's Lenis/preloader/cursor
 * scripts.
 */
function getGsapRuntime() {
  if (typeof window === 'undefined') return { gsap: null, ScrollTrigger: null }
  const gsap = window.gsap || null
  const ScrollTrigger = window.ScrollTrigger || null
  if (gsap && ScrollTrigger) {
    try {
      gsap.registerPlugin(ScrollTrigger)
    } catch (error) {
      console.warn('[Prysmal Prism] Could not register the theme ScrollTrigger instance:', error)
    }
  }
  return { gsap, ScrollTrigger }
}

function safeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function applyTransform(object, transform = {}) {
  if (!object) return
  const position = transform.position || {}
  const rotate = transform.rotate || transform.rotation || {}
  const scale = transform.scale || {}

  object.position.set(
    safeNumber(position.x, object.position.x),
    safeNumber(position.y, object.position.y),
    safeNumber(position.z, object.position.z)
  )
  object.rotation.set(
    safeNumber(rotate.x, object.rotation.x),
    safeNumber(rotate.y, object.rotation.y),
    safeNumber(rotate.z, object.rotation.z)
  )
  object.scale.set(
    safeNumber(scale.x, object.scale.x),
    safeNumber(scale.y, object.scale.y),
    safeNumber(scale.z, object.scale.z)
  )
}

function sequenceDefaults(index, object, runtimeRef) {
  return {
    index,
    name: `Animation ${index}`,
    easing: 'none',
    easingPower: 'power1',
    scroll: {
      trigger: 'canvas',
      triggerElement: '',
      itemStartPos: 'top',
      windowStartPos: 'bottom',
      itemEndPos: 'bottom',
      windowEndPos: 'top',
      startOffset: 0,
      endOffset: 0,
      scrub: 1,
      pin: false,
      showMarkers: false,
    },
    to: {
      position: {
        x: object?.position.x ?? 0,
        y: object?.position.y ?? 0,
        z: object?.position.z ?? 0,
      },
      rotate: {
        x: object?.rotation.x ?? 0,
        y: object?.rotation.y ?? 0,
        z: object?.rotation.z ?? 0,
      },
      scale: {
        x: object?.scale.x ?? 1,
        y: object?.scale.y ?? 1,
        z: object?.scale.z ?? 1,
      },
      // New: beam/light channel target. 1 = full light, 0 = beam fully faded
      // out (residual rainbow color still drifts in the glass).
      light: 1,
      // 0..1 multiplier of the Elementor Chromatic Aberration setting.
      // 0 = no CA, 1 = full Elementor value.
      chromaticAberration:
        runtimeRef?.current && typeof runtimeRef.current.chromaticAberration === 'number'
          ? runtimeRef.current.chromaticAberration
          : 1,
    },
  }
}

// A position:fixed element (or one inside a fixed ancestor) cannot anchor a
// ScrollTrigger. GSAP derives the trigger's DOCUMENT position from
// getBoundingClientRect() + scrollY, but a fixed element's rect stays glued to
// the viewport, so its computed document offset silently tracks wherever you
// were scrolled when the trigger was (re)built. Scrubbing feels fine during one
// continuous scroll (geometry baked once at load), but a resize or a
// reload-mid-scroll rebuilds it against the current scroll and the prism snaps
// to the wrong state — the exact bug reported.
function isFixedPositioned(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return true
  }
  return false
}

function resolveTrigger(sequence, hostElement) {
  const triggerType = sequence.scroll?.trigger || 'canvas'
  let element = hostElement
  if (triggerType === 'page') {
    return document.documentElement
  }
  if (triggerType === 'custom') {
    const selector = sequence.scroll?.triggerElement?.trim()
    element = (selector && document.querySelector(selector)) || hostElement
  }
  // In fixed background mode the canvas host is position:fixed, making it a
  // broken (scroll-position-dependent) trigger. Fall back to the page so the
  // animation's start/end are computed from a stable, non-fixed element.
  if (element && element !== document.documentElement && isFixedPositioned(element)) {
    console.warn(
      '[Prysmal Prism] The scroll trigger element is position:fixed, which cannot anchor a scroll animation reliably (it jumps on resize/reload). Falling back to the page. For precise per-animation control, set the animation Trigger to "Custom" and point it at a normal (non-fixed) content section.'
    )
    return document.documentElement
  }
  return element || document.documentElement
}

function positionString(item, offset, viewport) {
  const amount = safeNumber(offset, 0)
  const sign = amount >= 0 ? '+=' : '-='
  return `${item}${sign}${Math.abs(amount)} ${viewport}`
}

function easingFor(sequence) {
  if (!sequence.easing || sequence.easing === 'none' || sequence.easing === 'linear') return 'none'
  const power = sequence.easingPower || 'power1'
  if (sequence.easing === 'in') return `${power}.in`
  if (sequence.easing === 'out') return `${power}.out`
  if (sequence.easing === 'inOut') return `${power}.inOut`
  return 'none'
}

function createTimeline(sequence, object, runtimeRef, hostElement, gsap, ScrollTrigger, markers = false) {
  if (!object || !gsap || !ScrollTrigger) return null
  const scroll = sequence.scroll || {}
  const trigger = resolveTrigger(sequence, hostElement)
  const start = positionString(scroll.itemStartPos || 'top', scroll.startOffset, scroll.windowStartPos || 'bottom')
  const end = positionString(scroll.itemEndPos || 'bottom', scroll.endOffset, scroll.windowEndPos || 'top')
  const scrub = safeNumber(scroll.scrub, 1)
  const id = `prysmal_${String(sequence.name || sequence.index || Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

  const existing = gsap.getById(id)
  if (existing) existing.revert?.()

  const timeline = gsap.timeline({
    id,
    defaults: { ease: easingFor(sequence) },
    scrollTrigger: {
      trigger,
      start,
      end,
      scrub: scrub > 0 ? scrub : false,
      pin: Boolean(scroll.pin),
      markers: Boolean(markers || scroll.showMarkers),
      invalidateOnRefresh: true,
    },
  })

  const target = sequence.to || {}
  if (target.position) timeline.to(object.position, { ...target.position }, 0)
  if (target.rotate) timeline.to(object.rotation, { ...target.rotate }, 0)
  if (target.scale) timeline.to(object.scale, { ...target.scale }, 0)
  // Light channel tweens the shared runtime value the frame loop reads.
  if (typeof target.light === 'number' && runtimeRef?.current) {
    timeline.to(runtimeRef.current, { light: target.light }, 0)
  }
  // Chromatic aberration is a 0..1 multiplier of the Elementor maximum.
  if (typeof target.chromaticAberration === 'number' && runtimeRef?.current) {
    timeline.to(runtimeRef.current, { chromaticAberration: target.chromaticAberration }, 0)
  }
  return timeline
}


/**
 * Production sequence runner.
 *
 * Older builds created one scrubbed GSAP timeline per JSON animation and let
 * every timeline write directly to the same rig.position / rotation / scale.
 * When scrolling quickly in reverse, two timelines could briefly disagree over
 * those properties, causing snapping and broken states after refresh/resize.
 *
 * This manager gives the prism ONE owner. ScrollTrigger only measures each
 * section's start/end. A single GSAP ticker converts the current scroll position
 * into one continuous playhead (0 -> N) and interpolates through explicit
 * states: initial -> animation 1 target -> animation 2 target -> ...
 */
function createSequenceManager(sequences, object, runtimeRef, hostElement, gsap, ScrollTrigger, markers = false) {
  if (!Array.isArray(sequences) || !sequences.length || !object || !gsap || !ScrollTrigger) return null

  const ordered = [...sequences].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))

  const initialState = {
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotate: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    light: runtimeRef?.current && typeof runtimeRef.current.light === 'number' ? runtimeRef.current.light : 1,
    chromaticAberration:
      runtimeRef?.current && typeof runtimeRef.current.chromaticAberration === 'number'
        ? runtimeRef.current.chromaticAberration
        : 0,
  }

  const states = [initialState]
  ordered.forEach((sequence) => {
    const previous = states[states.length - 1]
    const target = sequence.to || {}
    const position = target.position || {}
    const rotate = target.rotate || target.rotation || {}
    const scale = target.scale || {}

    states.push({
      position: {
        x: safeNumber(position.x, previous.position.x),
        y: safeNumber(position.y, previous.position.y),
        z: safeNumber(position.z, previous.position.z),
      },
      rotate: {
        x: safeNumber(rotate.x, previous.rotate.x),
        y: safeNumber(rotate.y, previous.rotate.y),
        z: safeNumber(rotate.z, previous.rotate.z),
      },
      scale: {
        x: safeNumber(scale.x, previous.scale.x),
        y: safeNumber(scale.y, previous.scale.y),
        z: safeNumber(scale.z, previous.scale.z),
      },
      light: typeof target.light === 'number' ? target.light : previous.light,
      chromaticAberration:
        typeof target.chromaticAberration === 'number'
          ? target.chromaticAberration
          : previous.chromaticAberration,
    })
  })

  const eases = ordered.map((sequence) => {
    const easeName = easingFor(sequence)
    try {
      return typeof gsap.parseEase === 'function' ? gsap.parseEase(easeName) : (value) => value
    } catch {
      return (value) => value
    }
  })

  const entries = []
  ordered.forEach((sequence, index) => {
    const scroll = sequence.scroll || {}
    const trigger = resolveTrigger(sequence, hostElement)
    const start = positionString(scroll.itemStartPos || 'top', scroll.startOffset, scroll.windowStartPos || 'bottom')
    const end = positionString(scroll.itemEndPos || 'bottom', scroll.endOffset, scroll.windowEndPos || 'top')
    const id = `prysmal_seq_${String(sequence.name || sequence.index || index).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

    const existing = ScrollTrigger.getById?.(id)
    existing?.kill?.()

    const triggerInstance = ScrollTrigger.create({
      id,
      trigger,
      start,
      end,
      pin: Boolean(scroll.pin),
      markers: Boolean(markers || scroll.showMarkers),
      invalidateOnRefresh: true,
    })

    entries.push({ trigger: triggerInstance, animation: sequence })
  })

  let targetPlayhead = 0
  let currentPlayhead = 0
  let initialized = false

  const clamp01 = (value) => Math.min(1, Math.max(0, value))
  const mix = (a, b, t) => a + (b - a) * t

  const readTargetPlayhead = () => {
    if (!entries.length) return 0
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0

    for (let index = 0; index < entries.length; index += 1) {
      const trigger = entries[index].trigger
      const start = Number(trigger.start) || 0
      const end = Number(trigger.end) || start + 1

      if (scrollY < start) return index
      if (scrollY <= end) {
        const span = Math.max(1, end - start)
        return index + clamp01((scrollY - start) / span)
      }
    }

    return entries.length
  }

  const applyPlayhead = (playhead) => {
    const bounded = Math.max(0, Math.min(ordered.length, playhead))
    let index = Math.floor(bounded)
    let localProgress = bounded - index

    if (index >= ordered.length) {
      index = ordered.length - 1
      localProgress = 1
    }

    const from = states[index]
    const to = states[index + 1]
    const eased = eases[index] ? eases[index](clamp01(localProgress)) : clamp01(localProgress)

    object.position.set(
      mix(from.position.x, to.position.x, eased),
      mix(from.position.y, to.position.y, eased),
      mix(from.position.z, to.position.z, eased)
    )
    object.rotation.set(
      mix(from.rotate.x, to.rotate.x, eased),
      mix(from.rotate.y, to.rotate.y, eased),
      mix(from.rotate.z, to.rotate.z, eased)
    )
    object.scale.set(
      mix(from.scale.x, to.scale.x, eased),
      mix(from.scale.y, to.scale.y, eased),
      mix(from.scale.z, to.scale.z, eased)
    )

    if (runtimeRef?.current) {
      runtimeRef.current.light = mix(from.light, to.light, eased)
      runtimeRef.current.chromaticAberration = mix(
        from.chromaticAberration,
        to.chromaticAberration,
        eased
      )
    }
  }

  const scrubForPlayhead = (playhead) => {
    const bounded = Math.max(0, Math.min(ordered.length - 0.000001, playhead))
    const index = Math.max(0, Math.min(ordered.length - 1, Math.floor(bounded)))
    const scroll = ordered[index]?.scroll || {}
    return Math.max(0, safeNumber(scroll.scrub, 1))
  }

  const tick = () => {
    const nextTarget = readTargetPlayhead()

    if (!initialized) {
      targetPlayhead = nextTarget
      currentPlayhead = nextTarget
      initialized = true
      applyPlayhead(currentPlayhead)
      return
    }

    targetPlayhead = nextTarget
    const scrub = scrubForPlayhead(targetPlayhead)
    const delta = Math.min(0.05, Math.max(0.001, gsap.ticker?.deltaRatio ? gsap.ticker.deltaRatio(60) / 60 : 1 / 60))

    if (scrub <= 0) {
      currentPlayhead = targetPlayhead
    } else {
      // Reach 99% of the target over approximately `scrub` seconds.
      const alpha = 1 - Math.exp((-4.605170186 * delta) / scrub)
      currentPlayhead += (targetPlayhead - currentPlayhead) * alpha
      if (Math.abs(targetPlayhead - currentPlayhead) < 0.00001) currentPlayhead = targetPlayhead
    }

    applyPlayhead(currentPlayhead)
  }

  gsap.ticker.add(tick)
  tick()

  return {
    revert: () => {
      gsap.ticker.remove(tick)
      entries.forEach(({ trigger }) => trigger?.kill?.())
    },
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (error) {
    console.error('[Prysmal Prism] Clipboard copy failed:', error)
    return false
  }
}

let editPanelCount = 0

/**
 * Edit Mode panel, styled after Atom-RND's "Tune atmosphere" drawer. Built with
 * plain DOM because this component renders inside the R3F canvas, where
 * react-dom elements can't be returned.
 */
function createEditPanel(host, groups, buttons) {
  const uid = `prysmal-edit-${++editPanelCount}`
  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  const root = el('div', 'prysmal-edit')
  const toggle = el('button', 'prysmal-edit-toggle')
  toggle.type = 'button'
  toggle.setAttribute('aria-controls', uid)
  const panel = el('aside', 'prysmal-edit-panel')
  panel.id = uid
  panel.setAttribute('aria-label', 'Prism settings')

  const syncers = []
  const sync = () => syncers.forEach((fn) => fn())
  const setOpen = (open) => {
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.replaceChildren('Tune atmosphere ', el('span', '', open ? '−' : '＋'))
    if (open) sync()
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden))

  groups.forEach(({ title, sliders }, groupIndex) => {
    if (!sliders.length) return
    const heading = el('div', groupIndex ? 'prysmal-edit-heading prysmal-edit-subheading' : 'prysmal-edit-heading')
    heading.append(el('h2', '', title))
    if (!panel.childElementCount) {
      const close = el('button', '', '×')
      close.type = 'button'
      close.setAttribute('aria-label', 'Close settings')
      close.addEventListener('click', () => setOpen(false))
      heading.append(close)
    }
    panel.append(heading)

    sliders.forEach(({ label, obj, key, min, max, step, unit = '' }, i) => {
      const id = `${uid}-${groupIndex}-${i}`
      const labelEl = el('label', '', label)
      labelEl.htmlFor = id
      const output = el('output')
      labelEl.append(output)
      const input = el('input')
      Object.assign(input, { type: 'range', id, min, max, step })
      const show = () => (output.textContent = `${Number(obj[key]).toFixed(2)}${unit}`)
      input.addEventListener('input', () => {
        obj[key] = Number(input.value)
        show()
      })
      syncers.push(() => {
        input.value = obj[key]
        show()
      })
      panel.append(labelEl, input)
    })
  })

  buttons.forEach(({ label, onClick }) => {
    const button = el('button', 'prysmal-edit-btn', label)
    button.type = 'button'
    button.addEventListener('click', () => {
      onClick()
      sync()
    })
    panel.append(button)
  })

  const onKey = (e) => {
    if (e.key === 'Escape') setOpen(false)
  }
  window.addEventListener('keydown', onKey)

  root.append(toggle, panel)
  host.append(root)
  setOpen(false)

  return {
    destroy: () => {
      window.removeEventListener('keydown', onKey)
      root.remove()
    },
  }
}

export function PrismControls({
  hostElement,
  rigRef,
  runtimeRef,
  camera,
  rainbowRef,
  controls,
  customJSON,
  sequenceJSON,
  editMode = false,
  sequenceBuilder = false,
  scrollSequence = false,
}) {
  useEffect(() => {
    const rig = rigRef.current
    if (!rig || !hostElement) return

    // `let` (not destructured const) so the readiness poll below can reassign
    // these; every closure references the same bindings and sees the updates.
    let { gsap, ScrollTrigger } = getGsapRuntime()
    let gsapPollId = null

    // Coalesce ScrollTrigger.refresh() calls. Refreshing synchronously once per
    // sequence during creation can bake start/end BEFORE layout settles (the
    // fixed-background relocation, fonts, images), which is another way the
    // initial state ends up measured wrong. Defer to the next frame and merge
    // all the load-time refreshes into a single one.
    let refreshRaf = null
    const scheduleRefresh = () => {
      if (!ScrollTrigger) return
      if (refreshRaf) cancelAnimationFrame(refreshRaf)
      refreshRaf = requestAnimationFrame(() => {
        refreshRaf = null
        ScrollTrigger.refresh()
      })
    }
    // Re-measure once the page has fully loaded — late images/fonts can shift
    // section offsets after the first refresh.
    if (typeof window !== 'undefined') window.addEventListener('load', scheduleRefresh)

    if (customJSON?.objectTransform) applyTransform(rig, customJSON.objectTransform)
    if (customJSON?.camera?.position && camera) {
      const p = customJSON.camera.position
      camera.position.set(
        safeNumber(p.x, camera.position.x),
        safeNumber(p.y, camera.position.y),
        safeNumber(p.z, camera.position.z)
      )
      camera.updateProjectionMatrix()
    }

    const timelines = []
    const storedSequences = Array.isArray(sequenceJSON)
      ? clone(sequenceJSON)
      : sequenceJSON && typeof sequenceJSON === 'object'
        ? Object.values(clone(sequenceJSON))
        : []

    const initializeSequence = (sequence, showMarkers = false) => {
      if (!gsap || !ScrollTrigger) {
        // Re-check in case the theme registered GSAP after this widget mounted.
        const r = getGsapRuntime()
        gsap = r.gsap
        ScrollTrigger = r.ScrollTrigger
      }
      if (!gsap || !ScrollTrigger) {
        console.warn('[Prysmal Prism] Theme GSAP/ScrollTrigger is not available yet; scroll sequence was skipped.')
        return
      }
      const timeline = createTimeline(sequence, rig, runtimeRef, hostElement, gsap, ScrollTrigger, showMarkers)
      if (timeline) timelines.push(timeline)
      scheduleRefresh()
    }

    const runStoredSequences = () => {
      const manager = createSequenceManager(storedSequences, rig, runtimeRef, hostElement, gsap, ScrollTrigger, false)
      if (manager) timelines.push(manager)
      scheduleRefresh()
    }

    if (scrollSequence && !sequenceBuilder) {
      if (gsap && ScrollTrigger) {
        runStoredSequences()
      } else {
        // The theme frequently registers GSAP + ScrollTrigger AFTER this widget
        // mounts (its own init hook, deferred scripts, etc.). Reading the
        // runtime only once at mount then silently skipping is what left the
        // beam stuck at full light with no scroll fade. Poll briefly instead.
        let waited = 0
        const tick = () => {
          const r = getGsapRuntime()
          gsap = r.gsap
          ScrollTrigger = r.ScrollTrigger
          if (gsap && ScrollTrigger) {
            runStoredSequences()
            return
          }
          waited += 200
          if (waited >= 8000) {
            console.warn(
              '[Prysmal Prism] Theme GSAP/ScrollTrigger not found after 8s; scroll sequence skipped. Ensure the theme loads GSAP + ScrollTrigger globally.'
            )
            return
          }
          gsapPollId = setTimeout(tick, 200)
        }
        gsapPollId = setTimeout(tick, 200)
      }
    }

    let gui = null

    let editPanel = null

    if (editMode && !sequenceBuilder) {
      const initialControls = controls ? { ...controls } : null
      const groups = [
        {
          title: 'Atmosphere',
          sliders: controls
            ? [
                { label: 'Rainbow', obj: controls, key: 'rainbowIntensity', min: 0, max: 10, step: 0.05, unit: '×' },
                { label: 'White light', obj: controls, key: 'whiteLightIntensity', min: 0, max: 3, step: 0.05, unit: '×' },
                { label: 'Vapor band', obj: controls, key: 'vortexIntensity', min: 0, max: 2, step: 0.05, unit: '×' },
                { label: 'Dispersion', obj: controls, key: 'vortexDispersion', min: 0, max: 5, step: 0.05, unit: '×' },
                { label: 'Bokeh', obj: controls, key: 'bokehIntensity', min: 0, max: 2, step: 0.05, unit: '×' },
                { label: 'Particle glow', obj: controls, key: 'particleIntensity', min: 0, max: 2, step: 0.05, unit: '×' },
                { label: 'Bokeh L/R', obj: controls, key: 'bokehOffsetX', min: -400, max: 400, step: 5, unit: 'px' },
                { label: 'Reflection', obj: controls, key: 'reflectionIntensity', min: 0, max: 1.5, step: 0.05, unit: '×' },
              ]
            : [],
        },
      ]

      const buttons = [
        {
          label: 'Reset',
          onClick: () => {
            if (initialControls) Object.assign(controls, initialControls)
          },
        },
      ]

      editPanel = createEditPanel(hostElement, groups, buttons)
    }

    if (editMode && sequenceBuilder) {
      gui = new GUI({ title: 'Prysmal Prism — Scroll Sequence', container: hostElement, width: 360 })
      gui.domElement.classList.add('prysmal-prism-gui', 'prysmal-prism-sequence-gui')
      const animationsFolder = gui.addFolder('Animations')
      let sequences = storedSequences
      let counter = sequences.reduce((max, sequence) => Math.max(max, Number(sequence.index) || 0), 0)

      const addAnimationFolder = (sequenceData = null) => {
        counter += 1
        const sequence = sequenceData || sequenceDefaults(counter, rig, runtimeRef)
        if (!sequence.index) sequence.index = counter
        if (!sequenceData) sequences.push(sequence)

        const folder = animationsFolder.addFolder(sequence.name || `Animation ${sequence.index}`)
        const nameController = folder.add(sequence, 'name').name('Name').onChange((value) => folder.title(value))
        nameController.listen()

        const scroll = (sequence.scroll ||= sequenceDefaults(sequence.index, rig, runtimeRef).scroll)
        folder.add(scroll, 'trigger', ['canvas', 'page', 'custom']).name('Trigger')
        folder.add(scroll, 'triggerElement').name('Custom Selector')
        folder.add(scroll, 'itemStartPos', ['top', 'center', 'bottom']).name('Item Start')
        folder.add(scroll, 'windowStartPos', ['top', 'center', 'bottom']).name('Window Start')
        folder.add(scroll, 'startOffset', -3000, 3000, 1).name('Start Offset')
        folder.add(scroll, 'itemEndPos', ['top', 'center', 'bottom']).name('Item End')
        folder.add(scroll, 'windowEndPos', ['top', 'center', 'bottom']).name('Window End')
        folder.add(scroll, 'endOffset', -3000, 3000, 1).name('End Offset')
        folder.add(scroll, 'scrub', 0, 5, 0.05).name('Scrub')
        folder.add(scroll, 'pin').name('Pin')

        const easingFolder = folder.addFolder('Easing')
        easingFolder.add(sequence, 'easing', ['none', 'in', 'out', 'inOut']).name('Easing')
        easingFolder.add(sequence, 'easingPower', ['power1', 'power2', 'power3', 'power4', 'sine', 'expo']).name('Power')

        // Backfill any missing sub-objects. Stored JSON often omits channels it
        // doesn't animate (e.g. an animation that only sets position + light and
        // no scale). lil-gui's .add(obj, 'x') reads obj.x, so a missing
        // position/rotate/scale object would throw "Cannot read properties of
        // undefined (reading 'x')" and crash the whole render when Edit Mode is
        // turned on. Merge against defaults so every channel is always present.
        const targetDefaults = sequenceDefaults(sequence.index, rig, runtimeRef).to
        const target = (sequence.to ||= {})
        target.position ||= { ...targetDefaults.position }
        // Accept legacy `rotation` key as an alias for `rotate`.
        target.rotate ||= target.rotation || { ...targetDefaults.rotate }
        delete target.rotation
        target.scale ||= { ...targetDefaults.scale }
        for (const axis of ['x', 'y', 'z']) {
          target.position[axis] = safeNumber(target.position[axis], targetDefaults.position[axis])
          target.rotate[axis] = safeNumber(target.rotate[axis], targetDefaults.rotate[axis])
          target.scale[axis] = safeNumber(target.scale[axis], targetDefaults.scale[axis])
        }
        if (typeof target.light !== 'number') target.light = 1
        if (typeof target.chromaticAberration !== 'number') {
          target.chromaticAberration = targetDefaults.chromaticAberration
        }
        const position = folder.addFolder('Target Position')
        position.add(target.position, 'x', -30, 30, 0.01)
        position.add(target.position, 'y', -30, 30, 0.01)
        position.add(target.position, 'z', -30, 30, 0.01)
        const rotation = folder.addFolder('Target Rotation')
        rotation.add(target.rotate, 'x', -Math.PI * 2, Math.PI * 2, 0.001)
        rotation.add(target.rotate, 'y', -Math.PI * 2, Math.PI * 2, 0.001)
        rotation.add(target.rotate, 'z', -Math.PI * 2, Math.PI * 2, 0.001)
        const scale = folder.addFolder('Target Scale')
        scale.add(target.scale, 'x', 0.01, 10, 0.01)
        scale.add(target.scale, 'y', 0.01, 10, 0.01)
        scale.add(target.scale, 'z', 0.01, 10, 0.01)
        const lightFolder = folder.addFolder('Target Light')
        lightFolder
          .add(target, 'light', 0, 1, 0.01)
          .name('Light Intensity')
          .onChange((value) => {
            if (runtimeRef?.current) runtimeRef.current.light = value
          })

        const caFolder = folder.addFolder('Target Chromatic Aberration')
        caFolder
          .add(target, 'chromaticAberration', 0, 1, 0.01)
          .name('CA Amount')
          .onChange((value) => {
            if (runtimeRef?.current) runtimeRef.current.chromaticAberration = value
          })

        const actions = {
          previewTarget: () => {
            applyTransform(rig, target)
            if (typeof target.light === 'number' && runtimeRef?.current) runtimeRef.current.light = target.light
            if (typeof target.chromaticAberration === 'number' && runtimeRef?.current) {
              runtimeRef.current.chromaticAberration = target.chromaticAberration
            }
          },
          initialize: () => initializeSequence(sequence, true),
          duplicate: () => {
            const copy = clone(sequence)
            copy.index = ++counter
            copy.name = `${sequence.name} Copy ${copy.index}`
            sequences.push(copy)
            addAnimationFolder(copy)
          },
          remove: () => {
            sequences = sequences.filter((item) => item !== sequence)
            const timeline = gsap?.getById(`prysmal_${String(sequence.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)
            timeline?.revert?.()
            folder.destroy()
          },
        }

        folder.add(actions, 'previewTarget').name('Preview Target')
        folder.add(actions, 'initialize').name('Initialize')
        folder.add(actions, 'duplicate').name('Duplicate')
        folder.add(actions, 'remove').name('Remove')
      }

      sequences.forEach((sequence) => addAnimationFolder(sequence))

      const masterActions = {
        addAnimation: () => addAnimationFolder(),
        copyAnimations: async () => copyText(JSON.stringify(sequences, null, 2)),
        refreshScroll: () => ScrollTrigger?.refresh?.(),
        resetLight: () => {
          if (runtimeRef?.current) runtimeRef.current.light = 1
        },
        resetChromaticAberration: () => {
          if (runtimeRef?.current) runtimeRef.current.chromaticAberration = 1
        },
      }
      gui.add(masterActions, 'addAnimation').name('+ Add Animation')
      gui.add(masterActions, 'copyAnimations').name('Copy Animations JSON')
      gui.add(masterActions, 'refreshScroll').name('Refresh Scroll')
      gui.add(masterActions, 'resetLight').name('Reset Light')
      gui.add(masterActions, 'resetChromaticAberration').name('Reset CA')
    }

    return () => {
      if (gsapPollId) clearTimeout(gsapPollId)
      if (refreshRaf) cancelAnimationFrame(refreshRaf)
      if (typeof window !== 'undefined') window.removeEventListener('load', scheduleRefresh)
      gui?.destroy()
      editPanel?.destroy()
      // Kill each timeline's OWN ScrollTrigger explicitly — with the page
      // fallback a trigger's element is documentElement, not the host, so the
      // hostElement-contains sweep below would no longer catch it and the old
      // trigger would leak across HMR/unmount.
      timelines.forEach((timeline) => {
        timeline?.scrollTrigger?.kill?.()
        timeline?.revert?.()
      })
      ScrollTrigger?.getAll?.().forEach((trigger) => {
        if (trigger.trigger === hostElement || hostElement.contains?.(trigger.trigger)) trigger.kill()
      })
      if (runtimeRef?.current) runtimeRef.current.light = 1
    }
  }, [hostElement, rigRef, runtimeRef, camera, rainbowRef, controls, customJSON, sequenceJSON, editMode, sequenceBuilder, scrollSequence])

  return null
}
