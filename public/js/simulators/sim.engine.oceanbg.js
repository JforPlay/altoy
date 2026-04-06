/**
 * sim.engine.oceanbg.js
 * Procedurally renders an animated ocean/sky background for simulation pages.
 * Generates SVG-based water layers at speeds derived from BattleConfig
 * (sky_layer, long_sea, mid_sea, close_sea). Layer positions are calculated
 * from game Y-coordinates so they align with ship formation zones.
 * Instantiated by sim.engine.common.js in the SimulationEngine constructor.
 */

export class OceanBackground {
    constructor(container, gameCoords = null) {
        this.container = container;

        // Ocean scene configuration from BattleConfig
        this.config = {
            diving_filter: { r: 0.03, g: 0.03, b: 0.23, a: 0.35 },
            sky_layer: { speed: 0.3 },
            close_sea: { speed: 4 },
            mid_sea: { speed: 2 },
            long_sea: { speed: 0.8 }
        };

        // Derive layer positions from game coordinates
        // Game Y-axis: higher = farther from camera (horizon at top, foreground at bottom)
        const area = gameCoords?.totalArea;
        if (area) {
            const fieldHeight = area.maxY - area.minY;
            // Ship formations span Z=38-78 in game; map to screen percentages
            // Screen top = maxY (horizon), screen bottom = minY (foreground)
            this.layers = {
                skyHeight: 3,                                                    // Thin horizon strip
                farWaterTop: 3,                                                  // Starts at horizon
                midWaterTop: Math.round(((area.maxY - 72) / fieldHeight) * 100), // Above top formation slot
                closeWaterTop: Math.round(((area.maxY - 52) / fieldHeight) * 100), // Mid-field
                foamTop: Math.round(((area.maxY - 40) / fieldHeight) * 100)      // Below bottom formation
            };
        } else {
            this.layers = { skyHeight: 4, farWaterTop: 4, midWaterTop: 30, closeWaterTop: 55, foamTop: 70 };
        }

        this.oceanContainer = null;
        this.init();
    }

    init() {
        // Remove existing ocean layers
        const existingLayers = this.container.querySelectorAll('.ocean-layer, .ocean-background');
        existingLayers.forEach(layer => layer.remove());

        // Create ocean container
        this.oceanContainer = document.createElement('div');
        this.oceanContainer.className = 'ocean-background';
        this.oceanContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        `;

        // Create layers
        this.createSkyLayer();
        this.createWaterGradient();
        this.createWaterLayers();
        this.createFoamLayer();

        // Add CSS animations
        this.addAnimationStyles();

        // Insert BEFORE the first child (or as first child if empty)
        if (this.container.firstChild) {
            this.container.insertBefore(this.oceanContainer, this.container.firstChild);
        } else {
            this.container.appendChild(this.oceanContainer);
        }

        console.log('Ocean background initialized');
    }

    createSkyLayer() {
        const { skyHeight } = this.layers;
        const skyLayer = document.createElement('div');
        skyLayer.className = 'ocean-layer sky-layer';
        skyLayer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: ${skyHeight}%;
            background: url('data:image/svg+xml;base64,${this.generateSkyGradient()}') repeat-x;
            background-size: 200% 100%;
            animation: skyScroll ${60 / this.config.sky_layer.speed}s linear infinite;
            filter: blur(0.5px);
            opacity: 0.95;
        `;
        this.oceanContainer.appendChild(skyLayer);
    }

    createWaterGradient() {
        const { skyHeight } = this.layers;
        const filter = this.config.diving_filter;
        const waterGradient = document.createElement('div');
        waterGradient.className = 'ocean-layer water-gradient';
        waterGradient.style.cssText = `
            position: absolute;
            top: ${skyHeight}%;
            left: 0;
            width: 100%;
            height: ${100 - skyHeight}%;
            background: linear-gradient(to bottom,
                rgba(${Math.floor(filter.r * 255)},
                     ${Math.floor(filter.g * 255)},
                     ${Math.floor(filter.b * 255)}, 0.15) 0%,
                rgba(${Math.floor(filter.r * 255)},
                     ${Math.floor(filter.g * 255)},
                     ${Math.floor(filter.b * 255)}, 0.35) 50%,
                rgba(${Math.floor(filter.r * 255)},
                     ${Math.floor(filter.g * 255)},
                     ${Math.floor(filter.b * 255)}, 0.55) 100%
            );
            pointer-events: none;
        `;
        this.oceanContainer.appendChild(waterGradient);
    }

    createWaterLayers() {
        const { farWaterTop, midWaterTop, closeWaterTop } = this.layers;

        // Far water (slowest, calmest) - starts right at horizon
        const farWater = document.createElement('div');
        farWater.className = 'ocean-layer far-water';
        farWater.style.cssText = `
            position: absolute;
            top: ${farWaterTop}%;
            left: 0;
            width: 100%;
            height: ${100 - farWaterTop}%;
            background: url('data:image/svg+xml;base64,${this.generateWaterPattern(0.25)}') repeat;
            background-size: 500px 500px;
            animation: waterScroll ${30 / this.config.long_sea.speed}s linear infinite;
            opacity: 0.3;
            filter: blur(4px);
        `;

        // Mid water - above top formation slots
        const midWater = document.createElement('div');
        midWater.className = 'ocean-layer mid-water';
        midWater.style.cssText = `
            position: absolute;
            top: ${midWaterTop}%;
            left: 0;
            width: 100%;
            height: ${100 - midWaterTop}%;
            background: url('data:image/svg+xml;base64,${this.generateWaterPattern(0.4)}') repeat;
            background-size: 350px 350px;
            animation: waterScroll ${20 / this.config.mid_sea.speed}s linear infinite;
            opacity: 0.4;
            filter: blur(2.5px);
        `;

        // Close water (gentle waves) - mid-field where ships are
        const closeWater = document.createElement('div');
        closeWater.className = 'ocean-layer close-water';
        closeWater.style.cssText = `
            position: absolute;
            top: ${closeWaterTop}%;
            left: 0;
            width: 100%;
            height: ${100 - closeWaterTop}%;
            background: url('data:image/svg+xml;base64,${this.generateWaterPattern(0.6)}') repeat;
            background-size: 250px 250px;
            animation: waterScroll ${15 / this.config.close_sea.speed}s linear infinite;
            opacity: 0.5;
            filter: blur(1.5px);
        `;

        this.oceanContainer.appendChild(farWater);
        this.oceanContainer.appendChild(midWater);
        this.oceanContainer.appendChild(closeWater);
    }

    createFoamLayer() {
        const { foamTop } = this.layers;
        const foamLayer = document.createElement('div');
        foamLayer.className = 'ocean-layer foam-layer';
        foamLayer.style.cssText = `
            position: absolute;
            top: ${foamTop}%;
            left: 0;
            width: 100%;
            height: ${100 - foamTop}%;
            background: url('data:image/svg+xml;base64,${this.generateFoamPattern()}') repeat-x;
            background-size: 800px 150px;
            animation: foamScroll ${12 / this.config.close_sea.speed}s linear infinite;
            opacity: 0.2;
            mix-blend-mode: screen;
        `;
        this.oceanContainer.appendChild(foamLayer);
    }

    generateSkyGradient() {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400">
                <defs>
                    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#87CEEB;stop-opacity:1" />
                        <stop offset="60%" style="stop-color:#B0E0E6;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#D4EFF5;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <rect width="1200" height="400" fill="url(#skyGrad)"/>
                <ellipse cx="150" cy="100" rx="70" ry="35" fill="white" opacity="0.75"/>
                <ellipse cx="500" cy="150" rx="90" ry="45" fill="white" opacity="0.65"/>
                <ellipse cx="850" cy="110" rx="80" ry="40" fill="white" opacity="0.7"/>
            </svg>
        `;
        return btoa(svg);
    }

    generateWaterPattern(brightness) {
        const color = Math.floor(120 + brightness * 135);
        const waveHeight = 5 + brightness * 8;
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">
                <defs>
                    <pattern id="wave${brightness}" x="0" y="0" width="150" height="150" patternUnits="userSpaceOnUse">
                        <path d="M0,75 Q37.5,${75 - waveHeight} 75,75 T150,75" 
                              stroke="rgba(${color},${color + 15},${color + 40},${brightness * 0.6})" 
                              fill="none" 
                              stroke-width="${0.8 + brightness * 0.4}"/>
                        <path d="M0,85 Q37.5,${85 - waveHeight * 0.7} 75,85 T150,85" 
                              stroke="rgba(${color - 15},${color},${color + 40},${brightness * 0.5})" 
                              fill="none" 
                              stroke-width="${0.5 + brightness * 0.3}"/>
                        <path d="M0,95 Q37.5,${95 - waveHeight * 0.5} 75,95 T150,95" 
                              stroke="rgba(${color - 10},${color + 5},${color + 45},${brightness * 0.4})" 
                              fill="none" 
                              stroke-width="${0.3 + brightness * 0.2}"/>
                    </pattern>
                </defs>
                <rect width="500" height="500" fill="url(#wave${brightness})"/>
            </svg>
        `;
        return btoa(svg);
    }

    generateFoamPattern() {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="800" height="150">
                <circle cx="80" cy="75" r="6" fill="white" opacity="0.4"/>
                <circle cx="200" cy="60" r="5" fill="white" opacity="0.35"/>
                <circle cx="320" cy="80" r="5.5" fill="white" opacity="0.38"/>
                <circle cx="440" cy="70" r="7" fill="white" opacity="0.42"/>
                <circle cx="560" cy="75" r="4.5" fill="white" opacity="0.35"/>
                <circle cx="680" cy="72" r="6.5" fill="white" opacity="0.4"/>
                <circle cx="140" cy="85" r="4" fill="white" opacity="0.3"/>
                <circle cx="380" cy="90" r="4.5" fill="white" opacity="0.32"/>
                <circle cx="620" cy="82" r="5" fill="white" opacity="0.35"/>
            </svg>
        `;
        return btoa(svg);
    }

    addAnimationStyles() {
        // Check if styles already exist
        if (document.getElementById('ocean-animations')) return;

        const style = document.createElement('style');
        style.id = 'ocean-animations';
        style.textContent = `
            @keyframes skyScroll {
                0% { background-position: 0% 0; }
                100% { background-position: 200% 0; }
            }

            @keyframes waterScroll {
                0% { background-position: 0 0; }
                100% { background-position: -500px -500px; }
            }

            @keyframes foamScroll {
                0% { background-position: 0 0; }
                100% { background-position: -800px 0; }
            }

            .ocean-background {
                overflow: hidden;
            }

            .ocean-layer {
                will-change: transform;
            }
        `;
        document.head.appendChild(style);
    }

    destroy() {
        if (this.oceanContainer) {
            this.oceanContainer.remove();
        }
    }
}