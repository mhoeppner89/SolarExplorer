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
        selectionHalo: null,
        selectionRing: null,
        selectedOrbitPath: null,
        focusLight: null,
        scratchVector: null,
        scratchColor: null
    };

    function getValidBodyIds() {
        return new Set(getAllBodies().map(body => body.id));
    }

    function loadVisitedBodies() {
        try {
            const saved = JSON.parse(localStorage.getItem(explorerCopy.storageKey) || '[]');
            const validIds = getValidBodyIds();
            visitedBodies = new Set(Array.isArray(saved) ? saved.filter(id => validIds.has(id)) : []);
            hasTriggeredWinCelebration = visitedBodies.size === validIds.size;
        } catch (error) {
            visitedBodies = new Set();
        }
    }

    function saveVisitedBodies() {
        try {
            localStorage.setItem(explorerCopy.storageKey, JSON.stringify([...visitedBodies]));
        } catch (error) {
            // Storage can be unavailable in private or restricted browser contexts.
        }
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

    function createBodyTexture(data, preset) {
        const cacheKey = `${data.id}:${preset.bands ? 'bands' : 'noise'}`;
        if (textureCache.has(cacheKey)) {
            return textureCache.get(cacheKey);
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
        } else if (data.id === 'earth') {
            ctx.globalAlpha = 0.86;
            ctx.fillStyle = '#3fa66e';
            for (let i = 0; i < 12; i += 1) {
                const x = Math.random() * canvas.width;
                const y = 18 + Math.random() * 88;
                ctx.beginPath();
                ctx.ellipse(x, y, 10 + Math.random() * 24, 4 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 0.42;
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 16; i += 1) {
                ctx.beginPath();
                ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 10 + Math.random() * 18, 2 + Math.random() * 5, Math.random() * Math.PI, 0, Math.PI * 2);
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
            return new THREE.MeshBasicMaterial({
                color: preset.color || data.color,
                map: createBodyTexture(data, { ...preset, bands: [0xffd978, 0xffab33, 0xffecaa, 0xf77d22] })
            });
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

    function createSelectionHalo() {
        visualState.selectionHalo = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 32),
            new THREE.MeshBasicMaterial({
                color: 0x9edcff,
                transparent: true,
                opacity: 0,
                side: THREE.BackSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        visualState.selectionHalo.visible = false;
        scene.add(visualState.selectionHalo);

        visualState.selectionRing = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.018, 8, 96),
            new THREE.MeshBasicMaterial({
                color: 0xf7d77a,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        visualState.selectionRing.visible = false;
        scene.add(visualState.selectionRing);
    }

    function addSunGlow(mesh, data) {
        const layers = [
            { scale: 1.35, color: 0xffcf6a, opacity: 0.24 },
            { scale: 1.8, color: 0xff9f36, opacity: 0.12 },
            { scale: 2.4, color: 0xffdf9a, opacity: 0.06 }
        ];

        layers.forEach(layer => {
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(data.radius * layer.scale, 48, 48),
                new THREE.MeshBasicMaterial({
                    color: layer.color,
                    transparent: true,
                    opacity: layer.opacity,
                    side: THREE.BackSide,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                })
            );
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
        createSelectionHalo();
        createSolarSystem();
        loadVisitedBodies();
        initPassportUI();
        updatePassportUI(false);

        // Event Listeners
        window.addEventListener('resize', onWindowResize);
        window.addEventListener('keydown', handleGlobalKeydown);
    
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
    
            // 2. Orbital System (Decouples planet spin from moon orbits)
            const systemGroup = new THREE.Group();
            scene.add(systemGroup);
            systemGroup.add(mesh); // Planet spins inside this group
    
            // Set initial distance
            systemGroup.position.x = data.distance;
    
            // 3. Rings
            if (data.rings) {
                const ringGeo = new THREE.RingGeometry(data.rings.inner, data.rings.outer, 64);
                const ringMat = new THREE.MeshStandardMaterial({
                    color: data.rings.color,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: data.rings.opacity || 0.72,
                    roughness: 0.62,
                    metalness: 0.08
                });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                // Tilt the rings
                ringMesh.rotation.x = Math.PI / 2 + 0.3;
                ringMesh.rotation.y = 0.1;
                mesh.add(ringMesh);
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
                angle: Math.random() * Math.PI * 2 // Random starting position
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
        titlePanel.classList.remove('p-4');
        titlePanel.classList.add('p-2');

        const titleText = document.getElementById('main-title-text');
        titleText.classList.remove('text-2xl', 'md:text-4xl');
        titleText.classList.add('text-xl');

        const titleSub = document.getElementById('main-title-sub');
        titleSub.style.display = 'none';

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
            el.className = 'w-7 h-7 md:w-12 md:h-12 bg-gray-800 border border-gray-600 md:border-2 rounded-lg md:rounded-xl flex items-center justify-center text-sm md:text-2xl transition-all duration-500 opacity-50 grayscale cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-300';
            el.innerHTML = '?';
            el.title = explorerCopy.passportLockedTitle;
            el.setAttribute('aria-label', `${explorerCopy.selectBodyLabel}: ${data.name}`);
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
            glow.rotation.y += 0.0015 + index * 0.0007;
        });

        // Update orbits and rotations
        bodies.forEach(b => {
            // Determine speed correctly depending on if it's a moon or planet
            const speed = b.isMoon ? b.speed : (b.data ? b.data.speed : 0);
            const selectedScale = selectedBody && selectedBody.mesh === b.mesh
                ? 1 + Math.sin(visualState.clock * 3.2) * 0.035
                : 1;
            b.mesh.scale.setScalar(selectedScale);
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
                    b.mesh.rotation.y += 0.01 * timeSpeed; // Planet rotates on its own axis
                }
            } else if (b.data && b.data.type === 'Star') {
                // Allow the Sun to slowly spin
                b.mesh.rotation.y += 0.005 * timeSpeed;
            }
        });
    
        // If a body is selected, smoothly move the camera target to follow it
        if (selectedBody && selectedBody.mesh) {
            const targetPos = new THREE.Vector3();
            selectedBody.mesh.getWorldPosition(targetPos);
            const radius = selectedBody.mesh.userData.radius || 1;

            if (visualState.selectionHalo && visualState.selectionRing) {
                const haloScale = radius * (2.25 + Math.sin(visualState.clock * 2.4) * 0.1);
                visualState.selectionHalo.visible = true;
                visualState.selectionHalo.position.copy(targetPos);
                visualState.selectionHalo.scale.setScalar(haloScale);
                visualState.selectionHalo.material.opacity = 0.08 + Math.sin(visualState.clock * 2.4) * 0.02;

                visualState.selectionRing.visible = true;
                visualState.selectionRing.position.copy(targetPos);
                visualState.selectionRing.scale.setScalar(radius * 2.55);
                visualState.selectionRing.rotation.x = Math.PI / 2 + Math.sin(visualState.clock * 0.8) * 0.22;
                visualState.selectionRing.rotation.z += 0.018;
                visualState.selectionRing.material.opacity = 0.42;
            }

            if (visualState.focusLight) {
                visualState.focusLight.visible = true;
                visualState.focusLight.position.copy(targetPos).add(new THREE.Vector3(radius * 2.2, radius * 3.4, radius * 2.2));
                visualState.focusLight.intensity = 1.3 + Math.sin(visualState.clock * 2) * 0.18;
            }

            // Smooth interpolation (lerp) towards the planet
            controls.target.lerp(targetPos, 0.1);

            const cameraDirection = camera.position.clone().sub(targetPos);
            if (cameraDirection.lengthSq() < 0.001) {
                cameraDirection.set(1, 0.5, 1);
            }
            cameraDirection.normalize();
            const desiredDistance = Math.min(58, Math.max(10, radius * 6.8));
            const desiredCamera = targetPos.clone()
                .add(cameraDirection.multiplyScalar(desiredDistance))
                .add(new THREE.Vector3(0, radius * 1.35, 0));
            camera.position.lerp(desiredCamera, 0.06);
            controls.update();
        } else if (controls.autoRotate) {
            if (visualState.selectionHalo && visualState.selectionRing) {
                visualState.selectionHalo.visible = false;
                visualState.selectionRing.visible = false;
            }
            if (visualState.focusLight) {
                visualState.focusLight.visible = false;
            }
            controls.update(); // only update autorotate if no planet is selected
        } else {
            if (visualState.selectionHalo && visualState.selectionRing) {
                visualState.selectionHalo.visible = false;
                visualState.selectionRing.visible = false;
            }
            if (visualState.focusLight) {
                visualState.focusLight.visible = false;
            }
            controls.update(); // normal damping
        }
    
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
        resetCamera,
        selectBodyById,
        setSpeed,
        togglePassport
    });

    // Boot up the universe!
    init();
})();
