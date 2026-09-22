# Prysmal Prism — Elementor Widget

Self-contained Three.js prism renderer that reproduces the exact v0 preview effect
(`MeshTransmissionMaterial` glass, refracted rainbow, beam, bloom, LUT), plus a
load-in entrance animation and a scroll-driven Light Intensity channel.

## What's here

```
widget/
  src/                 React + R3F source (modern stack: three 0.185 / fiber 9 / drei 10)
  public/              prism.glb, LUT cube, beam/flare textures (bundled into dist)
  class-prysmal-prism-renderer-widget.php   Elementor widget (rewritten controls)
  index.html           local dev harness (loads GSAP from CDN to test scroll)
  vite.config.js       IIFE library build
```

## Build

```bash
cd prysmal-prism      # this folder
npm install
npm run build         # static site for Vercel / preview (dist/index.html)
npm run build:lib     # WordPress IIFE bundle (dist/prysmal-prism.js + .css)
```

`dist/` is fully self-contained — React, three, and drei are bundled inside.
The only global it relies on is the theme's `window.gsap` / `window.ScrollTrigger`,
which it reads (never bundles) so it will not replace the theme's copy or break
Lenis / preloader / cursor scripts.

## Upload

1. Copy the built assets AND the shipped scene assets to your child theme:
   ```
   wp-content/themes/<child-theme>/assets/prysmal-prism/dist/
     ├─ prysmal-prism.js
     ├─ prysmal-prism.css
     ├─ prism.glb
     ├─ DwlG-F-6800-STD.cube
     ├─ beam-streak.png
     ├─ beam-glow.jpeg
     └─ flare-dot.png
   ```
   (`vite build` copies everything from `public/` into `dist/`, so the whole
   `dist` folder is what you upload. The PHP points `data-assets-url` at this
   `dist` folder.)

2. Copy `class-prysmal-prism-renderer-widget.php` into your child theme (replacing
   the old one) and make sure it is required + registered as an Elementor widget
   (unchanged from before — same widget name `prysmal_prism_renderer`).

3. Register the `prysmal-prism` script/style handles in `functions.php` (same
   handles the widget's `get_script_depends` / `get_style_depends` already
   declare). If you already had this for the old widget, nothing changes:
   ```php
   add_action( 'wp_enqueue_scripts', function () {
       $base = get_stylesheet_directory_uri() . '/assets/prysmal-prism/dist';
       wp_register_script( 'prysmal-prism', $base . '/prysmal-prism.js', array(), '1.0.0', true );
       wp_register_style( 'prysmal-prism', $base . '/prysmal-prism.css', array(), '1.0.0' );
   } );
   ```

## Backend controls (Elementor)

- **Renderer**: Height, Edit Mode, Scroll Sequence, Sequence JSON, Scene JSON,
  Pointer Influence, Load-in Animation, Scroll Residual Color.
- **Glass / Rainbow / Bloom**: the same parameters as the v0 tuner, seeded to the
  exact tuned defaults.
- **Style**: Background color.

## Scroll animation (Edit Mode + Scroll Sequence)

Turn on both **Edit Mode** and **Scroll Sequence** on the front end to open the
visual builder. Each animation keyframes the prism's position / rotation / scale
**and** a new **Light Intensity** target:

- `1` = full beam and rainbow.
- `0` = beam fully faded out; only a residual amount of rainbow color (set by
  **Scroll Residual Color**) keeps drifting inside the glass.

Example: prism moves down and light fades to 0 as you scroll — the beam
disappears while soft moving color lingers in the crystal. Click **Copy
Animations JSON**, then paste it into the **Sequence JSON** field in Elementor.

Because it drives the theme's global GSAP + ScrollTrigger, it composes with your
existing scroll setup.

## Current source revision

This source tree includes the later runtime fixes that were previously applied directly to the compiled WordPress bundle:

- One centralized scroll-sequence manager instead of multiple timelines writing to the prism transform.
- Rainbow direction tracking freezes only when the scroll light is fully off and resumes as soon as light rises again.
- React Three Fiber uses demand rendering with a 60 FPS invalidation cap.
- EffectComposer native MSAA is disabled (`multisampling={0}`).
- SMAA is applied as the final post-processing pass after Bloom and LUT.
- Canvas DPR remains capped at 1.5.

Rebuild with `npm install && npm run build:lib`, then copy the generated `dist/` assets into the child theme.
