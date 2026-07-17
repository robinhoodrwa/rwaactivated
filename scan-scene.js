"use strict";

(() => {
  const TAU = Math.PI * 2;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const instances = [];

  const palette = {
    amber: [238, 172, 62],
    amberDark: [154, 92, 19],
    steel: [92, 108, 116],
    steelDark: [31, 39, 44],
    track: [22, 27, 30],
    rubber: [12, 16, 18],
    glass: [67, 150, 172],
    chrome: [180, 194, 196]
  };

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function buildExcavator() {
    const vertices = [];
    const faces = [];
    const edgeSet = new Set();
    const edges = [];

    function addFace(indices, color, alpha = 1) {
      const faceIndex = faces.length;
      faces.push({ indices, color, alpha, depth: 0, shade: 1, faceIndex });
      for (let index = 0; index < indices.length; index += 1) {
        const a = indices[index];
        const b = indices[(index + 1) % indices.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push([a, b]);
        }
      }
    }

    function addBox(cx, cy, cz, width, height, depth, color, rotation = 0, alpha = 1) {
      const start = vertices.length;
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const halfDepth = depth / 2;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const corners = [
        [-halfWidth, -halfHeight, -halfDepth], [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth], [-halfWidth, halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, halfDepth], [halfWidth, -halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth], [-halfWidth, halfHeight, halfDepth]
      ];
      for (const [x, y, z] of corners) {
        vertices.push([cx + x * cos - y * sin, cy + x * sin + y * cos, cz + z]);
      }
      addFace([start, start + 1, start + 2, start + 3], color, alpha);
      addFace([start + 5, start + 4, start + 7, start + 6], color, alpha);
      addFace([start + 4, start, start + 3, start + 7], color, alpha);
      addFace([start + 1, start + 5, start + 6, start + 2], color, alpha);
      addFace([start + 3, start + 2, start + 6, start + 7], color, alpha);
      addFace([start + 4, start + 5, start + 1, start], color, alpha);
    }

    function addBeam(x1, y1, x2, y2, z, width, depth, color, alpha = 1) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      addBox((x1 + x2) / 2, (y1 + y2) / 2, z, Math.hypot(dx, dy), width, depth, color, Math.atan2(dy, dx), alpha);
    }

    function addCylinder(cx, cy, cz, radius, depth, segments, color) {
      const start = vertices.length;
      for (let side = -1; side <= 1; side += 2) {
        for (let index = 0; index < segments; index += 1) {
          const angle = index / segments * TAU;
          vertices.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, cz + side * depth / 2]);
        }
      }
      for (let index = 0; index < segments; index += 1) {
        const next = (index + 1) % segments;
        addFace([start + index, start + next, start + segments + next, start + segments + index], color);
      }
      addFace(Array.from({ length: segments }, (_, index) => start + segments - 1 - index), color);
      addFace(Array.from({ length: segments }, (_, index) => start + segments + index), color);
    }

    function addBucket() {
      const start = vertices.length;
      const side = [
        [2.74, 1.62], [3.18, 1.25], [3.62, 1.06], [3.7, 0.72], [3.18, 0.84]
      ];
      for (const z of [-0.31, 0.31]) {
        for (const [x, y] of side) vertices.push([x, y, z]);
      }
      addFace([start, start + 1, start + 2, start + 3, start + 4], palette.amberDark);
      addFace([start + 9, start + 8, start + 7, start + 6, start + 5], palette.amber);
      for (let index = 0; index < side.length; index += 1) {
        const next = (index + 1) % side.length;
        addFace([start + index, start + next, start + 5 + next, start + 5 + index], palette.amber);
      }
    }

    addBox(-0.34, 0.47, -0.63, 3.18, 0.68, 0.48, palette.track);
    addBox(-0.34, 0.47, 0.63, 3.18, 0.68, 0.48, palette.track);
    addBox(-0.32, 0.88, 0, 2.5, 0.38, 1.45, palette.steelDark);
    addCylinder(-1.28, 0.47, -0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(-0.43, 0.47, -0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(0.48, 0.47, -0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(-1.28, 0.47, 0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(-0.43, 0.47, 0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(0.48, 0.47, 0.91, 0.26, 0.06, 12, palette.steel);
    addCylinder(-0.32, 1.04, 0, 0.5, 1.15, 16, palette.steelDark);
    addBox(-0.68, 1.55, 0, 1.62, 1.18, 1.28, palette.amber);
    addBox(-1.3, 1.56, 0, 0.43, 0.88, 1.36, palette.amberDark);
    addBox(0.48, 1.62, -0.02, 0.88, 1.42, 1.1, palette.steelDark);
    addBox(0.58, 1.92, -0.03, 0.67, 0.88, 1.12, palette.glass, 0, 0.72);
    addBox(0.8, 2.33, 0, 0.3, 0.18, 1.13, palette.amberDark);
    addBeam(0.24, 2.19, 2.06, 3.18, 0, 0.34, 0.45, palette.amber);
    addBeam(1.99, 3.16, 2.91, 1.62, 0, 0.29, 0.38, palette.amber);
    addBeam(0.42, 2.45, 1.96, 3.39, -0.31, 0.09, 0.12, palette.chrome);
    addBeam(2.01, 3.26, 2.78, 1.78, -0.28, 0.08, 0.11, palette.chrome);
    addBucket();
    addBox(-0.52, 1.72, -0.68, 1.24, 0.12, 0.05, palette.steelDark);
    addBox(-0.52, 1.42, -0.68, 1.24, 0.08, 0.05, palette.steelDark);

    const random = seededRandom(3200821);
    const points = new Float32Array(1800 * 4);
    for (let pointIndex = 0; pointIndex < 1800; pointIndex += 1) {
      const face = faces[Math.floor(random() * faces.length)];
      const indices = face.indices;
      const a = vertices[indices[0]];
      const b = vertices[indices[1]];
      const c = vertices[indices[Math.min(2, indices.length - 1)]];
      let u = random();
      let v = random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const offset = pointIndex * 4;
      points[offset] = a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v;
      points[offset + 1] = a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v;
      points[offset + 2] = a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v;
      points[offset + 3] = Math.max(0, Math.min(1, (points[offset] + 1.9) / 5.8 + random() * 0.11));
    }

    return { vertices, faces, edges, points };
  }

  const model = buildExcavator();

  function createScene(canvas) {
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    const projected = new Float32Array(model.vertices.length * 3);
    const pointProjection = new Float32Array(3);
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let yaw = Number(canvas.dataset.yaw || -0.55);
    let targetYaw = yaw;
    let pitch = Number(canvas.dataset.pitch || -0.13);
    let targetPitch = pitch;
    let progress = Number(canvas.dataset.progress || 0.64);
    let targetProgress = progress;
    let visible = true;
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    let lastTime = performance.now();
    let animationFrame = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const nextWidth = Math.round(width * pixelRatio);
      const nextHeight = Math.round(height * pixelRatio);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function transformPoint(x, y, z, output, offset = 0) {
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const rotatedX = x * cosYaw - z * sinYaw;
      const rotatedZ = x * sinYaw + z * cosYaw;
      const rotatedY = y * cosPitch - rotatedZ * sinPitch;
      const depth = y * sinPitch + rotatedZ * cosPitch;
      const scale = Math.min(width, height * 1.28) * 1.06 / (6.6 - depth);
      output[offset] = width * 0.48 + (rotatedX - 0.52) * scale;
      output[offset + 1] = height * 0.76 - rotatedY * scale;
      output[offset + 2] = depth;
    }

    function projectModel() {
      for (let index = 0; index < model.vertices.length; index += 1) {
        const point = model.vertices[index];
        transformPoint(point[0], point[1], point[2], projected, index * 3);
      }
      for (const face of model.faces) {
        let depth = 0;
        for (const index of face.indices) depth += projected[index * 3 + 2];
        face.depth = depth / face.indices.length;
      }
      model.faces.sort((a, b) => a.depth - b.depth);
    }

    function rgba(color, shade, alpha) {
      return `rgba(${Math.round(color[0] * shade)},${Math.round(color[1] * shade)},${Math.round(color[2] * shade)},${alpha})`;
    }

    function drawGrid() {
      context.save();
      context.lineWidth = 1;
      for (let index = -7; index <= 7; index += 1) {
        const alpha = 0.045 + (index === 0 ? 0.05 : 0);
        context.strokeStyle = `rgba(127,232,220,${alpha})`;
        context.beginPath();
        transformPoint(-5.2, 0.05, index * 0.55, pointProjection);
        context.moveTo(pointProjection[0], pointProjection[1]);
        transformPoint(5.2, 0.05, index * 0.55, pointProjection);
        context.lineTo(pointProjection[0], pointProjection[1]);
        context.stroke();
        context.beginPath();
        transformPoint(index * 0.72, 0.05, -4.3, pointProjection);
        context.moveTo(pointProjection[0], pointProjection[1]);
        transformPoint(index * 0.72, 0.05, 4.3, pointProjection);
        context.lineTo(pointProjection[0], pointProjection[1]);
        context.stroke();
      }
      context.restore();
    }

    function drawFaces() {
      context.lineJoin = "round";
      for (const face of model.faces) {
        const first = face.indices[0] * 3;
        context.beginPath();
        context.moveTo(projected[first], projected[first + 1]);
        for (let index = 1; index < face.indices.length; index += 1) {
          const offset = face.indices[index] * 3;
          context.lineTo(projected[offset], projected[offset + 1]);
        }
        context.closePath();
        const shade = Math.max(0.44, Math.min(1.08, 0.78 + face.depth * 0.075 + (face.faceIndex % 5) * 0.035));
        context.fillStyle = rgba(face.color, shade, face.alpha);
        context.fill();
        context.strokeStyle = `rgba(218,246,242,${face.alpha * 0.08})`;
        context.lineWidth = 0.75;
        context.stroke();
      }
    }

    function drawPointCloud() {
      if (progress < 0.08) return;
      context.save();
      context.globalCompositeOperation = "lighter";
      const points = model.points;
      for (let offset = 0; offset < points.length; offset += 4) {
        const phase = points[offset + 3];
        if (phase > progress + 0.08) continue;
        transformPoint(points[offset], points[offset + 1], points[offset + 2], pointProjection);
        const newest = Math.max(0, 1 - Math.abs(progress - phase) * 8);
        context.fillStyle = `rgba(${newest > 0.1 ? "111,255,220" : "87,188,255"},${0.15 + newest * 0.68})`;
        const radius = 0.55 + newest * 1.15;
        context.fillRect(pointProjection[0] - radius / 2, pointProjection[1] - radius / 2, radius, radius);
      }
      context.restore();
    }

    function drawMesh() {
      if (progress < 0.78) return;
      const opacity = Math.min(0.4, (progress - 0.78) * 2.4);
      context.save();
      context.strokeStyle = `rgba(104,255,221,${opacity})`;
      context.lineWidth = 0.7;
      for (const [a, b] of model.edges) {
        const ao = a * 3;
        const bo = b * 3;
        context.beginPath();
        context.moveTo(projected[ao], projected[ao + 1]);
        context.lineTo(projected[bo], projected[bo + 1]);
        context.stroke();
      }
      context.restore();
    }

    function drawScanPlane() {
      const x = -1.95 + progress * 5.85;
      const top = new Float32Array(3);
      const bottom = new Float32Array(3);
      transformPoint(x, 3.75, -1.2, top);
      transformPoint(x, 0.08, -1.2, bottom);
      const gradient = context.createLinearGradient(top[0], top[1], bottom[0], bottom[1]);
      gradient.addColorStop(0, "rgba(100,255,225,0)");
      gradient.addColorStop(0.38, "rgba(100,255,225,0.82)");
      gradient.addColorStop(1, "rgba(100,255,225,0.08)");
      context.save();
      context.globalCompositeOperation = "lighter";
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.shadowColor = "rgba(92,255,220,.9)";
      context.shadowBlur = 14;
      context.beginPath();
      context.moveTo(top[0], top[1]);
      context.lineTo(bottom[0], bottom[1]);
      context.stroke();
      context.restore();
    }

    function drawFrame() {
      context.clearRect(0, 0, width, height);
      const glow = context.createRadialGradient(width * 0.52, height * 0.55, 0, width * 0.52, height * 0.55, Math.max(width, height) * 0.58);
      glow.addColorStop(0, "rgba(30,106,104,.14)");
      glow.addColorStop(0.62, "rgba(9,28,31,.04)");
      glow.addColorStop(1, "rgba(4,10,12,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
      projectModel();
      drawGrid();
      drawFaces();
      drawPointCloud();
      drawMesh();
      drawScanPlane();
    }

    function animate(now) {
      animationFrame = 0;
      const delta = Math.min(40, now - lastTime);
      lastTime = now;
      const ease = 1 - Math.pow(0.001, delta / 1000);
      yaw += (targetYaw - yaw) * ease * 5;
      pitch += (targetPitch - pitch) * ease * 5;
      progress += (targetProgress - progress) * ease * 4;
      if (!dragging && !prefersReducedMotion && canvas.dataset.autorotate !== "false") {
        targetYaw += delta * 0.000065;
      }
      drawFrame();
      if (visible && (!prefersReducedMotion || Math.abs(targetProgress - progress) > 0.002 || Math.abs(targetYaw - yaw) > 0.002)) {
        animationFrame = requestAnimationFrame(animate);
      }
    }

    function requestDraw() {
      if (!animationFrame && visible) {
        lastTime = performance.now();
        animationFrame = requestAnimationFrame(animate);
      }
    }

    function setProgress(next) {
      targetProgress = Math.max(0.02, Math.min(1, Number(next) || 0));
      requestDraw();
    }

    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      dragX = event.clientX;
      dragY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      targetYaw += (event.clientX - dragX) * 0.008;
      targetPitch = Math.max(-0.34, Math.min(0.12, targetPitch + (event.clientY - dragY) * 0.004));
      dragX = event.clientX;
      dragY = event.clientY;
      requestDraw();
    });
    canvas.addEventListener("pointerup", (event) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove("is-dragging");
    });
    canvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") targetYaw -= 0.12;
      if (event.key === "ArrowRight") targetYaw += 0.12;
      if (event.key === "ArrowUp") targetPitch = Math.max(-0.34, targetPitch - 0.06);
      if (event.key === "ArrowDown") targetPitch = Math.min(0.12, targetPitch + 0.06);
      requestDraw();
    });

    const resizeObserver = new ResizeObserver(() => {
      resize();
      drawFrame();
    });
    resizeObserver.observe(canvas);

    const visibilityObserver = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) requestDraw();
      else if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    }, { rootMargin: "180px" });
    visibilityObserver.observe(canvas);

    resize();
    drawFrame();
    requestDraw();

    return {
      canvas,
      setProgress,
      setView(nextYaw, nextPitch = targetPitch) {
        targetYaw = Number(nextYaw);
        targetPitch = Math.max(-0.34, Math.min(0.12, Number(nextPitch)));
        requestDraw();
      },
      destroy() {
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        if (animationFrame) cancelAnimationFrame(animationFrame);
      }
    };
  }

  for (const canvas of document.querySelectorAll("[data-scan-scene]")) {
    instances.push(createScene(canvas));
  }

  document.addEventListener("rwa:scan-progress", (event) => {
    const detail = event.detail || {};
    for (const instance of instances) {
      if (!detail.target || instance.canvas.matches(detail.target)) instance.setProgress(detail.progress);
    }
  });

  window.RwaScanScenes = instances;
})();
