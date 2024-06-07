import * as THREE from 'three';
import Papa from 'papaparse';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as d3 from 'd3';

let scene, camera, renderer, controls, starMesh;
let octree;
let starDataWithParams = [];
let starSize = 0.1;
let maxStars = 10000;
let distanceScalingFactor = 1000;
let totalStarsParsed = 0;
let starsLoaded = 0;
let axesHelper, colorEnabled = true, radiusEnabled = true;

const maxDistance = 10000;

class Box {
    constructor(x, y, z, width, height, depth) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.width = width / 2;
        this.height = height / 2;
        this.depth = depth / 2;
    }

    contains(point) {
        return (
            point.x >= this.x - this.width && point.x <= this.x + this.width &&
            point.y >= this.y - this.height && point.y <= this.y + this.height &&
            point.z >= this.z - this.depth && point.z <= this.z + this.depth
        );
    }

    intersects(range) {
        return !(
            range.x - range.width > this.x + this.width || range.x + range.width < this.x - this.width ||
            range.y - range.height > this.y + this.height || range.y + range.height < this.y - this.height ||
            range.z - range.depth > this.z + this.depth || range.z + range.depth < this.z - this.depth
        );
    }
}

class Octree {
    constructor(boundary, capacity, level = 0, maxLevel = 4) {
        this.boundary = boundary;
        this.capacity = capacity;
        this.points = [];
        this.divided = false;
        this.level = level;
        this.maxLevel = maxLevel;
    }

    subdivide() {
        const { x, y, z, width, height, depth } = this.boundary;
        const w2 = width / 2;
        const h2 = height / 2;
        const d2 = depth / 2;
        const boxes = [
            new Box(x - w2, y - h2, z - d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x + w2, y - h2, z - d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x - w2, y + h2, z - d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x + w2, y + h2, z - d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x - w2, y - h2, z + d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x + w2, y - h2, z + d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x - w2, y + h2, z + d2, w2 * 2, h2 * 2, d2 * 2),
            new Box(x + w2, y + h2, z + d2, w2 * 2, h2 * 2, d2 * 2)
        ];
        this.children = boxes.map(box => new Octree(box, this.capacity, this.level + 1, this.maxLevel));
        this.divided = true;
    }

    insert(point) {
        if (!this.boundary.contains(point)) {
            return false;
        }
        if (this.points.length < this.capacity || this.level >= this.maxLevel) {
            this.points.push(point);
            return true;
        } else {
            if (!this.divided) {
                this.subdivide();
            }
            for (let child of this.children) {
                if (child.insert(point)) {
                    return true;
                }
            }
        }
        return false;
    }

    query(range, found = []) {
        if (!this.boundary.intersects(range)) {
            return found;
        }
        for (let p of this.points) {
            if (range.contains(p)) {
                found.push(p);
            }
        }
        if (this.divided) {
            for (let child of this.children) {
                child.query(range, found);
            }
        }
        return found;
    }
}

const colorScale = d3.scaleSequential(d3.interpolateSpectral)
    .domain([-0.4, 2.0]);

function getColorFromBP_RP(bpRp) {
    const color = new THREE.Color(colorScale(bpRp));
    return color;
}

function createStarInstancedMesh(stars) {
    const starGeometry = new THREE.SphereGeometry(1, 16, 16);
    const starMaterial = new THREE.ShaderMaterial({
        vertexShader: `
            attribute vec3 instanceColor;
            varying vec3 vColor;
            void main() {
                vColor = instanceColor;
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor, 1.0);
            }
        `
    });

    const instancedMesh = new THREE.InstancedMesh(starGeometry, starMaterial, stars.length);
    const colorAttribute = new Float32Array(stars.length * 3);
    const dummy = new THREE.Object3D();

    stars.forEach((star, index) => {
        const color = colorEnabled ? getColorFromBP_RP(parseFloat(star.params['BP-RP'])) : new THREE.Color(0xffffff);
        color.toArray(colorAttribute, index * 3);

        const radius = radiusEnabled && star.params['Rad'] ? parseFloat(star.params['Rad']) : 1;
        dummy.position.set(star.x, star.y, star.z);
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(index, dummy.matrix);
    });

    instancedMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorAttribute, 3));
    return instancedMesh;
}

function convertRADECtoXYZ(ra, dec, parallax, radius) {
    const distance = parallax > 0 ? 1 / parallax : 1000;
    const scaledDistance = distance * distanceScalingFactor * radius;
    const phi = THREE.MathUtils.degToRad(ra * 15);
    const theta = THREE.MathUtils.degToRad(dec);
    const x = scaledDistance * Math.cos(theta) * Math.cos(phi);
    const y = scaledDistance * Math.cos(theta) * Math.sin(phi);
    const z = scaledDistance * Math.sin(theta);
    return { x, y, z };
}

function parseStarDataExtended(tsvFile, callback) {
    console.log('Starting to parse star data...');
    Papa.parse(tsvFile, {
        download: true,
        header: true,
        delimiter: "\t",
        skipEmptyLines: true,
        step: function (row, parser) {
            if (totalStarsParsed >= maxStars) {
                console.log('Reached max stars:', maxStars);
                parser.abort();
                return;
            }
            const ra = parseFloat(row.data['RA_ICRS']);
            const dec = parseFloat(row.data['DE_ICRS']);
            const parallax = parseFloat(row.data['Plx']) || 0;
            const radius = parseFloat(row.data['Rad solRad']) || 1;
            const xyz = convertRADECtoXYZ(ra, dec, parallax, radius);
            const params = {
                RA_ICRS: row.data['RA_ICRS'] || 'N/A',
                DE_ICRS: row.data['DE_ICRS'] || 'N/A',
                Source: row.data['Source'] || 'N/A',
                Plx: row.data['Plx'] || 'N/A',
                Gmag: row.data['Gmag'] || 'N/A',
                BPmag: row.data['BPmag'] || 'N/A',
                RPmag: row.data['RPmag'] || 'N/A',
                Tefftemp: row.data['Tefftemp'] || 'N/A',
                Lum: parseFloat(row.data['Lum-Flame Lsun']) || 1,
                Rad: radius,
                'BP-RP': parseFloat(row.data['BP-RP']) || 0
            };
            starDataWithParams.push({ ...xyz, params });
            totalStarsParsed++;
        },
        complete: function () {
            console.log(`Total stars parsed: ${totalStarsParsed}`);
            callback(starDataWithParams);
        },
        error: function (error) {
            console.error('Error parsing star data:', error);
        }
    });
}

function displayStarParameters(params) {
    let paramsText = '';
    for (const [key, value] of Object.entries(params)) {
        paramsText += `<strong>${key.replace(/_/g, ' ')}:</strong> ${value}<br>`;
    }
    const starInfoDiv = document.getElementById('starParams');
    starInfoDiv.innerHTML = paramsText;
    document.getElementById('starInfo').style.display = 'block';
}

function onCanvasClick(event) {
    event.preventDefault();
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(starMesh);
    if (intersects.length > 0) {
        const intersection = intersects[0];
        const instanceId = intersection.instanceId;
        if (instanceId !== undefined) {
            const star = starDataWithParams[instanceId];
            displayStarParameters(star.params);
        }
    }
}

function updateVisibleStars() {
    console.log("Updating visible stars...");
    const visibleStars = [];
    const range = new Box(camera.position.x, camera.position.y, camera.position.z, maxDistance, maxDistance, maxDistance);
    const foundPoints = octree.query(range);
    foundPoints.forEach(point => {
        if (camera.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < maxDistance) {
            visibleStars.push(point.star);
        }
    });

    if (starMesh) {
        scene.remove(starMesh);
    }

    starMesh = createStarInstancedMesh(visibleStars);
    scene.add(starMesh);

    console.log(`Visible stars: ${visibleStars.length}`);

    if (visibleStars.length < 1000) {
        checkAndLoadMoreStars();
    }
}

function checkAndLoadMoreStars() {
    console.log("Checking and loading more stars...");
    const additionalStars = maxStars - starsLoaded;
    if (additionalStars > 0) {
        const moreStars = starDataWithParams.slice(starsLoaded, starsLoaded + additionalStars);
        moreStars.forEach(star => {
            const point = { x: star.x, y: star.y, z: star.z, star: star };
            octree.insert(point);
        });
        starsLoaded += additionalStars;
        updateVisibleStars();
    }
}

function init3DScene(starData) {
    console.log('Initializing 3D scene...');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
    camera.position.z = 4000;
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.addEventListener('change', updateVisibleStars);

    const boundary = new Box(0, 0, 0, 200000, 200000, 200000);
    octree = new Octree(boundary, 4);
    starData.forEach(star => {
        const point = { x: star.x, y: star.y, z: star.z, star: star };
        octree.insert(point);
    });
    updateVisibleStars();

    axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('click', onCanvasClick, false);
    animate();
}

function onWindowResize() {
    console.log("Window resized");
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    parseStarDataExtended('/path/to/your/.tsv', init3DScene);
});

document.getElementById('gotoButton').addEventListener('click', () => {
    console.log('Goto button clicked');
    const ra = parseFloat(document.getElementById('inputRA').value);
    const dec = parseFloat(document.getElementById('inputDEC').value);
    const plx = parseFloat(document.getElementById('inputPLX').value);

    if (isNaN(ra) || isNaN(dec) || isNaN(plx)) {
        console.log('Invalid RA, DEC, or PLX value');
        return;
    }

    const x = ra * distanceScalingFactor;
    const y = dec * distanceScalingFactor;
    const z = plx * distanceScalingFactor;

    camera.position.set(x, y, z);
    controls.update();
});

document.getElementById('searchButton').addEventListener('click', () => {
    console.log('Search button clicked');
    const starId = document.getElementById('starIdInput').value;
    const star = starDataWithParams.find(s => s.params.Source === starId);

    if (star) {
        console.log('Star found:', star);
        const { x, y, z } = star;
        camera.position.set(x, y, z);
        controls.update();

        const starInfo = document.getElementById('starInfo');
        starInfo.style.display = 'block';
        starInfo.innerHTML = `
            RA: ${star.params.RA_ICRS}<br>
            DEC: ${star.params.DE_ICRS}<br>
            PLX: ${star.params.Plx}<br>
            Gmag: ${star.params.Gmag}<br>
            BPmag: ${star.params.BPmag}<br>
            RPmag: ${star.params.RPmag}<br>
            Tefftemp: ${star.params.Tefftemp}<br>
            Lum: ${star.params.Lum}<br>
            Rad: ${star.params.Rad}
        `;
    } else {
        console.log('Star not found');
    }
});

document.getElementById('settingsButton').addEventListener('click', () => {
    console.log('Settings button clicked');
    const settingsMenu = document.getElementById('settingsMenu');
    settingsMenu.style.display = settingsMenu.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('axesCheckbox').addEventListener('change', (event) => {
    console.log('Axes checkbox changed');
    axesHelper.visible = event.target.checked;
    console.log("Axes visibility changed:", axesHelper.visible);
});

document.getElementById('colorCheckbox').addEventListener('change', (event) => {
    console.log('Color checkbox changed');
    colorEnabled = event.target.checked;
    console.log("Color enabled changed:", colorEnabled);
    updateVisibleStars();
});

document.getElementById('radiusCheckbox').addEventListener('change', (event) => {
    console.log('Radius checkbox changed');
    radiusEnabled = event.target.checked;
    console.log("Radius enabled changed:", radiusEnabled);
    updateVisibleStars();
});

document.getElementById('distanceSlider').addEventListener('input', (event) => {
    console.log('Distance slider changed');
    distanceScalingFactor = event.target.value;
    console.log("Distance scaling factor changed:", distanceScalingFactor);
    updateVisibleStars();
});

document.getElementById('loadSlider').addEventListener('input', (event) => {
    console.log('Load slider changed');
    maxStars = event.target.value;
    console.log("Max stars load limit changed:", maxStars);
    checkAndLoadMoreStars();
});

document.getElementById('luminositySlider').addEventListener('input', (event) => {
    console.log('Luminosity slider changed');
    console.log("Luminosity changed:", event.target.value);
});
