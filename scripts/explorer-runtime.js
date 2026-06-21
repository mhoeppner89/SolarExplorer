(() => {
    "use strict";

    const celestialData = window.SOLAR_EXPLORER_DATA || [];
    const defaultExplorerCopy = {
        storageKey: "solarExplorer.visited.en",
        typeLabels: {},
        cardProgress: (current, total) => "Card " + current + "/" + total,
        cardProgressEmpty: "Card 0/0",
        emptyCardText: "No fact cards available yet.",
        factImageAlt: (name) => name + " image",
        passportLockedTitle: "Find this to unlock!",
        passportToggleExpanded: "Collapse passport",
        passportToggleCollapsed: "Expand passport",
        selectBodyLabel: "Select object",
        sceneLabel: "Interactive 3D solar system. Use the passport buttons to choose an object.",
        winTitle: "Master Explorer!",
        winMessage: "You have discovered every major object in the Solar System!",
        winButton: "Keep Playing"
    };
    const explorerCopy = { ...defaultExplorerCopy, ...(window.SOLAR_EXPLORER_COPY || {}) };
    // Helper to get all interactable bodies including moons
    const getAllBodies = () => celestialData.concat(celestialData.flatMap(d => d.moons || []));
    
    // --- 2. GLOBAL VARIABLES ---
    let scene, camera, renderer, controls;
    let bodies = [];      // Holds objects to animate
    let clickables = [];  // Holds meshes for raycasting
    let timeSpeed = 0.3;
    let selectedBody = null;
    let visitedBodies = new Set();
    let isIntroComplete = false;
    let isPassportMinimized = false;
    let activeInfoCards = [];
    let activeInfoCardIndex = 0;
    let activeInfoBodyName = '';
    let isFactCardAnimating = false;
    let passportReopenTimeout = null;
    let hasTriggeredWinCelebration = false;
    const bodyVisualPresets = {
        sun: { color: 0xffcc00, emissive: 0xffa21f, roughness: 0.25, metalness: 0.0 },
        mercury: { roughness: 0.92, metalness: 0.05, noise: 0.18, atmosphere: 0xb9c2d1 },
        venus: { roughness: 0.74, metalness: 0.03, noise: 0.12, atmosphere: 0xf2c982 },
        earth: { roughness: 0.62, metalness: 0.05, noise: 0.1, atmosphere: 0x78b9ff },
        moon: { roughness: 0.9, metalness: 0.02, noise: 0.2 },
        mars: { roughness: 0.86, metalness: 0.03, noise: 0.18, atmosphere: 0xf08c5b },
        ceres: { roughness: 0.9, metalness: 0.04, noise: 0.24 },
        jupiter: { roughness: 0.68, metalness: 0.02, bands: [0xd79d55, 0xf0d3a6, 0x9f5d36, 0xf6e1bf], atmosphere: 0xffd9a4 },
        saturn: { roughness: 0.72, metalness: 0.02, bands: [0xd8bf86, 0xf0e4bc, 0xb79057, 0xffefc8], atmosphere: 0xffefc4 },
        uranus: { roughness: 0.58, metalness: 0.04, atmosphere: 0x8bdcff },
        neptune: { roughness: 0.56, metalness: 0.04, atmosphere: 0x709cff },
        pluto: { roughness: 0.88, metalness: 0.03, noise: 0.2 },
        haumea: { roughness: 0.82, metalness: 0.04, noise: 0.12 },
        makemake: { roughness: 0.86, metalness: 0.03, noise: 0.14 },
        eris: { roughness: 0.78, metalness: 0.03, noise: 0.1 }
    };
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;
    const mouseDragThreshold = 8;
    const touchDragThreshold = 24;
    let activePointerId = null;
    let activePointerType = 'mouse';
    let pointerDownX = 0;
    let pointerDownY = 0;
    const textureCache = new Map();
    const visualState = {
        clock: 0,
        starfields: [],
        beltLayers: [],
        orbitPaths: [],
        sunGlowLayers: [],
        earthCloudLayers: [],
        bodyDetailLayers: [],
        selectedOrbitPath: null,
        focusLight: null,
        scratchVector: null,
        scratchColor: null
    };

    function getValidBodyIds() {
        return new Set(getAllBodies().map(body => body.id));
    }

    function clearSavedVisitedBodies() {
        try {
            localStorage.removeItem(explorerCopy.storageKey);
        } catch (error) {
            // Storage can be unavailable in private or restricted browser contexts.
        }
    }

    function loadVisitedBodies() {
        clearSavedVisitedBodies();
        visitedBodies = new Set();
        hasTriggeredWinCelebration = false;
    }

    function saveVisitedBodies() {
        clearSavedVisitedBodies();
    }

    const passportButtonBaseClasses = 'w-7 h-7 md:w-12 md:h-12 bg-gray-800 border border-gray-600 md:border-2 rounded-lg md:rounded-xl flex items-center justify-center text-sm md:text-2xl transition-all duration-500 opacity-50 grayscale cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-300';

    function resetPassportButton(el, data) {
        el.className = passportButtonBaseClasses;
        el.innerHTML = '?';
        el.title = explorerCopy.passportLockedTitle;
        el.setAttribute('aria-label', `${explorerCopy.selectBodyLabel}: ${data.name}`);
    }

    function resetAchievements(updateUi = false) {
        visitedBodies = new Set();
        hasTriggeredWinCelebration = false;
        clearSavedVisitedBodies();

        if (!updateUi) return;

        getAllBodies().forEach(data => {
            const el = document.getElementById(`passport-${data.id}`);
            if (el) {
                resetPassportButton(el, data);
            }
        });
        updatePassportUI(false);
    }

    function leaveExplorer() {
        resetAchievements(false);
    }

    function getSelectedBodyData() {
        return selectedBody && selectedBody.mesh ? selectedBody.mesh.userData : null;
    }

    function renderGameToText() {
        const allBodies = getAllBodies();
        const selected = getSelectedBodyData();
        const infoPanel = document.getElementById('info-panel');
        const infoPanelOpen = !!infoPanel && !infoPanel.classList.contains('hidden');

        const payload = {
            mode: 'exploring',
            language: document.documentElement.lang || 'en',
            timeSpeed,
            selected: selected ? {
                id: selected.id,
                name: selected.name,
                type: explorerCopy.typeLabels[selected.type] || selected.type,
                activeCard: activeInfoCards.length ? {
                    index: activeInfoCardIndex,
                    total: activeInfoCards.length,
                    fact: activeInfoCards[activeInfoCardIndex]?.fact || ''
                } : null
            } : null,
            passport: {
                visited: visitedBodies.size,
                total: allBodies.length,
                ids: [...visitedBodies],
                minimized: isPassportMinimized
            },
            ui: {
                infoPanelOpen,
                controls: ['passport object buttons', 'ArrowLeft/ArrowRight facts', 'Escape reset']
            }
        };

        return JSON.stringify(payload);
    }

    function makeColor(hex) {
        return new THREE.Color(hex);
    }

    function makeSeededRandom(label) {
        let seed = 2166136261;
        for (let i = 0; i < label.length; i += 1) {
            seed ^= label.charCodeAt(i);
            seed = Math.imul(seed, 16777619);
        }

        return () => {
            seed += 0x6D2B79F5;
            let value = seed;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makeCanvasTexture(cacheKey, width, height, draw) {
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        draw(ctx, canvas);

        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function fillGradient(ctx, stops, vertical = true) {
        const gradient = vertical
            ? ctx.createLinearGradient(0, 0, 0, ctx.canvas.height)
            : ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
        stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    function drawCrater(ctx, x, y, radius, rng, palette = {}) {
        const flatten = 0.62 + rng() * 0.28;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rng() - 0.5) * 0.65);
        ctx.fillStyle = palette.shadow || 'rgba(12, 12, 16, 0.26)';
        ctx.beginPath();
        ctx.ellipse(radius * 0.08, radius * 0.16, radius, radius * flatten, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.rim || 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = Math.max(0.8, radius * 0.15);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * flatten, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = palette.floor || 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.ellipse(-radius * 0.2, -radius * 0.18, radius * 0.42, radius * flatten * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawBandTexture(ctx, rng, palette, options = {}) {
        const height = ctx.canvas.height;
        const width = ctx.canvas.width;
        const bands = options.bands || 15;
        const wobble = options.wobble || 8;
        const alpha = options.alpha || 1;
        ctx.globalAlpha = alpha;
        for (let i = 0; i < bands; i += 1) {
            const y = (i / bands) * height;
            const bandHeight = height / bands * (0.78 + rng() * 0.72);
            ctx.fillStyle = palette[i % palette.length];
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x <= width; x += 28) {
                const waveY = y + Math.sin(x * 0.025 + i * 1.8) * wobble + (rng() - 0.5) * wobble * 0.35;
                ctx.lineTo(x, waveY);
            }
            ctx.lineTo(width, y + bandHeight);
            for (let x = width; x >= 0; x -= 28) {
                const waveY = y + bandHeight + Math.sin(x * 0.02 + i) * wobble * 0.55;
                ctx.lineTo(x, waveY);
            }
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawStormOval(ctx, x, y, rx, ry, color, ringColor) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.12);
        ctx.fillStyle = ringColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 1.18, ry * 1.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 236, 196, 0.42)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(rx * 0.12, -ry * 0.05, rx * 0.56, ry * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawFlowingBelt(ctx, y, height, color, options = {}) {
        const width = ctx.canvas.width;
        const wobble = options.wobble || 5;
        const phase = options.phase || 0;
        const step = options.step || 24;
        ctx.save();
        ctx.globalAlpha = options.alpha ?? 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= width + step; x += step) {
            const top = y
                + Math.sin(x * 0.028 + phase) * wobble
                + Math.sin(x * 0.011 + phase * 1.7) * wobble * 0.45;
            ctx.lineTo(x, top);
        }
        for (let x = width + step; x >= 0; x -= step) {
            const bottom = y + height
                + Math.sin(x * 0.023 + phase + 0.8) * wobble * 0.7
                + Math.sin(x * 0.009 + phase) * wobble * 0.35;
            ctx.lineTo(x, bottom);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function createDetailedBodyTexture(data, preset) {
        const cacheKey = `${data.id}:detailed-v3`;
        const rng = makeSeededRandom(cacheKey);

        return makeCanvasTexture(cacheKey, 512, 256, (ctx, canvas) => {
            const w = canvas.width;
            const h = canvas.height;

            if (data.id === 'mercury') {
                fillGradient(ctx, [[0, '#b8b1a4'], [0.5, '#8b857b'], [1, '#5d5b56']]);
                for (let i = 0; i < 95; i += 1) {
                    drawCrater(ctx, rng() * w, rng() * h, 3 + rng() * 14, rng, {
                        shadow: 'rgba(34, 31, 29, 0.28)',
                        rim: 'rgba(236, 229, 211, 0.18)',
                        floor: 'rgba(255, 246, 219, 0.08)'
                    });
                }
                ctx.fillStyle = 'rgba(229, 210, 168, 0.22)';
                ctx.beginPath();
                ctx.ellipse(w * 0.32, h * 0.43, 44, 26, -0.25, 0, Math.PI * 2);
                ctx.fill();
                return;
            }

            if (data.id === 'venus') {
                fillGradient(ctx, [[0, '#f8d98a'], [0.28, '#dba856'], [0.58, '#b87935'], [1, '#f1c77b']]);
                drawBandTexture(ctx, rng, ['rgba(255,239,171,0.42)', 'rgba(181,105,42,0.28)', 'rgba(250,188,92,0.34)', 'rgba(119,73,36,0.18)'], { bands: 18, wobble: 13 });
                ctx.globalAlpha = 0.46;
                ctx.strokeStyle = '#fff1bf';
                ctx.lineWidth = 4;
                for (let i = 0; i < 11; i += 1) {
                    ctx.beginPath();
                    const y = 22 + i * 21;
                    for (let x = -20; x <= w + 20; x += 34) {
                        const py = y + Math.sin(x * 0.035 + i) * 11;
                        if (x === -20) ctx.moveTo(x, py);
                        else ctx.lineTo(x, py);
                    }
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
                return;
            }

            if (data.id === 'moon') {
                fillGradient(ctx, [[0, '#d8d8d3'], [0.45, '#9c9c97'], [1, '#686a68']]);
                ctx.globalAlpha = 0.42;
                ctx.fillStyle = '#565a5e';
                [[0.31,0.37,36,19], [0.58,0.47,28,15], [0.73,0.31,22,12], [0.45,0.67,32,13]].forEach(([x, y, rx, ry]) => {
                    ctx.beginPath();
                    ctx.ellipse(x * w, y * h, rx, ry, -0.1, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.globalAlpha = 1;
                for (let i = 0; i < 85; i += 1) {
                    drawCrater(ctx, rng() * w, rng() * h, 2 + rng() * 11, rng, {
                        shadow: 'rgba(38, 40, 42, 0.3)',
                        rim: 'rgba(248, 248, 236, 0.2)',
                        floor: 'rgba(255, 255, 255, 0.1)'
                    });
                }
                return;
            }

            if (data.id === 'mars') {
                fillGradient(ctx, [[0, '#9a351e'], [0.28, '#d06b35'], [0.58, '#a94824'], [1, '#5f241a']]);
                ctx.globalAlpha = 0.46;
                ctx.fillStyle = '#6d2b22';
                [[0.30,0.34,54,17], [0.57,0.50,80,12], [0.76,0.38,42,14]].forEach(([x, y, rx, ry]) => {
                    ctx.beginPath();
                    ctx.ellipse(x * w, y * h, rx, ry, -0.08, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.strokeStyle = 'rgba(64, 25, 22, 0.62)';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(w * 0.18, h * 0.54);
                ctx.bezierCurveTo(w * 0.34, h * 0.48, w * 0.55, h * 0.62, w * 0.78, h * 0.54);
                ctx.stroke();
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#f5e8d4';
                ctx.fillRect(0, 0, w, 9);
                ctx.fillRect(0, h - 13, w, 13);
                ctx.globalAlpha = 1;
                for (let i = 0; i < 42; i += 1) {
                    drawCrater(ctx, rng() * w, rng() * h, 2 + rng() * 7, rng, {
                        shadow: 'rgba(60, 21, 16, 0.24)',
                        rim: 'rgba(255, 201, 134, 0.16)',
                        floor: 'rgba(255, 229, 180, 0.06)'
                    });
                }
                return;
            }

            if (data.id === 'ceres') {
                fillGradient(ctx, [[0, '#b5b6ad'], [0.52, '#72756f'], [1, '#4a4c49']]);
                for (let i = 0; i < 70; i += 1) {
                    drawCrater(ctx, rng() * w, rng() * h, 2 + rng() * 13, rng);
                }
                ctx.fillStyle = 'rgba(255, 255, 228, 0.92)';
                ctx.beginPath();
                ctx.arc(w * 0.62, h * 0.48, 4.5, 0, Math.PI * 2);
                ctx.arc(w * 0.65, h * 0.50, 3.2, 0, Math.PI * 2);
                ctx.fill();
                return;
            }

            if (data.id === 'jupiter') {
                fillGradient(ctx, [[0, '#c77f52'], [0.18, '#ecd7b0'], [0.36, '#b76b3b'], [0.5, '#f4e0b5'], [0.68, '#a86139'], [0.84, '#e8c995'], [1, '#9b684d']]);
                drawFlowingBelt(ctx, h * 0.03, h * 0.12, 'rgba(126, 82, 68, 0.42)', { wobble: 3, phase: 0.4 });
                drawFlowingBelt(ctx, h * 0.16, h * 0.08, 'rgba(250, 225, 178, 0.82)', { wobble: 5, phase: 1.1 });
                drawFlowingBelt(ctx, h * 0.25, h * 0.10, 'rgba(145, 76, 47, 0.86)', { wobble: 6, phase: 2.2 });
                drawFlowingBelt(ctx, h * 0.35, h * 0.09, 'rgba(236, 195, 134, 0.72)', { wobble: 4, phase: 3.1 });
                drawFlowingBelt(ctx, h * 0.45, h * 0.09, 'rgba(255, 237, 195, 0.9)', { wobble: 5, phase: 4.2 });
                drawFlowingBelt(ctx, h * 0.54, h * 0.12, 'rgba(157, 83, 48, 0.9)', { wobble: 7, phase: 5.4 });
                drawFlowingBelt(ctx, h * 0.67, h * 0.09, 'rgba(229, 186, 116, 0.68)', { wobble: 4, phase: 6.6 });
                drawFlowingBelt(ctx, h * 0.76, h * 0.12, 'rgba(103, 68, 61, 0.38)', { wobble: 3, phase: 7.5 });

                ctx.globalAlpha = 0.36;
                ctx.strokeStyle = '#fff1ca';
                ctx.lineWidth = 2.3;
                for (let i = 0; i < 13; i += 1) {
                    const y = h * (0.12 + i * 0.061);
                    ctx.beginPath();
                    for (let x = -20; x <= w + 20; x += 24) {
                        const py = y + Math.sin(x * 0.035 + i * 0.7) * 4 + Math.sin(x * 0.012 + i) * 2;
                        if (x === -20) ctx.moveTo(x, py);
                        else ctx.lineTo(x, py);
                    }
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;

                for (let i = 0; i < 8; i += 1) {
                    drawStormOval(ctx, w * (0.08 + rng() * 0.84), h * (0.24 + rng() * 0.48), 5 + rng() * 8, 2.4 + rng() * 3.2, 'rgba(250,222,176,0.38)', 'rgba(111,63,45,0.16)');
                }

                const redSpotX = w * 0.22;
                const redSpotY = h * 0.59;
                drawStormOval(ctx, redSpotX, redSpotY, 68, 25, '#8f392d', 'rgba(255, 219, 169, 0.86)');
                drawStormOval(ctx, redSpotX, redSpotY, 44, 14, '#cf6541', 'rgba(97, 39, 32, 0.28)');
                ctx.save();
                ctx.translate(redSpotX, redSpotY);
                ctx.rotate(-0.12);
                ctx.strokeStyle = 'rgba(255, 231, 191, 0.76)';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.ellipse(4, -1, 25, 7, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                return;
            }

            if (data.id === 'saturn') {
                fillGradient(ctx, [[0, '#fff1c6'], [0.42, '#e3c98f'], [0.72, '#f8e9bc'], [1, '#c3a36e']]);
                drawBandTexture(ctx, rng, ['rgba(255,240,196,0.72)', 'rgba(205,166,101,0.46)', 'rgba(255,248,216,0.58)', 'rgba(174,132,76,0.34)'], { bands: 18, wobble: 4, alpha: 0.62 });
                ctx.globalAlpha = 0.24;
                ctx.fillStyle = '#fff6d5';
                ctx.beginPath();
                ctx.moveTo(w * 0.44, h * 0.04);
                for (let i = 0; i < 6; i += 1) {
                    const angle = -Math.PI / 2 + i * Math.PI / 3;
                    ctx.lineTo(w * 0.5 + Math.cos(angle) * 22, h * 0.1 + Math.sin(angle) * 13);
                }
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 1;
                return;
            }

            if (data.id === 'uranus') {
                fillGradient(ctx, [[0, '#c9fbff'], [0.46, '#75d6e6'], [1, '#3f9fb4']]);
                drawBandTexture(ctx, rng, ['rgba(255,255,255,0.17)', 'rgba(83,185,205,0.13)', 'rgba(22,116,146,0.09)'], { bands: 11, wobble: 3, alpha: 0.76 });
                ctx.fillStyle = 'rgba(255,255,255,0.38)';
                ctx.beginPath();
                ctx.ellipse(w * 0.68, h * 0.34, 22, 7, -0.18, 0, Math.PI * 2);
                ctx.fill();
                return;
            }

            if (data.id === 'neptune') {
                fillGradient(ctx, [[0, '#3e63cf'], [0.45, '#1745a9'], [1, '#061d5d']]);
                drawBandTexture(ctx, rng, ['rgba(75,141,255,0.34)', 'rgba(14,43,125,0.24)', 'rgba(190,223,255,0.18)'], { bands: 13, wobble: 9 });
                ctx.fillStyle = 'rgba(3, 13, 49, 0.62)';
                ctx.beginPath();
                ctx.ellipse(w * 0.64, h * 0.54, 30, 12, -0.15, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(240, 250, 255, 0.55)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(w * 0.26, h * 0.34);
                ctx.bezierCurveTo(w * 0.42, h * 0.29, w * 0.61, h * 0.36, w * 0.86, h * 0.31);
                ctx.stroke();
                return;
            }

            if (data.id === 'pluto') {
                fillGradient(ctx, [[0, '#e1d1be'], [0.48, '#b78d6f'], [1, '#745f56']]);
                ctx.globalAlpha = 0.72;
                ctx.fillStyle = '#f1e8dc';
                ctx.beginPath();
                ctx.moveTo(w * 0.50, h * 0.36);
                ctx.bezierCurveTo(w * 0.45, h * 0.22, w * 0.32, h * 0.28, w * 0.36, h * 0.44);
                ctx.bezierCurveTo(w * 0.39, h * 0.57, w * 0.49, h * 0.64, w * 0.50, h * 0.78);
                ctx.bezierCurveTo(w * 0.51, h * 0.64, w * 0.61, h * 0.57, w * 0.64, h * 0.44);
                ctx.bezierCurveTo(w * 0.68, h * 0.28, w * 0.55, h * 0.22, w * 0.50, h * 0.36);
                ctx.fill();
                ctx.globalAlpha = 1;
                for (let i = 0; i < 45; i += 1) {
                    drawCrater(ctx, rng() * w, rng() * h, 2 + rng() * 8, rng, {
                        shadow: 'rgba(70,45,42,0.17)',
                        rim: 'rgba(255,245,230,0.16)',
                        floor: 'rgba(255,255,255,0.06)'
                    });
                }
                return;
            }

            if (data.id === 'haumea') {
                fillGradient(ctx, [[0, '#f3fbff'], [0.5, '#b8d0e2'], [1, '#7794a8']]);
                drawBandTexture(ctx, rng, ['rgba(255,255,255,0.34)', 'rgba(104,133,153,0.2)', 'rgba(220,240,255,0.22)'], { bands: 9, wobble: 4 });
                ctx.fillStyle = 'rgba(123,74,54,0.48)';
                ctx.beginPath();
                ctx.ellipse(w * 0.57, h * 0.46, 36, 12, 0.07, 0, Math.PI * 2);
                ctx.fill();
                return;
            }

            if (data.id === 'makemake') {
                fillGradient(ctx, [[0, '#d9b0a3'], [0.52, '#a45f55'], [1, '#68433f']]);
                ctx.globalAlpha = 0.35;
                for (let i = 0; i < 44; i += 1) {
                    ctx.fillStyle = rng() > 0.45 ? '#f2d4c6' : '#6e3434';
                    ctx.beginPath();
                    ctx.ellipse(rng() * w, rng() * h, 8 + rng() * 25, 3 + rng() * 10, rng() * Math.PI, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                return;
            }

            if (data.id === 'eris') {
                fillGradient(ctx, [[0, '#ffffff'], [0.5, '#dbe6ee'], [1, '#aab6c4']]);
                ctx.strokeStyle = 'rgba(101, 122, 149, 0.28)';
                ctx.lineWidth = 2;
                for (let i = 0; i < 22; i += 1) {
                    ctx.beginPath();
                    const y = rng() * h;
                    ctx.moveTo(rng() * w, y);
                    ctx.bezierCurveTo(rng() * w, y + (rng() - 0.5) * 40, rng() * w, rng() * h, rng() * w, rng() * h);
                    ctx.stroke();
                }
                ctx.globalAlpha = 0.38;
                ctx.fillStyle = '#f6fbff';
                for (let i = 0; i < 24; i += 1) {
                    ctx.beginPath();
                    ctx.ellipse(rng() * w, rng() * h, 10 + rng() * 24, 3 + rng() * 9, rng() * Math.PI, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
        });
    }

    function createSunTexture(data) {
        const cacheKey = `${data.id}:solar-plasma`;
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const baseGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        baseGradient.addColorStop(0, '#fff3a6');
        baseGradient.addColorStop(0.22, '#ffc34c');
        baseGradient.addColorStop(0.5, '#ff8a22');
        baseGradient.addColorStop(0.78, '#ffd166');
        baseGradient.addColorStop(1, '#fff0a0');
        ctx.fillStyle = baseGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 850; i += 1) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const radius = 3 + Math.random() * 18;
            const color = Math.random() > 0.45 ? '255,239,153' : '255,111,31';
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(${color}, ${0.2 + Math.random() * 0.35})`);
            gradient.addColorStop(1, `rgba(${color}, 0)`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.lineCap = 'round';
        for (let i = 0; i < 26; i += 1) {
            const y = (i / 25) * canvas.height + Math.sin(i * 1.7) * 8;
            ctx.strokeStyle = i % 3 === 0 ? 'rgba(255, 248, 184, 0.34)' : 'rgba(255, 95, 26, 0.22)';
            ctx.lineWidth = 2 + Math.random() * 5;
            ctx.beginPath();
            ctx.moveTo(-20, y);
            for (let x = 0; x <= canvas.width + 40; x += 64) {
                ctx.lineTo(x, y + Math.sin(x * 0.028 + i) * (9 + Math.random() * 8));
            }
            ctx.stroke();
        }

        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 14; i += 1) {
            ctx.fillStyle = `rgba(115, 31, 14, ${0.16 + Math.random() * 0.16})`;
            ctx.beginPath();
            ctx.ellipse(
                Math.random() * canvas.width,
                24 + Math.random() * (canvas.height - 48),
                6 + Math.random() * 17,
                2 + Math.random() * 7,
                Math.random() * Math.PI,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }

        ctx.globalCompositeOperation = 'lighter';
        const limbGlow = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.5, 0, canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.7);
        limbGlow.addColorStop(0, 'rgba(255, 180, 42, 0)');
        limbGlow.addColorStop(0.72, 'rgba(255, 245, 190, 0.08)');
        limbGlow.addColorStop(1, 'rgba(255, 245, 190, 0.22)');
        ctx.fillStyle = limbGlow;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function drawNormalizedPath(ctx, points) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        ctx.beginPath();
        points.forEach(([x, y], index) => {
            const px = x * width;
            const py = y * height;
            if (index === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        });
        ctx.closePath();
    }

    function fillLandShape(ctx, points, fill, stroke = 'rgba(14, 55, 28, 0.28)') {
        drawNormalizedPath(ctx, points);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.3;
        ctx.stroke();
    }

    function createEarthTexture(data) {
        const cacheKey = `${data.id}:earth-realistic`;
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
        ocean.addColorStop(0, '#082554');
        ocean.addColorStop(0.32, '#0a5e9f');
        ocean.addColorStop(0.54, '#0b72b7');
        ocean.addColorStop(0.78, '#073c7e');
        ocean.addColorStop(1, '#041c48');
        ctx.fillStyle = ocean;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#7bc8ff';
        ctx.lineWidth = 1;
        for (let y = 24; y < canvas.height - 16; y += 18) {
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += 18) {
                const waveY = y + Math.sin(x * 0.028 + y * 0.09) * 3;
                if (x === 0) {
                    ctx.moveTo(x, waveY);
                } else {
                    ctx.lineTo(x, waveY);
                }
            }
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        const forest = '#2f8b49';
        const grass = '#7fb85b';
        const desert = '#c9a75c';
        const tundra = '#c8d4a1';
        const ice = '#f3fbff';

        fillLandShape(ctx, [[0.12,0.26],[0.18,0.18],[0.29,0.22],[0.34,0.31],[0.31,0.41],[0.25,0.45],[0.22,0.52],[0.16,0.49],[0.10,0.39]], forest);
        fillLandShape(ctx, [[0.29,0.50],[0.35,0.54],[0.39,0.65],[0.37,0.77],[0.32,0.88],[0.28,0.78],[0.25,0.63]], grass);
        fillLandShape(ctx, [[0.31,0.13],[0.39,0.12],[0.43,0.19],[0.40,0.26],[0.32,0.25]], tundra);
        fillLandShape(ctx, [[0.46,0.27],[0.58,0.19],[0.74,0.23],[0.83,0.34],[0.78,0.47],[0.64,0.47],[0.55,0.39],[0.46,0.41]], forest);
        fillLandShape(ctx, [[0.54,0.42],[0.63,0.42],[0.68,0.55],[0.64,0.72],[0.57,0.77],[0.52,0.61]], grass);
        fillLandShape(ctx, [[0.77,0.61],[0.86,0.63],[0.89,0.72],[0.82,0.78],[0.75,0.71]], desert);
        fillLandShape(ctx, [[0.02,0.87],[0.18,0.88],[0.33,0.86],[0.51,0.89],[0.71,0.86],[0.91,0.88],[1.00,0.86],[1.00,1.00],[0.00,1.00]], ice, 'rgba(255,255,255,0.35)');

        ctx.globalAlpha = 0.78;
        ctx.fillStyle = desert;
        ctx.beginPath();
        ctx.ellipse(canvas.width * 0.59, canvas.height * 0.49, 34, 13, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(canvas.width * 0.67, canvas.height * 0.38, 42, 11, 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(canvas.width * 0.82, canvas.height * 0.69, 26, 12, -0.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = '#efe7c8';
        ctx.lineWidth = 2;
        [[[0.18,0.23],[0.23,0.28],[0.27,0.36]], [[0.50,0.30],[0.58,0.27],[0.70,0.31]], [[0.30,0.58],[0.33,0.67],[0.32,0.80]]].forEach(points => {
            ctx.beginPath();
            points.forEach(([x, y], index) => {
                if (index === 0) ctx.moveTo(x * canvas.width, y * canvas.height);
                else ctx.lineTo(x * canvas.width, y * canvas.height);
            });
            ctx.stroke();
        });

        ctx.globalAlpha = 0.48;
        ctx.fillStyle = '#f7fbff';
        ctx.fillRect(0, 0, canvas.width, 12);
        ctx.fillRect(0, canvas.height - 18, canvas.width, 18);
        ctx.globalAlpha = 1;

        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function createEarthCloudTexture() {
        const cacheKey = 'earth:clouds';
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.46)';

        for (let i = 0; i < 42; i += 1) {
            const x = ((i * 73) % canvas.width) - 40;
            const y = 24 + ((i * 41) % (canvas.height - 52));
            const w = 34 + ((i * 17) % 58);
            const h = 5 + ((i * 11) % 16);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((Math.sin(i * 1.7) * 0.32));
            ctx.beginPath();
            ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
            ctx.ellipse(w * 0.42, h * 0.16, w * 0.55, h * 0.9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 9; i += 1) {
            const y = 36 + i * 21;
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += 24) {
                const py = y + Math.sin(x * 0.035 + i) * 7;
                if (x === 0) ctx.moveTo(x, py);
                else ctx.lineTo(x, py);
            }
            ctx.stroke();
        }

        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function hasDetailedBodyTexture(data) {
        return [
            'mercury',
            'venus',
            'moon',
            'mars',
            'ceres',
            'jupiter',
            'saturn',
            'uranus',
            'neptune',
            'pluto',
            'haumea',
            'makemake',
            'eris'
        ].includes(data.id);
    }

    function createBodyTexture(data, preset) {
        const cacheKey = `${data.id}:${preset.bands ? 'bands' : 'noise'}`;
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        if (data.type === 'Star') {
            return createSunTexture(data);
        }

        if (data.id === 'earth') {
            return createEarthTexture(data);
        }

        if (hasDetailedBodyTexture(data)) {
            return createDetailedBodyTexture(data, preset);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const base = makeColor(preset.color || data.color);
        const baseCss = `#${base.getHexString()}`;

        ctx.fillStyle = baseCss;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (preset.bands) {
            const bandHeight = canvas.height / 13;
            for (let y = -bandHeight; y < canvas.height + bandHeight; y += bandHeight) {
                const color = makeColor(preset.bands[Math.floor((y + bandHeight) / bandHeight) % preset.bands.length]);
                color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
                ctx.fillStyle = `#${color.getHexString()}`;
                ctx.globalAlpha = 0.55 + Math.random() * 0.25;
                ctx.fillRect(0, y + Math.sin(y * 0.11) * 3, canvas.width, bandHeight * (0.65 + Math.random() * 0.65));
            }

            if (data.id === 'jupiter') {
                ctx.globalAlpha = 0.82;
                ctx.fillStyle = '#c96f4f';
                ctx.beginPath();
                ctx.ellipse(canvas.width * 0.66, canvas.height * 0.58, 22, 10, -0.16, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            const noise = preset.noise || 0.08;
            for (let i = 0; i < 180; i += 1) {
                const color = base.clone();
                color.offsetHSL(0, 0, (Math.random() - 0.5) * noise);
                ctx.globalAlpha = 0.14 + Math.random() * 0.22;
                ctx.fillStyle = `#${color.getHexString()}`;
                ctx.beginPath();
                ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 1 + Math.random() * 8, 1 + Math.random() * 5, Math.random() * Math.PI, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;
        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function createBodyMaterial(data) {
        const preset = bodyVisualPresets[data.id] || {};

        if (data.type === 'Star') {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                map: createBodyTexture(data, preset)
            });
            material.toneMapped = false;
            return material;
        }

        if (data.id === 'earth') {
            const material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: createBodyTexture(data, preset),
                roughness: 0.78,
                metalness: 0.02,
                emissive: 0x07172d,
                emissiveIntensity: 0.025
            });
            material.userData.baseEmissiveIntensity = material.emissiveIntensity;
            return material;
        }

        if (hasDetailedBodyTexture(data)) {
            const material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: createBodyTexture(data, preset),
                roughness: preset.roughness ?? 0.78,
                metalness: preset.metalness ?? 0.03,
                emissive: preset.emissive || data.color,
                emissiveIntensity: data.type === 'Dwarf Planet' || data.type === 'Moon' ? 0.018 : 0.012
            });
            material.userData.baseEmissiveIntensity = material.emissiveIntensity;
            return material;
        }

        const material = new THREE.MeshStandardMaterial({
            color: data.color,
            map: createBodyTexture(data, preset),
            roughness: preset.roughness ?? 0.72,
            metalness: preset.metalness ?? 0.04,
            emissive: preset.emissive || data.color,
            emissiveIntensity: data.type === 'Dwarf Planet' ? 0.025 : 0.015
        });
        material.userData.baseEmissiveIntensity = material.emissiveIntensity;

        return material;
    }

    function addAtmosphere(mesh, data) {
        const preset = bodyVisualPresets[data.id] || {};
        if (!preset.atmosphere || data.radius < 0.75) return;

        const atmosphere = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * 1.08, 32, 32),
            new THREE.MeshBasicMaterial({
                color: preset.atmosphere,
                transparent: true,
                opacity: data.id === 'earth' ? 0.2 : 0.13,
                side: THREE.BackSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        atmosphere.userData.isDecorative = true;
        mesh.add(atmosphere);
    }

    function addEarthCloudLayer(mesh, data) {
        if (data.id !== 'earth') return;

        const clouds = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * 1.025, 48, 48),
            new THREE.MeshBasicMaterial({
                map: createEarthCloudTexture(),
                color: 0xffffff,
                transparent: true,
                opacity: 0.38,
                depthWrite: false
            })
        );
        clouds.userData.isEarthCloudLayer = true;
        mesh.add(clouds);
        visualState.earthCloudLayers.push(clouds);
    }

    function createRingMaterial(data) {
        return new THREE.MeshBasicMaterial({
            color: data.rings.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: data.rings.opacity || 0.38,
            depthWrite: false
        });
    }

    function tiltRingMesh(ringMesh, data = null) {
        if (data && data.id === 'uranus') {
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.rotation.y = 0;
            ringMesh.rotation.z = 0;
            return;
        }

        ringMesh.rotation.x = Math.PI / 2 + 0.3;
        ringMesh.rotation.y = 0.1;
    }

    function addRingBandDetails(mesh, data) {
        if (!data.rings) return;

        if (data.id === 'saturn') {
            const bands = [
                { inner: 3.76, outer: 4.16, color: 0xb69a70, opacity: 0.36 },
                { inner: 4.18, outer: 4.96, color: 0xf0cf8c, opacity: 0.86 },
                { inner: 4.98, outer: 5.22, color: 0xffe3a6, opacity: 0.64 },
                { inner: 5.44, outer: 6.18, color: 0xc99b5f, opacity: 0.76 },
                { inner: 6.22, outer: 6.48, color: 0xe7c48c, opacity: 0.42 }
            ];
            bands.forEach(bandSpec => {
                const band = new THREE.Mesh(
                    new THREE.RingGeometry(bandSpec.inner, bandSpec.outer, 192),
                    new THREE.MeshBasicMaterial({
                        color: bandSpec.color,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: bandSpec.opacity,
                        depthWrite: false,
                        depthTest: true,
                        blending: THREE.AdditiveBlending
                    })
                );
                tiltRingMesh(band, data);
                band.renderOrder = 1;
                mesh.add(band);
            });
            return;
        }

        const rng = makeSeededRandom(`${data.id}:ring-band-meshes`);
        const bandCount = 3;
        const palette = data.id === 'uranus'
            ? [0xdffaff, 0x9ad8ee, 0xffffff]
            : [0xf7e7bd, 0xb89568, 0xfff7dc, 0x8d765b];
        const span = data.rings.outer - data.rings.inner;

        for (let i = 0; i < bandCount; i += 1) {
            const start = data.rings.inner + span * (i / bandCount) + span * 0.012;
            const end = data.rings.inner + span * ((i + 0.58 + rng() * 0.22) / bandCount);
            if (end <= start) continue;

            const band = new THREE.Mesh(
                new THREE.RingGeometry(start, Math.min(end, data.rings.outer), 128),
                new THREE.MeshBasicMaterial({
                    color: palette[i % palette.length],
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.12 + rng() * 0.1,
                    depthWrite: false
                })
            );
            tiltRingMesh(band, data);
            mesh.add(band);
        }
    }

    function getBodyBaseScale(data) {
        if (data.id === 'haumea') {
            return new THREE.Vector3(1.58, 0.72, 0.86);
        }

        return new THREE.Vector3(1, 1, 1);
    }

    function addHaumeaRing(mesh, data) {
        if (data.id !== 'haumea') return;

        const ringGeo = new THREE.RingGeometry(data.radius * 1.55, data.radius * 1.9, 80);
        const ringMesh = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({
                color: 0xddeeff,
                transparent: true,
                opacity: 0.34,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        ringMesh.rotation.x = Math.PI / 2 + 0.24;
        ringMesh.rotation.y = 0.14;
        mesh.add(ringMesh);
        visualState.bodyDetailLayers.push({ mesh: ringMesh, drift: 0.004 });
    }

    function applySunFacingPoleOrientation(body, spinDelta = 0) {
        if (!body || !body.mesh || !body.data || body.data.id !== 'uranus') return false;

        body.axialSpin = (body.axialSpin || 0) + spinDelta;
        const sunDirection = body.systemGroup.position.clone().multiplyScalar(-1);
        if (sunDirection.lengthSq() < 0.000001) {
            sunDirection.set(-1, 0, 0);
        }
        sunDirection.normalize();

        const localPole = new THREE.Vector3(0, 1, 0);
        const axisQuaternion = new THREE.Quaternion().setFromUnitVectors(localPole, sunDirection);
        const spinQuaternion = new THREE.Quaternion().setFromAxisAngle(localPole, body.axialSpin);
        body.mesh.quaternion.copy(axisQuaternion).multiply(spinQuaternion);
        return true;
    }

    function createSunGlowTexture() {
        const cacheKey = 'sun:radial-glow';
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        glow.addColorStop(0, 'rgba(255, 255, 235, 0.95)');
        glow.addColorStop(0.15, 'rgba(255, 238, 154, 0.55)');
        glow.addColorStop(0.34, 'rgba(255, 159, 48, 0.24)');
        glow.addColorStop(0.68, 'rgba(255, 95, 24, 0.08)');
        glow.addColorStop(1, 'rgba(255, 95, 24, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        if ('sRGBEncoding' in THREE) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;
        textureCache.set(cacheKey, texture);
        return texture;
    }

    function addSunGlow(mesh, data) {
        const layers = [
            { scale: 3.15, color: 0xfff0b0, opacity: 0.62 },
            { scale: 5.25, color: 0xff8f2c, opacity: 0.3 }
        ];
        const glowTexture = createSunGlowTexture();

        layers.forEach(layer => {
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: layer.color,
                transparent: true,
                opacity: layer.opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: false
            }));
            glow.scale.set(data.radius * layer.scale, data.radius * layer.scale, 1);
            glow.userData.baseOpacity = layer.opacity;
            mesh.add(glow);
            visualState.sunGlowLayers.push(glow);
        });
    }
    
    // --- 3. INITIALIZATION ---
    function init() {
        visualState.scratchVector = new THREE.Vector3();
        visualState.scratchColor = new THREE.Color();

        // Scene Setup
        const container = document.getElementById('canvas-container');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020208); // Deep space dark blue/black
        scene.fog = new THREE.FogExp2(0x020208, 0.0012);
    
        // Camera Setup
        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
        camera.position.set(0, 80, 100);
    
        // Renderer Setup
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // optimize performance
        if (THREE.ACESFilmicToneMapping) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.12;
        }
        if (THREE.sRGBEncoding) {
            renderer.outputEncoding = THREE.sRGBEncoding;
        }
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute('role', 'application');
        renderer.domElement.setAttribute('aria-label', explorerCopy.sceneLabel);
        container.appendChild(renderer.domElement);
    
        // Controls Setup
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.rotateSpeed = 0.7;
        controls.zoomSpeed = 0.85;
        controls.maxDistance = 300;
        controls.minDistance = 10;
        controls.autoRotate = true; // Gentle rotation before interaction
        controls.autoRotateSpeed = 0.1;
    
        // Lights Setup
        const ambientLight = new THREE.AmbientLight(0x182033, 0.55); // Dim background light
        scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0x5b7fff, 0x12070a, 0.45);
        scene.add(hemiLight);
    
        const sunLight = new THREE.PointLight(0xfff0c2, 3.6, 420, 1.2); // Light coming from the sun
        scene.add(sunLight);

        visualState.focusLight = new THREE.PointLight(0xbfdcff, 1.3, 55, 1.2);
        visualState.focusLight.visible = false;
        scene.add(visualState.focusLight);
    
        // Generate the Universe!
        createStarfield();
        createBelts();
        createSolarSystem();
        loadVisitedBodies();
        initPassportUI();
        updatePassportUI(false);

        // Event Listeners
        window.addEventListener('resize', onWindowResize);
        window.addEventListener('keydown', handleGlobalKeydown);
        window.addEventListener('pagehide', () => resetAchievements(false));
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                resetAchievements(true);
            }
        });
    
        // Differentiate between dragging to rotate and clicking to select
        renderer.domElement.addEventListener('pointerdown', (e) => {
            activePointerId = e.pointerId;
            activePointerType = e.pointerType || 'mouse';
            pointerDownX = e.clientX;
            pointerDownY = e.clientY;
            isDragging = false;
        });
        renderer.domElement.addEventListener('pointermove', (e) => {
            if (activePointerId === e.pointerId) {
                const dx = e.clientX - pointerDownX;
                const dy = e.clientY - pointerDownY;
                const dragThreshold = activePointerType === 'mouse' ? mouseDragThreshold : touchDragThreshold;
                if ((dx * dx + dy * dy) > dragThreshold * dragThreshold) {
                    isDragging = true;
                }
            }
    
            if (e.pointerType !== 'mouse') {
                return;
            }
    
            // Cursor hover effect
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(clickables);
            document.body.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
        });
        renderer.domElement.addEventListener('pointerup', (e) => {
            if (activePointerId !== e.pointerId) return;
            onPointerClick(e);
            activePointerId = null;
            activePointerType = 'mouse';
            isDragging = false;
        });
        renderer.domElement.addEventListener('pointercancel', () => {
            activePointerId = null;
            activePointerType = 'mouse';
            isDragging = false;
        });
    
        // Start Animation Loop
        animate();
    
        // Hide tutorial hint after 8 seconds
        setTimeout(() => {
            const hint = document.getElementById('tutorial-hint');
            if (hint) hint.style.opacity = '0';
        }, 8000);
    }
    
    // --- 4. SCENE GENERATION FUNCTIONS ---
    function createStarfield() {
        createStarLayer({ count: 1400, innerRadius: 260, outerRadius: 520, size: 0.42, opacity: 0.72, colorA: 0xffffff, colorB: 0x9fc7ff, drift: 0.000045 });
        createStarLayer({ count: 900, innerRadius: 360, outerRadius: 720, size: 0.72, opacity: 0.54, colorA: 0xfff1c0, colorB: 0xc9d8ff, drift: -0.000028 });
        createStarLayer({ count: 550, innerRadius: 480, outerRadius: 850, size: 1.05, opacity: 0.28, colorA: 0x8fb7ff, colorB: 0xffffff, drift: 0.000018 });
    }

    function createStarLayer({ count, innerRadius, outerRadius, size, opacity, colorA, colorB, drift }) {
        const starsGeo = new THREE.BufferGeometry();
        const starsPos = [];
        const starColors = [];
        const firstColor = makeColor(colorA);
        const secondColor = makeColor(colorB);

        for (let i = 0; i < count; i++) {
            // Scatter stars in a large sphere
            const r = innerRadius + Math.random() * (outerRadius - innerRadius);
            const theta = Math.random() * 2 * Math.PI;
            const phi = Math.acos(2 * Math.random() - 1);
    
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            starsPos.push(x, y, z);

            const mixed = firstColor.clone().lerp(secondColor, Math.random());
            mixed.toArray(starColors, starColors.length);
        }
        starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starsPos, 3));
        starsGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    
        // Create a custom shader or just basic points with tiny sizes
        const starsMat = new THREE.PointsMaterial({
            size,
            vertexColors: true,
            transparent: true,
            opacity,
            depthWrite: false
        });
    
        const starMesh = new THREE.Points(starsGeo, starsMat);
        starMesh.userData.drift = drift;
        visualState.starfields.push(starMesh);
        scene.add(starMesh);
    }
    
    function createBelts() {
        // Asteroid Belt (Between Mars and Jupiter)
        createParticleRing(36, 46, 3000, 0x9c9388, 0.14, 0.00045);
        // Kuiper Belt (Beyond Neptune)
        createParticleRing(115, 170, 5000, 0x9fc8ff, 0.18, -0.00018);
    }
    
    function createParticleRing(innerRadius, outerRadius, count, colorHex, size, drift) {
        const geo = new THREE.BufferGeometry();
        const pos = [];
        const colors = [];
        const baseColor = makeColor(colorHex);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = innerRadius + Math.pow(Math.random(), 1.5) * (outerRadius - innerRadius);
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            // Add some slight vertical thickness
            const y = (Math.random() - 0.5) * 3 * (1 - Math.abs(r - (innerRadius + outerRadius) / 2) / ((outerRadius - innerRadius) / 2));
            pos.push(x, y, z);

            const color = baseColor.clone();
            color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
            color.toArray(colors, colors.length);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({ size: size, vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false });
        const particles = new THREE.Points(geo, mat);
        particles.userData.drift = drift;
        visualState.beltLayers.push(particles);
        scene.add(particles);
    }
    
    function getPlanetHitboxRadius(bodyData) {
        if (bodyData.id === 'earth') {
            // Keep Earth's hitbox conservative so the Moon remains easy to select.
            return bodyData.radius * 1.15;
        }
    
        if (bodyData.type === 'Dwarf Planet') {
            return bodyData.radius * 5.2;
        }
    
        if (bodyData.radius <= 1.1) {
            return bodyData.radius * 3.8;
        }
    
        if (bodyData.radius <= 2.2) {
            return bodyData.radius * 2.1;
        }
    
        return bodyData.radius * 1.45;
    }
    
    function getMoonHitboxRadius(moonData, parentData) {
        if (parentData.id === 'earth' && moonData.id === 'moon') {
            return moonData.radius * 4.4;
        }
    
        return moonData.radius * 4.0;
    }
    
    function createSolarSystem() {
        celestialData.forEach(data => {
            // 1. Geometry & Material
            const geo = new THREE.SphereGeometry(data.radius, 32, 32);
            const mat = createBodyMaterial(data);
    
            const mesh = new THREE.Mesh(geo, mat);
            addAtmosphere(mesh, data);
            addEarthCloudLayer(mesh, data);
    
            // Give every non-star body a pick helper to improve tap/click reliability.
            if (data.type !== 'Star') {
                const hitGeo = new THREE.SphereGeometry(getPlanetHitboxRadius(data), 16, 16);
                const hitMat = new THREE.MeshBasicMaterial({ visible: false });
                const hitMesh = new THREE.Mesh(hitGeo, hitMat);
                mesh.add(hitMesh);
                hitMesh.userData = { id: data.id, isClickTarget: true, parentMesh: mesh };
                clickables.push(hitMesh);
            } else {
                clickables.push(mesh);
            }
    
            mesh.userData = { ...data, isInteractable: true };
            mesh.userData.baseVisualScale = getBodyBaseScale(data);
            mesh.scale.copy(mesh.userData.baseVisualScale);
            addHaumeaRing(mesh, data);
    
            // 2. Orbital System (Decouples planet spin from moon orbits)
            const systemGroup = new THREE.Group();
            scene.add(systemGroup);
            systemGroup.add(mesh); // Planet spins inside this group
    
            // Set initial distance
            systemGroup.position.x = data.distance;
    
            // 3. Rings
            if (data.rings) {
                if (data.id !== 'saturn') {
                    const ringGeo = new THREE.RingGeometry(data.rings.inner, data.rings.outer, 64);
                    const ringMat = createRingMaterial(data);
                    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                    tiltRingMesh(ringMesh, data);
                    mesh.add(ringMesh);
                }
                addRingBandDetails(mesh, data);
            }
    
            // 4. Moons
            if (data.moons) {
                data.moons.forEach(moonData => {
                    const mGeo = new THREE.SphereGeometry(moonData.radius, 16, 16);
                    const mMat = createBodyMaterial(moonData);
                    const mMesh = new THREE.Mesh(mGeo, mMat);
                    addAtmosphere(mMesh, moonData);
    
                    // Add an invisible hitbox since the moon is very small.
                    const hitGeo = new THREE.SphereGeometry(getMoonHitboxRadius(moonData, data), 16, 16);
                    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
                    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
                    mMesh.add(hitMesh);
                    hitMesh.userData = { id: moonData.id, isClickTarget: true, parentMesh: mMesh };
                    clickables.push(hitMesh);
    
                    mMesh.userData = { ...moonData, isInteractable: true };
                    mMesh.userData.baseVisualScale = getBodyBaseScale(moonData);
                    mMesh.scale.copy(mMesh.userData.baseVisualScale);
    
                    const mOrbit = new THREE.Group();
                    systemGroup.add(mOrbit); // Moon orbits the planet's center, NOT the spinning planet surface!
                    mOrbit.add(mMesh);
                    mMesh.position.x = moonData.distance;
    
                    // Moons orbit their planet
                    bodies.push({
                        mesh: mMesh,
                        orbitGroup: mOrbit,
                        speed: moonData.speed,
                        angle: Math.random() * Math.PI * 2,
                        isMoon: true
                    });
                });
            }
    
            // 5. Orbital Path Line
            if (data.distance > 0) {
                const pathGeo = new THREE.RingGeometry(data.distance - 0.045, data.distance + 0.045, 160);
                const pathMat = new THREE.MeshBasicMaterial({
                    color: 0x9bc7ff,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.075,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                const pathMesh = new THREE.Mesh(pathGeo, pathMat);
                pathMesh.rotation.x = Math.PI / 2;
                pathMesh.userData.baseOpacity = pathMat.opacity;
                visualState.orbitPaths.push(pathMesh);
                scene.add(pathMesh);
            }
    
            // 6. Store for animation
            bodies.push({
                mesh: mesh,
                systemGroup: systemGroup, // We store the whole system to move it together
                data: data,
                angle: Math.random() * Math.PI * 2, // Random starting position
                axialSpin: data.id === 'uranus' ? Math.random() * Math.PI * 2 : 0
            });
    
            // Add a glow effect to the sun
            if (data.type === 'Star') {
                addSunGlow(mesh, data);
            }
        });
    }
    
    // --- 5. INTERACTION LOGIC ---
    function completeIntro() {
        if (isIntroComplete) return;
        isIntroComplete = true;

        const titlePanel = document.getElementById('main-title-panel');
        if (titlePanel) {
            titlePanel.classList.remove('p-4');
            titlePanel.classList.add('p-2');
        }

        const titleText = document.getElementById('main-title-text');
        if (titleText) {
            titleText.classList.remove('text-2xl', 'md:text-4xl');
            titleText.classList.add('text-xl');
        }

        const titleSub = document.getElementById('main-title-sub');
        if (titleSub) {
            titleSub.style.display = 'none';
        }

        const hint = document.getElementById('tutorial-hint');
        if (hint) hint.style.opacity = '0';
    }

    function onPointerClick(event) {
        if (isDragging) return; // Don't click if user was just panning the camera
    
        // Shrink title after first click interaction
        completeIntro();
    
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(clickables);
    
        if (intersects.length > 0) {
            let object = intersects[0].object;
    
            // If we clicked the invisible hit box, get its parent (the actual planet)
            if (object.userData.isClickTarget) {
                object = object.userData.parentMesh;
            }
    
            selectBody(object);
        }
    }
    
    function selectBody(mesh) {
        completeIntro();
        controls.autoRotate = false; // Stop auto rotation if user clicks something
        const data = mesh.userData;
        if (!data || !data.isInteractable) return;
    
        // Find the animation object corresponding to this mesh
        selectedBody = bodies.find(b => b.mesh === mesh);
    
        // Update UI
        document.getElementById('info-emoji').innerText = data.emoji;
        document.getElementById('info-title').innerText = data.name;
        document.getElementById('info-title').style.color = '#' + data.color.toString(16).padStart(6, '0');
        document.getElementById('info-type').innerText = explorerCopy.typeLabels[data.type] || data.type;
    
        activeInfoBodyName = data.name;
        activeInfoCards = Array.isArray(data.cards) ? data.cards : [];
        activeInfoCardIndex = 0;
        isFactCardAnimating = false;
        renderFactCard(activeInfoCardIndex, true, 0);
        setPassportPanelVisibility(true);
    
        // Show Panel
        const panel = document.getElementById('info-panel');
        panel.classList.remove('hidden');
        // Small delay to allow display block to apply before animating opacity
        setTimeout(() => {
            panel.classList.remove('translate-y-10', 'opacity-0');
        }, 10);
    
        // Handle Passport
        if (!visitedBodies.has(data.id)) {
            visitedBodies.add(data.id);
            saveVisitedBodies();
            updatePassportUI();
        }
    }

    function selectBodyById(bodyId) {
        const target = bodies.find(body => body.mesh && body.mesh.userData && body.mesh.userData.id === bodyId);
        if (target) {
            selectBody(target.mesh);
        }
    }

    function frameBodyForPreview(bodyId) {
        const target = bodies.find(body => body.mesh && body.mesh.userData && body.mesh.userData.id === bodyId);
        if (!target || !target.mesh) return false;

        const targetPos = new THREE.Vector3();
        target.mesh.getWorldPosition(targetPos);
        const radius = target.mesh.userData.radius || 1;
        let direction = new THREE.Vector3(1.4, 0.72, 1.85).normalize();

        if (bodyId === 'moon') {
            const earth = bodies.find(body => body.mesh && body.mesh.userData && body.mesh.userData.id === 'earth');
            if (earth && earth.mesh) {
                const earthPos = new THREE.Vector3();
                earth.mesh.getWorldPosition(earthPos);
                const outward = targetPos.clone().sub(earthPos).normalize();
                direction = new THREE.Vector3(-outward.z, 0.36, outward.x).normalize();
            }
        }

        const cameraOffset = direction.multiplyScalar(Math.max(radius * 6.6, bodyId === 'moon' ? 1.55 : 2.35));
        camera.position.copy(targetPos).add(cameraOffset);
        controls.target.copy(targetPos);
        controls.update();
        renderer.render(scene, camera);
        return true;
    }

    function getBodyRenderDebug(bodyId) {
        const target = bodies.find(body => body.mesh && body.mesh.userData && body.mesh.userData.id === bodyId);
        if (!target || !target.mesh) return null;

        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        target.mesh.getWorldPosition(position);
        target.mesh.getWorldQuaternion(quaternion);

        const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
        const sunDirection = position.clone().multiplyScalar(-1);
        if (sunDirection.lengthSq() > 0.000001) {
            sunDirection.normalize();
        }

        return {
            id: bodyId,
            position: { x: position.x, y: position.y, z: position.z },
            pole: { x: pole.x, y: pole.y, z: pole.z },
            sunDirection: { x: sunDirection.x, y: sunDirection.y, z: sunDirection.z },
            poleDotSun: pole.dot(sunDirection)
        };
    }
    
    function buildFactCardElement(card) {
        const cardDiv = document.createElement('article');
        cardDiv.className = 'fact-card-panel';
    
        let mediaHtml = '';
        if (card.image) {
            mediaHtml = `<img src="${card.image}" class="object-cover rounded-xl mb-3 shadow-md border border-white/5 bg-black mx-auto" style="aspect-ratio: 1 / 1; width: min(100%, 14rem);" alt="${explorerCopy.factImageAlt(activeInfoBodyName)}" loading="lazy" onerror="this.style.display='none'" />`;
        }
    
        cardDiv.innerHTML = `
            ${mediaHtml}
            <p class="text-sm leading-relaxed text-gray-200">${card.fact || ''}</p>
        `;
    
        return cardDiv;
    }
    
    function updateFactCardControls() {
        const prevBtn = document.getElementById('fact-prev-btn');
        const nextBtn = document.getElementById('fact-next-btn');
        const progress = document.getElementById('fact-card-progress');
        const dots = document.getElementById('fact-card-dots');
        const total = activeInfoCards.length;
        const hasMany = total > 1;
    
        prevBtn.disabled = !hasMany || isFactCardAnimating;
        nextBtn.disabled = !hasMany || isFactCardAnimating;
        progress.innerText = total ? explorerCopy.cardProgress(activeInfoCardIndex + 1, total) : explorerCopy.cardProgressEmpty;
        dots.innerHTML = '';
    
        for (let i = 0; i < total; i++) {
            const dot = document.createElement('span');
            dot.className = `fact-dot ${i === activeInfoCardIndex ? 'active' : ''}`;
            dots.appendChild(dot);
        }
    }
    
    function renderFactCard(newIndex, immediate = false, direction = 0) {
        const stage = document.getElementById('fact-card-stage');
        if (!stage) return;
    
        const total = activeInfoCards.length;
        if (total === 0) {
            stage.innerHTML = `<div class="fact-card-panel"><p class="text-sm leading-relaxed text-gray-200">${explorerCopy.emptyCardText}</p></div>`;
            updateFactCardControls();
            return;
        }
    
        activeInfoCardIndex = Math.max(0, Math.min(newIndex, total - 1));
        const nextCard = buildFactCardElement(activeInfoCards[activeInfoCardIndex]);
        const currentCard = stage.firstElementChild;
    
        if (immediate || !currentCard) {
            stage.innerHTML = '';
            stage.appendChild(nextCard);
            isFactCardAnimating = false;
            updateFactCardControls();
            return;
        }
    
        isFactCardAnimating = true;
        updateFactCardControls();
    
        if (direction >= 0) {
            currentCard.classList.add('fact-card-leave-left');
            nextCard.classList.add('fact-card-enter-right');
        } else {
            currentCard.classList.add('fact-card-leave-right');
            nextCard.classList.add('fact-card-enter-left');
        }
    
        stage.appendChild(nextCard);
    
        const finishAnimation = () => {
            if (currentCard && currentCard.parentNode === stage) {
                stage.removeChild(currentCard);
            }
            nextCard.classList.remove('fact-card-enter-right', 'fact-card-enter-left');
            isFactCardAnimating = false;
            updateFactCardControls();
        };
    
        nextCard.addEventListener('animationend', finishAnimation, { once: true });
    }
    
    function changeFactCard(delta) {
        const total = activeInfoCards.length;
        if (isFactCardAnimating || total <= 1) return;
        const next = (activeInfoCardIndex + delta + total) % total;
        renderFactCard(next, false, delta >= 0 ? 1 : -1);
    }
    
    function closeInfoPanel() {
        const panel = document.getElementById('info-panel');
        if (!panel || panel.classList.contains('hidden')) return;
        panel.classList.add('translate-y-10', 'opacity-0');
        schedulePassportPanelVisibility(false, 300);
        setTimeout(() => {
            panel.classList.add('hidden');
        }, 300); // match transition duration
    }
    
    function resetCamera() {
        selectedBody = null;
        closeInfoPanel();
    
        // Animate camera back to overview
        // Since we're in a simple setup without an animation library like GSAP, 
        // we'll just snap it to a nice overview and let OrbitControls smooth the target
        camera.position.set(0, 100, 150);
        controls.target.set(0, 0, 0);
    }
    
    function setSpeed(mult) {
        timeSpeed = mult;
    }
    
    function setPassportPanelVisibility(hidden) {
        if (passportReopenTimeout) {
            clearTimeout(passportReopenTimeout);
            passportReopenTimeout = null;
        }
    
        const passportPanel = document.getElementById('passport-panel');
        if (!passportPanel) return;
        passportPanel.style.display = hidden ? 'none' : 'flex';
    }
    
    function schedulePassportPanelVisibility(hidden, delayMs) {
        if (passportReopenTimeout) {
            clearTimeout(passportReopenTimeout);
        }
    
        passportReopenTimeout = setTimeout(() => {
            const passportPanel = document.getElementById('passport-panel');
            if (passportPanel) {
                passportPanel.style.display = hidden ? 'none' : 'flex';
            }
            passportReopenTimeout = null;
        }, delayMs);
    }
    
    // --- 6. UI MANAGEMENT & API LOGIC ---
    function togglePassport() {
        isPassportMinimized = !isPassportMinimized;
        const grid = document.getElementById('passport-grid');
        const btn = document.getElementById('passport-toggle-btn');
    
        if (isPassportMinimized) {
            grid.style.display = 'none';
            btn.innerText = '➕';
            btn.title = explorerCopy.passportToggleCollapsed;
        } else {
            grid.style.display = 'grid';
            btn.innerText = '➖';
            btn.title = explorerCopy.passportToggleExpanded;
        }
    }

    function handleGlobalKeydown(event) {
        if (event.key === 'Escape') {
            resetCamera();
            return;
        }

        if (event.key === 'ArrowLeft') {
            changeFactCard(-1);
        } else if (event.key === 'ArrowRight') {
            changeFactCard(1);
        }
    }
    
    function initPassportUI() {
        const grid = document.getElementById('passport-grid');
        const allBodies = getAllBodies();
        allBodies.forEach(data => {
            const el = document.createElement('button');
            el.id = `passport-${data.id}`;
            el.type = 'button';
            resetPassportButton(el, data);
            el.addEventListener('click', () => selectBodyById(data.id));
            grid.appendChild(el);
        });
    }
    
    function updatePassportUI(allowWinCelebration = true) {
        const allBodies = getAllBodies();
        const progressText = document.getElementById('progress-text');
        progressText.innerText = `${visitedBodies.size}/${allBodies.length}`;
    
        visitedBodies.forEach(id => {
            const el = document.getElementById(`passport-${id}`);
            if (el && el.innerHTML === '?') {
                // Find emoji
                const data = allBodies.find(d => d.id === id);
                el.innerHTML = data.emoji;
                el.title = data.name;
                el.classList.remove('opacity-50', 'grayscale', 'border-gray-600');
                el.classList.add('border-green-400', 'bg-green-900', 'animate-pulse');
    
                // Stop pulse after a moment
                setTimeout(() => el.classList.remove('animate-pulse'), 2000);
            }
        });
    
        // Check Win Condition
        if (allowWinCelebration && visitedBodies.size === allBodies.length && !hasTriggeredWinCelebration) {
            hasTriggeredWinCelebration = true;
            triggerWinCelebration();
        }
    }
    
    function triggerWinCelebration() {
        // Wait a brief moment after the last click
        setTimeout(() => {
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 150,
                    spread: 100,
                    origin: { y: 0.6 },
                    colors: ['#ffcc00', '#ff0000', '#00ff00', '#0000ff', '#ffffff']
                });
            }
    
            // Create a temporary grand popup
            const winDiv = document.createElement('div');
            winDiv.className = 'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-indigo-900 to-purple-900 border-4 border-yellow-400 rounded-3xl p-8 text-center z-50 shadow-2xl glass-panel';
            winDiv.innerHTML = `
                <div class="text-6xl mb-4">🏆👨‍🚀👩‍🚀🏆</div>
                <h2 class="text-4xl text-yellow-300 font-bold mb-2 kid-font">${explorerCopy.winTitle}</h2>
                <p class="text-xl text-white">${explorerCopy.winMessage}</p>
                <button onclick="this.parentElement.remove()" class="mt-6 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-8 rounded-full text-xl shadow-lg transition">${explorerCopy.winButton}</button>
            `;
            document.body.appendChild(winDiv);
        }, 500);
    }
    
    // --- 7. ANIMATION LOOP ---
    function stepScene() {
        visualState.clock += 1 / 60;

        visualState.starfields.forEach(layer => {
            layer.rotation.y += layer.userData.drift;
            layer.rotation.x += layer.userData.drift * 0.28;
        });

        visualState.beltLayers.forEach(layer => {
            layer.rotation.y += layer.userData.drift;
        });

        visualState.orbitPaths.forEach((pathMesh, index) => {
            pathMesh.material.opacity = pathMesh.userData.baseOpacity + Math.sin(visualState.clock * 0.9 + index * 0.37) * 0.018;
        });

        visualState.sunGlowLayers.forEach((glow, index) => {
            glow.material.opacity = glow.userData.baseOpacity + Math.sin(visualState.clock * 1.8 + index) * glow.userData.baseOpacity * 0.22;
            if ('rotation' in glow.material) {
                glow.material.rotation += 0.0015 + index * 0.0007;
            } else {
                glow.rotation.y += 0.0015 + index * 0.0007;
            }
        });

        visualState.earthCloudLayers.forEach(layer => {
            layer.rotation.y += 0.0028 + timeSpeed * 0.004;
            layer.rotation.x = Math.sin(visualState.clock * 0.22) * 0.018;
        });

        visualState.bodyDetailLayers.forEach(({ mesh, drift }) => {
            mesh.rotation.z += drift * Math.max(0.35, timeSpeed);
        });

        // Update orbits and rotations
        bodies.forEach(b => {
            // Determine speed correctly depending on if it's a moon or planet
            const speed = b.isMoon ? b.speed : (b.data ? b.data.speed : 0);
            const sunPulse = b.data && b.data.type === 'Star'
                ? 1 + Math.sin(visualState.clock * 1.35) * 0.012
                : 1;
            const selectedScale = selectedBody && selectedBody.mesh === b.mesh
                ? 1 + Math.sin(visualState.clock * 3.2) * 0.035
                : 1;
            const bodyScale = sunPulse * selectedScale;
            const baseVisualScale = b.mesh.userData.baseVisualScale || { x: 1, y: 1, z: 1 };
            b.mesh.scale.set(
                baseVisualScale.x * bodyScale,
                baseVisualScale.y * bodyScale,
                baseVisualScale.z * bodyScale
            );
            if (b.mesh.material && 'emissiveIntensity' in b.mesh.material) {
                const baseEmissive = b.mesh.material.userData.baseEmissiveIntensity || 0;
                b.mesh.material.emissiveIntensity = selectedBody && selectedBody.mesh === b.mesh
                    ? baseEmissive + 0.12
                    : baseEmissive;
            }
    
            if (speed) {
                b.angle -= speed * timeSpeed;
    
                if (b.isMoon) {
                    // Moon orbits its parent's center
                    b.orbitGroup.rotation.y = b.angle;
                    b.mesh.rotation.y += 0.01 * timeSpeed; // Moon rotates on its own axis
                } else {
                    // Planet system orbits the sun
                    b.systemGroup.position.x = Math.cos(b.angle) * b.data.distance;
                    b.systemGroup.position.z = Math.sin(b.angle) * b.data.distance;
                    if (!applySunFacingPoleOrientation(b, 0.01 * timeSpeed)) {
                        b.mesh.rotation.y += 0.01 * timeSpeed; // Planet rotates on its own axis
                    }
                }
            } else if (b.data && b.data.type === 'Star') {
                // Allow the Sun to slowly spin
                b.mesh.rotation.y += 0.005 * timeSpeed;
            }
        });
    
        // If a body is selected, add only local lighting. Camera navigation stays user-controlled.
        if (selectedBody && selectedBody.mesh) {
            const targetPos = new THREE.Vector3();
            selectedBody.mesh.getWorldPosition(targetPos);
            const radius = selectedBody.mesh.userData.radius || 1;

            if (visualState.focusLight) {
                visualState.focusLight.visible = true;
                visualState.focusLight.position.copy(targetPos).add(new THREE.Vector3(radius * 2.2, radius * 3.4, radius * 2.2));
                visualState.focusLight.intensity = 1.3 + Math.sin(visualState.clock * 2) * 0.18;
            }
        } else {
            if (visualState.focusLight) {
                visualState.focusLight.visible = false;
            }
        }

        controls.update();
    
        renderer.render(scene, camera);
    }

    function animate() {
        requestAnimationFrame(animate);
        stepScene();
    }
    
    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    window.render_game_to_text = renderGameToText;
    window.advanceTime = (ms) => {
        const frames = Math.max(1, Math.round(ms / (1000 / 60)));
        for (let i = 0; i < frames; i += 1) {
            stepScene();
        }
    };
    Object.assign(window, {
        changeFactCard,
        closeInfoPanel,
        leaveExplorer,
        resetCamera,
        frameBodyForPreview,
        getBodyRenderDebug,
        selectBodyById,
        setSpeed,
        togglePassport
    });

    // Boot up the universe!
    init();
})();
