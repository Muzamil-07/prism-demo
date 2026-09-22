<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Prysmal_Prism_Renderer_Widget extends \Elementor\Widget_Base {

    public function get_name() {
        return 'prysmal_prism_renderer';
    }

    public function get_title() {
        return esc_html__( 'Prysmal Prism Renderer', 'zeyna-child' );
    }

    public function get_icon() {
        return 'eicon-cube';
    }

    public function get_categories() {
        return array( 'general' );
    }

    public function get_keywords() {
        return array( 'prysmal', 'prism', '3d', 'three', 'renderer', 'webgl' );
    }

    public function get_script_depends() {
        return array( 'prysmal-prism' );
    }

    public function get_style_depends() {
        return array( 'prysmal-prism' );
    }

    protected function register_controls() {

        /* ------------------------------------------------------------------ */
        /* Renderer                                                            */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_renderer',
            array(
                'label' => esc_html__( 'Prism Renderer', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_control(
            'notice',
            array(
                'type' => \Elementor\Controls_Manager::RAW_HTML,
                'raw'  => '<div class="elementor-panel-alert elementor-panel-alert-info">Prysmal Three.js prism effect. Enable Edit Mode on the front end to position the prism and copy scene JSON. Enable both Edit Mode and Scroll Sequence to build scroll animations visually (including the new Light Intensity channel).</div>',
            )
        );

        $this->add_responsive_control(
            'renderer_height',
            array(
                'label'      => esc_html__( 'Height', 'zeyna-child' ),
                'type'       => \Elementor\Controls_Manager::SLIDER,
                'size_units' => array( 'px', 'vh', 'rem' ),
                'range'      => array(
                    'px'  => array( 'min' => 300, 'max' => 1800 ),
                    'vh'  => array( 'min' => 30, 'max' => 150 ),
                    'rem' => array( 'min' => 20, 'max' => 100 ),
                ),
                'default'    => array(
                    'unit' => 'vh',
                    'size' => 100,
                ),
                'selectors'  => array(
                    '{{WRAPPER}} .prysmal-prism' => 'height: {{SIZE}}{{UNIT}}; min-height: 0;',
                ),
            )
        );

        $this->add_control(
            'display_mode',
            array(
                'label'       => esc_html__( 'Display Mode', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SELECT,
                'options'     => array(
                    'normal' => esc_html__( 'Normal (scrolls with section)', 'zeyna-child' ),
                    'fixed'  => esc_html__( 'Fixed background (stays visible on scroll)', 'zeyna-child' ),
                ),
                'default'     => 'normal',
                'description' => esc_html__( 'Fixed pins the prism to the viewport behind the page so it stays visible as you scroll. The sections that scroll over it must have transparent backgrounds, and the widget must not sit inside a transformed/animated container.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'edit_mode',
            array(
                'label'        => esc_html__( 'Edit Mode', 'zeyna-child' ),
                'type'         => \Elementor\Controls_Manager::SWITCHER,
                'label_on'     => esc_html__( 'Yes', 'zeyna-child' ),
                'label_off'    => esc_html__( 'No', 'zeyna-child' ),
                'return_value' => 'true',
                'default'      => '',
            )
        );

        $this->add_control(
            'scroll_sequence',
            array(
                'label'        => esc_html__( 'Scroll Sequence', 'zeyna-child' ),
                'type'         => \Elementor\Controls_Manager::SWITCHER,
                'label_on'     => esc_html__( 'Yes', 'zeyna-child' ),
                'label_off'    => esc_html__( 'No', 'zeyna-child' ),
                'return_value' => 'true',
                'default'      => '',
                'description'  => esc_html__( 'Reuses the theme global GSAP + ScrollTrigger to animate the prism (and beam light) on scroll.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'sequence_json',
            array(
                'label'       => esc_html__( 'Sequence JSON', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::CODE,
                'language'    => 'json',
                'rows'        => 12,
                'ai'          => false,
                'description' => esc_html__( 'Paste JSON copied from the front-end Scroll Sequence builder. Each animation can target position, rotation, scale, Light Intensity, and Chromatic Aberration Amount. CA Amount is a 0–1 multiplier of the Elementor Max Chromatic Aberration setting.', 'zeyna-child' ),
                'condition'   => array(
                    'scroll_sequence' => 'true',
                ),
            )
        );

        $this->add_control(
            'custom_json',
            array(
                'label'       => esc_html__( 'Scene JSON', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::CODE,
                'language'    => 'json',
                'rows'        => 12,
                'ai'          => false,
                'description' => esc_html__( 'Paste JSON copied from front-end Edit Mode.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'pointer_influence',
            array(
                'label'       => esc_html__( 'Pointer Influence', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.01 ),
                ),
                'default'     => array( 'size' => 1 ),
                'description' => esc_html__( '0 = no mouse influence. 1 = maximum subtle pointer influence; the beam remains cinematic and auto-aimed.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'intro_enabled',
            array(
                'label'        => esc_html__( 'Load-in Animation', 'zeyna-child' ),
                'type'         => \Elementor\Controls_Manager::SWITCHER,
                'label_on'     => esc_html__( 'On', 'zeyna-child' ),
                'label_off'    => esc_html__( 'Off', 'zeyna-child' ),
                'return_value' => 'true',
                'default'      => 'true',
                'description'  => esc_html__( 'Prism fades up, then the beam sweeps in, then the rainbow blooms when the scene first loads.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'intro_hold_selector',
            array(
                'label'       => esc_html__( 'Hold Until Preloader Cleared', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::TEXT,
                'default'     => '.first--load.loading',
                'placeholder' => '.first--load.loading',
                'condition'   => array( 'intro_enabled' => 'true' ),
                'description' => esc_html__( 'CSS selector matched against the <html> element. While it matches (e.g. your site preloader is showing), the load-in animation waits, then plays fresh the moment the class is removed. Leave empty to play immediately on load. If the selector never clears, the animation plays anyway after 15s.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'intro_hold_delay',
            array(
                'label'       => esc_html__( 'Delay After Preloader (ms)', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::NUMBER,
                'default'     => 0,
                'min'         => 0,
                'step'        => 50,
                'condition'   => array( 'intro_enabled' => 'true' ),
                'description' => esc_html__( 'Extra pause in milliseconds after the preloader class clears, before the load-in animation plays. Useful for lining the entrance up with the tail of a fade-out overlay. 0 = play immediately when the class is removed. Only applies when a Hold selector is set and matched.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'residual_color',
            array(
                'label'       => esc_html__( 'Scroll Residual Color', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.01 ),
                ),
                'default'     => array( 'size' => 0 ),
                'description' => esc_html__( 'When the Light Intensity channel scrolls to 0, this fraction of rainbow color keeps drifting in the glass after the beam is gone. 0 = the rainbow fades out completely with the beam.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'residual_illumination',
            array(
                'label'       => esc_html__( 'Scroll Residual Illumination', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.01 ),
                ),
                'default'     => array( 'size' => 0.7 ),
                'description' => esc_html__( 'When the Light Intensity channel scrolls to 0, the beam and flare fade out of view but the glass keeps refracting them internally at this brightness, so the prism retains its lovely coloured reflections as if the beam were still striking it. 0 = the prism goes dark with the beam.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'rainbow_residual',
            array(
                'label'       => esc_html__( 'Scroll Rainbow Residual', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 4, 'step' => 0.05 ),
                ),
                'default'     => array( 'size' => 0 ),
                'description' => esc_html__( 'Like Scroll Residual Illumination, but for the RAINBOW instead of the white beam. Keeps the rainbow\'s refracted colour on the prism\'s faces (the nice left-face reflections) even when the rainbow intensity fades to 0 on scroll-out. Only the glass\'s internal view of the rainbow is floored, so no visible rainbow beam appears. Uses Scroll Residual Scale Compensation so the reflections also survive the prism scaling up. 0 = off (reflections fade out with the beam).', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'residual_scale_comp',
            array(
                'label'       => esc_html__( 'Residual Scale Compensation', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 4, 'step' => 0.05 ),
                ),
                'default'     => array( 'size' => 0 ),
                'description' => esc_html__( 'A larger prism spreads the fixed-size internal residual light thinner, so the on-prism colour reads dimmer as the sequencer scales it up. This automatically brightens the residual in proportion to the prism\'s live scale (Prism Size x the sequencer\'s animated Scale). 0 = off (no compensation); raise it to keep the residual reflections full while the prism grows.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'mouse_rotate_heading',
            array(
                'type' => \Elementor\Controls_Manager::RAW_HTML,
                'raw'  => '<strong>Mouse-move rotation</strong> &mdash; subtly turns the prism toward the cursor. Applied on its own layer so it never fights the scroll sequencer&rsquo;s animation.',
            )
        );

        $this->add_control(
            'mouse_rotate_strength',
            array(
                'label'       => esc_html__( 'Mouse Rotate Strength (rad)', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => -0.4, 'max' => 0.4, 'step' => 0.01 ),
                ),
                'default'     => array( 'size' => 0 ),
                'description' => esc_html__( 'Maximum deflection in radians as the cursor moves left/right. 0 = off. Negative values flip the direction.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'mouse_rotate_damping',
            array(
                'label'       => esc_html__( 'Mouse Rotate Easing', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0.01, 'max' => 0.2, 'step' => 0.01 ),
                ),
                'default'     => array( 'size' => 0.06 ),
                'description' => esc_html__( 'How quickly the prism follows the cursor. Lower = smoother/laggier, higher = snappier.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'mouse_rotate_gate',
            array(
                'label'       => esc_html__( 'Mouse Rotate Gate', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.05 ),
                ),
                'default'     => array( 'size' => 1 ),
                'description' => esc_html__( '1 = the rotation only activates once the beam has faded on scroll (so it never disturbs how the beam refracts). 0 = always active. Values in between blend the two.', 'zeyna-child' ),
            )
        );

        $this->add_control(
            'mouse_rotate_vertical',
            array(
                'label'       => esc_html__( 'Mouse Rotate Vertical Tilt', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array(
                    'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.05 ),
                ),
                'default'     => array( 'size' => 0 ),
                'description' => esc_html__( 'Adds an up/down nod driven by vertical cursor movement on top of the horizontal turn. 0 = horizontal only.', 'zeyna-child' ),
            )
        );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* Glass                                                               */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_glass',
            array(
                'label' => esc_html__( 'Glass', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_control(
            'prism_size',
            array(
                'label'       => esc_html__( 'Prism Size', 'zeyna-child' ),
                'type'        => \Elementor\Controls_Manager::SLIDER,
                'range'       => array( 'px' => array( 'min' => 0.25, 'max' => 3, 'step' => 0.05 ) ),
                'default'     => array( 'size' => 1 ),
                'description' => esc_html__( 'Scales the whole prism rig while keeping the beam entry and hidden rainbow origin attached.', 'zeyna-child' ),
            )
        );

        $this->add_slider( 'anisotropic_blur', 'Anisotropic Blur (grain)', 0, 2, 0.05, 0.1 );
        $this->add_slider( 'chromatic_aberration', 'Max Chromatic Aberration', 0, 1, 0.01, 0.65 );
        $this->add_slider( 'thickness', 'Thickness', 0, 3, 0.05, 1.2 );
        $this->add_slider( 'distortion', 'Distortion', 0, 1, 0.01, 0.35 );
        $this->add_slider( 'distortion_scale', 'Distortion Scale', 0, 1, 0.01, 0.4 );
        $this->add_slider( 'temporal_distortion', 'Temporal Distortion', 0, 1, 0.01, 0.1 );
        $this->add_slider( 'ior', 'IOR', 1, 2.5, 0.01, 1.5 );
        $this->add_slider( 'reflectivity', 'Reflectivity', 0, 1, 0.01, 0.4 );
        $this->add_slider( 'roughness', 'Roughness (streak softness)', 0, 0.5, 0.01, 0.25 );
        $this->add_slider( 'samples', 'Samples (quality)', 1, 32, 1, 6 );
        $this->add_slider( 'resolution', 'Resolution (quality)', 256, 2048, 256, 512 );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* Rainbow                                                             */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_rainbow',
            array(
                'label' => esc_html__( 'Rainbow', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_slider( 'exit_x', 'Exit X', -1, 1, 0.01, 0.08 );
        $this->add_slider( 'exit_y', 'Exit Y', -1, 1, 0.01, 0.0 );
        $this->add_slider( 'exit_z', 'Exit Z (depth)', -1, 1, 0.01, -0.25 );
        $this->add_slider( 'rainbow_angle', 'Angle (deg)', -45, 45, 0.5, 7 );
        $this->add_slider( 'rainbow_end_radius', 'End Radius', 0.1, 1.5, 0.01, 0.62 );
        $this->add_slider( 'rainbow_fade', 'Fade', 0, 1, 0.01, 0.12 );
        $this->add_slider( 'rainbow_intensity', 'Intensity', 0, 8, 0.05, 3.15 );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* White Light                                                         */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_white_light',
            array(
                'label' => esc_html__( 'White Light', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_control(
            'white_light_notice',
            array(
                'type' => \Elementor\Controls_Manager::RAW_HTML,
                'raw'  => 'Master brightness for the incoming white beam &mdash; its streak, soft glow, and flare dot together. On scroll, the sequencer&rsquo;s Light Intensity channel fades this to 0 (the rainbow follows down to the Scroll Residual Color floor).',
            )
        );

        $this->add_slider( 'white_light_intensity', 'White Light Intensity', 0, 3, 0.05, 1 );
        $this->add_slider( 'white_beam_angle', 'White Beam Angle (deg)', -10, 10, 0.1, 1.5 );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* Bloom                                                               */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_bloom',
            array(
                'label' => esc_html__( 'Bloom', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_slider( 'bloom_intensity', 'Intensity', 0, 4, 0.05, 1 );
        $this->add_slider( 'bloom_threshold', 'Threshold', 0, 2, 0.05, 1 );
        $this->add_slider( 'bloom_radius', 'Radius', 0, 1, 0.01, 0.45 );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* Atmosphere                                                          */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_atmosphere',
            array(
                'label' => esc_html__( 'Atmosphere', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
            )
        );

        $this->add_control(
            'atmosphere_notice',
            array(
                'type' => \Elementor\Controls_Manager::RAW_HTML,
                'raw'  => 'The vapor band behind the prism (twisting from the top of frame, tracking the prism\'s lower corner) and the drifting bokeh dots. 0 disables a layer entirely.',
            )
        );

        $this->add_slider( 'vortex_intensity', 'Vapor Band Intensity', 0, 2, 0.05, 0.5 );
        $this->add_slider( 'bokeh_intensity', 'Bokeh Intensity', 0, 2, 0.05, 0.3 );

        $this->end_controls_section();

        /* ------------------------------------------------------------------ */
        /* Style                                                               */
        /* ------------------------------------------------------------------ */
        $this->start_controls_section(
            'section_style',
            array(
                'label' => esc_html__( 'Renderer', 'zeyna-child' ),
                'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
            )
        );

        $this->add_control(
            'background_color',
            array(
                'label'     => esc_html__( 'Background', 'zeyna-child' ),
                'type'      => \Elementor\Controls_Manager::COLOR,
                'default'   => '#000000',
                'selectors' => array(
                    '{{WRAPPER}} .prysmal-prism' => 'background-color: {{VALUE}};',
                ),
            )
        );

        $this->end_controls_section();
    }

    /**
     * Small helper so the many numeric renderer controls stay declarative and
     * consistent. Each maps to a Three.js scene parameter read at runtime.
     */
    private function add_slider( $id, $label, $min, $max, $step, $default ) {
        $this->add_control(
            $id,
            array(
                'label'   => esc_html__( $label, 'zeyna-child' ),
                'type'    => \Elementor\Controls_Manager::SLIDER,
                'range'   => array(
                    'px' => array( 'min' => $min, 'max' => $max, 'step' => $step ),
                ),
                'default' => array( 'size' => $default ),
            )
        );
    }

    private function slider_value( $settings, $key, $default ) {
        return isset( $settings[ $key ]['size'] ) && '' !== $settings[ $key ]['size']
            ? (float) $settings[ $key ]['size']
            : $default;
    }

    protected function render() {
        $settings = $this->get_settings_for_display();

        $assets_url      = trailingslashit( get_stylesheet_directory_uri() . '/assets/prysmal-prism/dist' );
        $edit_mode       = isset( $settings['edit_mode'] ) && 'true' === $settings['edit_mode'];
        $scroll_sequence = isset( $settings['scroll_sequence'] ) && 'true' === $settings['scroll_sequence'];

        $renderer_settings = array(
            // Modes
            'editMode'        => $edit_mode,
            'scrollSequence'  => $scroll_sequence,
            'sequenceBuilder' => $edit_mode && $scroll_sequence,

            // Behavior
            'pointerInfluence' => $this->slider_value( $settings, 'pointer_influence', 1 ),
            'introEnabled'     => ! isset( $settings['intro_enabled'] ) || 'true' === $settings['intro_enabled'],
            'introHoldSelector' => isset( $settings['intro_hold_selector'] ) ? $settings['intro_hold_selector'] : '.first--load.loading',
            'introHoldDelay'   => isset( $settings['intro_hold_delay'] ) ? (int) $settings['intro_hold_delay'] : 0,
            'residualColor'    => $this->slider_value( $settings, 'residual_color', 0 ),
            'residualIllumination' => $this->slider_value( $settings, 'residual_illumination', 0.7 ),
            'residualScaleComp' => $this->slider_value( $settings, 'residual_scale_comp', 0 ),
            'mouseRotateStrength' => $this->slider_value( $settings, 'mouse_rotate_strength', 0 ),
            'mouseRotateDamping'  => $this->slider_value( $settings, 'mouse_rotate_damping', 0.06 ),
            'mouseRotateGate'     => $this->slider_value( $settings, 'mouse_rotate_gate', 1 ),
            'mouseRotateVertical' => $this->slider_value( $settings, 'mouse_rotate_vertical', 0 ),
            'prismSize'        => $this->slider_value( $settings, 'prism_size', 1 ),
            'whiteBeamAngle'   => $this->slider_value( $settings, 'white_beam_angle', 1.5 ),
            'whiteLightIntensity' => $this->slider_value( $settings, 'white_light_intensity', 1 ),

            // Glass (MeshTransmissionMaterial)
            'anisotropicBlur'    => $this->slider_value( $settings, 'anisotropic_blur', 0.1 ),
            'chromaticAberration' => $this->slider_value( $settings, 'chromatic_aberration', 0.65 ),
            'thickness'          => $this->slider_value( $settings, 'thickness', 1.2 ),
            'distortion'         => $this->slider_value( $settings, 'distortion', 0.35 ),
            'distortionScale'    => $this->slider_value( $settings, 'distortion_scale', 0.4 ),
            'temporalDistortion' => $this->slider_value( $settings, 'temporal_distortion', 0.1 ),
            'ior'                => $this->slider_value( $settings, 'ior', 1.5 ),
            'reflectivity'       => $this->slider_value( $settings, 'reflectivity', 0.4 ),
            'roughness'          => $this->slider_value( $settings, 'roughness', 0.25 ),
            'samples'            => (int) $this->slider_value( $settings, 'samples', 6 ),
            'resolution'         => (int) $this->slider_value( $settings, 'resolution', 512 ),

            // Rainbow / composition
            'exitX'            => $this->slider_value( $settings, 'exit_x', 0.08 ),
            'exitY'            => $this->slider_value( $settings, 'exit_y', 0.0 ),
            'exitZ'            => $this->slider_value( $settings, 'exit_z', -0.25 ),
            'rainbowAngle'     => $this->slider_value( $settings, 'rainbow_angle', 7 ),
            'rainbowEndRadius' => $this->slider_value( $settings, 'rainbow_end_radius', 0.62 ),
            'rainbowFade'      => $this->slider_value( $settings, 'rainbow_fade', 0.12 ),
            'rainbowIntensity' => $this->slider_value( $settings, 'rainbow_intensity', 3.15 ),
            'rainbowResidual'  => $this->slider_value( $settings, 'rainbow_residual', 0 ),

            // Bloom
            'bloomIntensity' => $this->slider_value( $settings, 'bloom_intensity', 1.0 ),
            'bloomThreshold' => $this->slider_value( $settings, 'bloom_threshold', 1.0 ),
            'bloomRadius'    => $this->slider_value( $settings, 'bloom_radius', 0.45 ),

            // Atmosphere
            'vortexIntensity' => $this->slider_value( $settings, 'vortex_intensity', 0.5 ),
            'bokehIntensity'  => $this->slider_value( $settings, 'bokeh_intensity', 0.3 ),

            // Style
            'backgroundColor' => ! empty( $settings['background_color'] ) ? $settings['background_color'] : '#000000',
        );

        $custom_json   = ! empty( $settings['custom_json'] ) ? $settings['custom_json'] : '';
        $sequence_json = ! empty( $settings['sequence_json'] ) ? $settings['sequence_json'] : '';

        $display_mode    = isset( $settings['display_mode'] ) ? $settings['display_mode'] : 'normal';
        $container_class = 'prysmal-prism';
        if ( 'fixed' === $display_mode ) {
            $container_class .= ' prysmal-prism--fixed';
        }
        ?>
        <div
            class="<?php echo esc_attr( $container_class ); ?>"
            data-assets-url="<?php echo esc_url( $assets_url ); ?>"
            data-settings="<?php echo esc_attr( wp_json_encode( $renderer_settings ) ); ?>"
            data-custom-json="<?php echo esc_attr( $custom_json ); ?>"
            data-scroll-sequence="<?php echo esc_attr( $sequence_json ); ?>"
            aria-label="<?php echo esc_attr__( 'Interactive Prysmal prism visualization', 'zeyna-child' ); ?>"
        ></div>
        <?php
    }
}
