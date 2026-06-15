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
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;
    const mouseDragThreshold = 8;
    const touchDragThreshold = 24;
    let activePointerId = null;
    let activePointerType = 'mouse';
    let pointerDownX = 0;
    let pointerDownY = 0;

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
    
    // --- 3. INITIALIZATION ---
    function init() {
        // Scene Setup
        const container = document.getElementById('canvas-container');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020208); // Deep space dark blue/black
    
        // Camera Setup
        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
        camera.position.set(0, 80, 100);
    
        // Renderer Setup
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // optimize performance
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute('role', 'application');
        renderer.domElement.setAttribute('aria-label', explorerCopy.sceneLabel);
        container.appendChild(renderer.domElement);
    
        // Controls Setup
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxDistance = 300;
        controls.minDistance = 10;
        controls.autoRotate = true; // Gentle rotation before interaction
        controls.autoRotateSpeed = 0.1;
    
        // Lights Setup
        const ambientLight = new THREE.AmbientLight(0x333333); // Dim background light
        scene.add(ambientLight);
    
        const sunLight = new THREE.PointLight(0xffffff, 2.5, 300); // Light coming from the sun
        scene.add(sunLight);
    
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
        const starsGeo = new THREE.BufferGeometry();
        const starsPos = [];
        for (let i = 0; i < 3000; i++) {
            // Scatter stars in a large sphere
            const r = 300 + Math.random() * 400;
            const theta = Math.random() * 2 * Math.PI;
            const phi = Math.acos(2 * Math.random() - 1);
    
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            starsPos.push(x, y, z);
        }
        starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starsPos, 3));
    
        // Create a custom shader or just basic points with tiny sizes
        const starsMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.6,
            transparent: true,
            opacity: 0.8
        });
    
        const starMesh = new THREE.Points(starsGeo, starsMat);
        scene.add(starMesh);
    }
    
    function createBelts() {
        // Asteroid Belt (Between Mars and Jupiter)
        createParticleRing(36, 46, 3000, 0x888888, 0.15);
        // Kuiper Belt (Beyond Neptune)
        createParticleRing(115, 170, 5000, 0xaaccff, 0.2);
    }
    
    function createParticleRing(innerRadius, outerRadius, count, colorHex, size) {
        const geo = new THREE.BufferGeometry();
        const pos = [];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = innerRadius + Math.pow(Math.random(), 1.5) * (outerRadius - innerRadius);
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            // Add some slight vertical thickness
            const y = (Math.random() - 0.5) * 3 * (1 - Math.abs(r - (innerRadius + outerRadius) / 2) / ((outerRadius - innerRadius) / 2));
            pos.push(x, y, z);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: colorHex, size: size, transparent: true, opacity: 0.6 });
        const particles = new THREE.Points(geo, mat);
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
            let mat;
    
            if (data.type === 'Star') {
                // Sun is self-illuminating
                mat = new THREE.MeshBasicMaterial({ color: data.color });
            } else {
                // Planets react to light
                mat = new THREE.MeshStandardMaterial({
                    color: data.color,
                    roughness: 0.6,
                    metalness: 0.1
                });
            }
    
            const mesh = new THREE.Mesh(geo, mat);
    
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
                    opacity: data.rings.opacity || 0.8
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
                    const mMat = new THREE.MeshStandardMaterial({ color: moonData.color });
                    const mMesh = new THREE.Mesh(mGeo, mMat);
    
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
                const pathGeo = new THREE.RingGeometry(data.distance - 0.1, data.distance + 0.1, 128);
                const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.05 });
                const pathMesh = new THREE.Mesh(pathGeo, pathMat);
                pathMesh.rotation.x = Math.PI / 2;
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
                const glowGeo = new THREE.SphereGeometry(data.radius * 1.2, 32, 32);
                const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });
                const glowMesh = new THREE.Mesh(glowGeo, glowMat);
                mesh.add(glowMesh);
            }
        });
    }
    
    // --- 5. INTERACTION LOGIC ---
    function onPointerClick(event) {
        if (isDragging) return; // Don't click if user was just panning the camera
    
        // Shrink title after first click interaction
        if (!isIntroComplete) {
            isIntroComplete = true;
            const titlePanel = document.getElementById('main-title-panel');
            titlePanel.classList.remove('p-4');
            titlePanel.classList.add('p-2');
    
            const titleText = document.getElementById('main-title-text');
            titleText.classList.remove('text-2xl', 'md:text-4xl');
            titleText.classList.add('text-xl');
    
            const titleSub = document.getElementById('main-title-sub');
            titleSub.style.display = 'none';
        }
    
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
        // Update orbits and rotations
        bodies.forEach(b => {
            // Determine speed correctly depending on if it's a moon or planet
            const speed = b.isMoon ? b.speed : (b.data ? b.data.speed : 0);
    
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
            // Smooth interpolation (lerp) towards the planet
            controls.target.lerp(targetPos, 0.1);
        } else if (controls.autoRotate) {
            controls.update(); // only update autorotate if no planet is selected
        } else {
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
