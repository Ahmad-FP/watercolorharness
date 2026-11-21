export function parseLine(line) {
  const match = line.match(/^\s*(wash|blob|stroke)\s+(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})(?![0-9a-fA-F])(.*)$/);
  if (!match) return null;
  const [, type, color, rest] = match;
  const numbers = rest.match(/-?\d+(?:\.\d+)?|-?\.\d+/g)?.map(Number) || [];
  const unit = value => Math.max(0, Math.min(1, value));

  if (type === 'wash') {
    if (numbers.length < 8 || numbers.length % 2 !== 0) return null;
    const points = [];
    for (let i = 2; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
    return { type, color, opacity: unit(numbers[0]), wet: unit(numbers[1]), points };
  }

  if (type === 'blob') {
    if (numbers.length < 6) return null;
    return {
      type, color, opacity: unit(numbers[0]), wet: unit(numbers[1]),
      cx: numbers[2], cy: numbers[3], rx: numbers[4], ry: numbers[5],
      angle: numbers.length > 6 ? numbers[6] : 0,
    };
  }

  if (numbers.length < 7 || (numbers.length - 3) % 2 !== 0) return null;
  const points = [];
  for (let i = 3; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  if (points.length < 2) return null;
  return {
    type, color, opacity: unit(numbers[0]), wet: unit(numbers[1]),
    width: numbers[2], points,
  };
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianSource(random) {
  let spare = null;
  return function gauss() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function chaikin(points) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    result.push([
      0.75 * a[0] + 0.25 * b[0],
      0.75 * a[1] + 0.25 * b[1],
      0.75 * a[2] + 0.25 * b[2],
    ]);
    result.push([
      0.25 * a[0] + 0.75 * b[0],
      0.25 * a[1] + 0.75 * b[1],
      0.25 * a[2] + 0.75 * b[2],
    ]);
  }
  return result;
}

function boundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, minY, maxX, maxY, width, height, size: Math.max(width, height) };
}

function splitLongEdges(points, maxLength) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const pieces = Math.max(1, Math.ceil(length / maxLength));
    result.push(a);
    for (let j = 1; j < pieces; j++) {
      const t = j / pieces;
      result.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  return result;
}

function catmullRom(points) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let sample = 0; sample < 8; sample++) {
      const t = sample / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  result.push([...points[points.length - 1]]);
  return result;
}

function strokeOutline(shape, random) {
  const curve = catmullRom(shape.points);
  const distances = [0];
  for (let i = 1; i < curve.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]));
  }
  const total = distances[distances.length - 1];
  const step = Math.max(2, 0.6 * shape.width);
  const samples = [];
  let segment = 1;
  const count = Math.max(1, Math.ceil(total / step));
  for (let i = 0; i <= count; i++) {
    const distance = total * i / count;
    while (segment < distances.length - 1 && distances[segment] < distance) segment++;
    const startDistance = distances[segment - 1];
    const span = distances[segment] - startDistance || 1;
    const t = (distance - startDistance) / span;
    const a = curve[segment - 1];
    const b = curve[segment];
    samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  const left = [];
  const right = [];
  for (let i = 0; i < samples.length; i++) {
    const previous = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const dx = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const t = total ? distances[distances.length - 1] && (i / count) : 0;
    const half = shape.width / 2 * (0.2 + 0.8 * Math.pow(Math.sin(Math.PI * t), 0.45));
    const x = samples[i][0];
    const y = samples[i][1];
    left.push([x + nx * half, y + ny * half, 0.5 + random()]);
    right.push([x - nx * half, y - ny * half, 0.5 + random()]);
  }
  return left.concat(right.reverse());
}

function deform(points, depth, variance, gauss) {
  let result = points;
  for (let pass = 0; pass < depth; pass++) {
    const next = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      const average = (a[2] + b[2]) / 2;
      next.push(a);
      next.push([
        (a[0] + b[0]) / 2 + gauss() * length * variance * average,
        (a[1] + b[1]) / 2 + gauss() * length * variance * average,
        Math.max(0.2, average * (1 + 0.3 * gauss())),
      ]);
    }
    result = next;
  }
  return result;
}

function tracePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
  context.closePath();
}

function valueNoise(px, cell, random) {
  const columns = Math.ceil(px / cell) + 2;
  const rows = columns;
  const values = new Float64Array(columns * rows);
  for (let i = 0; i < values.length; i++) values[i] = random();
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = gx - ix;
    const ty = gy - iy;
    const a = values[iy * columns + ix];
    const b = values[iy * columns + ix + 1];
    const c = values[(iy + 1) * columns + ix];
    const d = values[(iy + 1) * columns + ix + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
}

export function createPainter(ctx, px, { seed = 7, makeCanvas = (w, h) => new OffscreenCanvas(w, h) } = {}) {
  const scale = px / 1000;
  const scratch = makeCanvas(px, px);
  const scratchContext = scratch.getContext('2d');
  let shapeIndex = 0;

  function reset() {
    shapeIndex = 0;
    const random = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);
    const fine = valueNoise(px, Math.max(2, px / 450), random);
    const coarse = valueNoise(px, Math.max(8, px / 90), random);
    const image = ctx.createImageData(px, px);
    const data = image.data;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const k = 9 * (fine(x, y) - 0.5) + 6 * (coarse(x, y) - 0.5) + 3 * (random() - 0.5);
        const offset = (y * px + x) * 4;
        data[offset] = Math.max(0, Math.min(255, Math.round(248 + k)));
        data[offset + 1] = Math.max(0, Math.min(255, Math.round(244 + k)));
        data[offset + 2] = Math.max(0, Math.min(255, Math.round(235 + k)));
        data[offset + 3] = 255;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.putImageData(image, 0, 0);
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.clearRect(0, 0, px, px);
  }

  function draw(shape) {
    const random = mulberry32((Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(shapeIndex + 1, 0x85ebca6b)) >>> 0);
    const gauss = gaussianSource(random);
    shapeIndex++;

    let outline;
    if (shape.type === 'blob') {
      outline = [];
      const angle = shape.angle * Math.PI / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      for (let i = 0; i < 12; i++) {
        const theta = 2 * Math.PI * i / 12;
        const x = shape.rx * Math.cos(theta);
        const y = shape.ry * Math.sin(theta);
        outline.push([
          shape.cx + x * cosine - y * sine,
          shape.cy + x * sine + y * cosine,
          0.5 + random(),
        ]);
      }
      outline = chaikin(outline);
    } else if (shape.type === 'wash') {
      outline = shape.points.map(([x, y]) => [x, y, 0.5 + random()]);
      outline = chaikin(chaikin(outline));
    } else {
      outline = strokeOutline(shape, random);
    }

    let box = boundingBox(outline);
    if (shape.type === 'blob' || shape.type === 'wash') {
      outline = splitLongEdges(outline, Math.max(12, Math.min(70, box.size / 7)));
    }

    const isStroke = shape.type === 'stroke';
    const base = deform(outline, isStroke ? 1 : 2,
      isStroke ? 0.02 + 0.06 * shape.wet : 0.06 + 0.2 * shape.wet, gauss);
    box = boundingBox(base);
    const padding = 30 + 0.2 * box.size;
    const padded = {
      minX: box.minX - padding,
      minY: box.minY - padding,
      maxX: box.maxX + padding,
      maxY: box.maxY + padding,
    };
    const rx = Math.max(0, Math.floor(padded.minX * scale));
    const ry = Math.max(0, Math.floor(padded.minY * scale));
    const right = Math.min(px, Math.ceil(padded.maxX * scale));
    const bottom = Math.min(px, Math.ceil(padded.maxY * scale));
    const rw = right - rx;
    const rh = bottom - ry;
    if (rw <= 0 || rh <= 0) return;

    const target = Math.min(shape.opacity, 0.97);
    const layerDepth = isStroke ? 1 : 2;
    const layerVariance = isStroke ? 0.02 + 0.08 * shape.wet : 0.08 + 0.18 * shape.wet;
    const wantedLayers = Math.round(isStroke ? 6 + 10 * shape.wet : 26 + 22 * shape.wet);
    const layerCap = Math.max(4, Math.floor(Math.log(1 - target) / Math.log(1 - 8 / 255)));
    const layers = Math.min(wantedLayers, layerCap);
    const alpha = 1 - Math.pow(1 - target, 1 / layers);

    scratchContext.save();
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.globalCompositeOperation = 'source-over';
    scratchContext.clearRect(rx, ry, rw, rh);
    scratchContext.beginPath();
    scratchContext.rect(rx, ry, rw, rh);
    scratchContext.clip();
    scratchContext.setTransform(scale, 0, 0, scale, 0, 0);
    scratchContext.fillStyle = '#000';
    scratchContext.strokeStyle = '#000';
    scratchContext.globalAlpha = alpha;

    for (let layer = 0; layer < layers; layer++) {
      const poly = deform(base, layerDepth, layerVariance, gauss);
      if (isStroke) {
        tracePolygon(scratchContext, poly);
        scratchContext.fill();
      } else {
        scratchContext.save();
        tracePolygon(scratchContext, poly);
        scratchContext.clip();
        scratchContext.beginPath();
        scratchContext.rect(padded.minX, padded.minY, padded.maxX - padded.minX, padded.maxY - padded.minY);
        for (let hole = 0; hole < 10; hole++) {
          const radius = box.size * (0.02 + 0.06 * random());
          const cx = padded.minX + random() * (padded.maxX - padded.minX);
          const cy = padded.minY + random() * (padded.maxY - padded.minY);
          scratchContext.moveTo(cx + radius, cy);
          scratchContext.arc(cx, cy, radius, 0, Math.PI * 2);
        }
        scratchContext.fill('evenodd');
        scratchContext.restore();
      }
    }

    const edge = shape.opacity * 0.6 * (1 - 0.8 * shape.wet);
    if (edge > 0.02) {
      scratchContext.globalAlpha = edge;
      scratchContext.lineWidth = isStroke ? Math.max(0.6, shape.width * 0.12) : 2;
      tracePolygon(scratchContext, deform(base, 1, layerVariance * 0.5, gauss));
      scratchContext.stroke();
    }

    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.globalAlpha = 1;
    scratchContext.globalCompositeOperation = 'source-in';
    scratchContext.fillStyle = shape.color;
    scratchContext.fillRect(rx, ry, rw, rh);
    scratchContext.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(scratch, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.restore();
  }

  function drawLine(line) {
    const shape = parseLine(line);
    if (!shape) return false;
    draw(shape);
    return true;
  }

  return {
    reset,
    draw,
    drawLine,
    get count() { return shapeIndex; },
  };
}
