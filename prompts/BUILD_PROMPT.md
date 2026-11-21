Build a live watercolor painting app in the folder {{REPO_DIR}} (a git repository that is already cloned and empty). Every decision is made below, so don't ask questions and don't plan out loud.

Your first reply is nine write calls and nothing else, issued together in one message in exactly this order: PAINTER.md, renderer.js, server.mjs, index.html, paint.mjs, SKILL.md, .env.example, README.md, .gitignore. Use one write call per file, with its absolute path inside {{REPO_DIR}}. Use plain Node 18+ ES modules with no npm dependencies and no build step. Never write API keys into any file. Then do the single step under "Finish".

## 1. PAINTER.md

Write this text exactly. It is the system prompt the painter model gets.

<<<PAINTER
You are a watercolor painter. You paint by writing commands, one per line, that a renderer turns into watercolor on 1000 x 1000 cold-press paper. Output only command lines and comment lines starting with "#". No prose, no code fences.

Coordinates: x runs 0 (left) to 1000 (right), y runs 0 (top) to 1000 (bottom).

Commands:
wash   COLOR OPACITY WET x1,y1 x2,y2 ...        a filled area outlined by 4 to 16 points; corners get rounded off, so trace the outline you want with evenly spaced points
blob   COLOR OPACITY WET cx,cy rx,ry ANGLE      a soft ellipse centered at cx,cy with radii rx,ry, rotated ANGLE degrees
stroke COLOR OPACITY WET WIDTH x1,y1 x2,y2 ...  a crisp line along 2 to 12 points, tapering at both ends

COLOR (#rrggbb) is the pigment at full strength, straight from the tube. OPACITY (0 to 1) is how much pigment you load: it thins COLOR toward the paper. Make light passages with low OPACITY, never with a pale COLOR; a pale COLOR at low OPACITY disappears. WET (0 to 1) shapes the edge: low WET gives a clean edge with a thin darker rim where pigment pooled, high WET gives a ragged, feathered edge with no rim.

Useful pigments: rose #d23c72, crimson #8c1a44, red #d0402a, gold #e8b830, ochre #c8903a, sap green #4c8a32, deep green #2d5a22, cerulean #3f86c0, ultramarine #3a4fa8, violet #6a4a9a, burnt sienna #a0502a, grey #5a5a64.

Examples:
wash #3f86c0 0.3 0.9 0,0 500,0 1000,0 1000,420 500,450 0,460
blob #d23c72 0.5 0.3 480,400 50,35 -20
stroke #2d5a22 0.8 0.15 6 470,520 455,640 430,780

How the paint behaves:
- Paint is transparent and multiplies like real glazes. Nothing covers anything: a later shape never hides an earlier one, every overlap is darker than either shape, and order doesn't change the result. Complements overlapping (green on pink, orange on blue) turn muddy brown.
- To show one form in front of another, stop the far form's outline at the near form's edge, or make the overlap a deliberate shadow.
- The paper is your only white. Leave it bare for highlights and the lit edges of forms.
- Every wash already has a mottled inside and an uneven edge. Don't stack shapes to fake texture.
- Edges wander by a few percent of a shape's size, more when wet, so long thin washes come out jagged. Use strokes for long thin things.
- Strokes look like pen lines in paint. Use them only for things that are lines: stems, veins, hair, a few accent edges. Paint shadows and folds as washes.

Building a subject:
- Paint a complex subject as many separate shapes, one per part you could name (each petal, leaflet, fold, roof plane), overlapping slightly and varied in size, angle and opacity. Twenty irregular parts read as a rich form; five big blobs with lines on top read as a cartoon.
- Put the darkest values and most overlaps where forms crowd or turn away from the light. Keep edges that face the light pale.
- Hard-edged things (buildings, towers, windows, boats, rocks) are low-WET washes with 4 to 6 corner points, one wash per face or block, never wobbly strokes. A city is a crowd of such blocks in two or three depths, paler and bluer as they recede.
- Small points of light or color (stars, lit windows, sparkles, distant birds) are tiny blobs with radii 2 to 6. Scatter them unevenly.
- Avoid mirror symmetry. Never put two similar small marks side by side near a center, especially above a curved mark: viewers see a face.

Paint in this order, marking each stage with a comment:
1. "# plan": one line naming where the subject sits, its rough size, and 4 to 7 pigments.
2. "# background": 1 to 4 very wet washes (opacity 0.2 to 0.35, wet 0.7 to 1) around the subject rather than under it.
3. "# base": one pale wash over each main object's whole silhouette (opacity 0.15 to 0.2), then its parts in light local color (opacity 0.25 to 0.4, wet 0.2 to 0.4).
4. "# midtones": shadows as washes shaped like the shadow, such as crescents under overlaps or the shaded half of a leaf (opacity 0.4 to 0.55, wet 0.25 to 0.4).
5. "# darks": the deepest accents as small, thin, irregular slivers (opacity 0.6 to 0.8, wet 0.1 to 0.25).
6. "# details": a few thin strokes for stems, veins and edges (width 2 to 6, opacity 0.4 to 0.7, wet 0 to 0.2).

Aim for 80 to 140 lines, most of them on the subject; a crowded scene such as a city or a night sky may use up to 220. Keep it inside the paper with breathing room at the edges.
PAINTER>>>

## 2. renderer.js (ES module, runs in the browser)

Export `parseLine(line)` and `createPainter(ctx, px, { seed = 7, makeCanvas = (w, h) => new OffscreenCanvas(w, h) } = {})`. `createPainter` returns `{ reset(), draw(shape), drawLine(line) -> boolean, count }`. Shapes use a 1000 x 1000 logical space, so scale = px / 1000.

parseLine: match `/^\s*(wash|blob|stroke)\s+(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})(?![0-9a-fA-F])(.*)$/`, then take the numbers with `/-?\d+(?:\.\d+)?|-?\.\d+/g`. Clamp opacity and wet to 0..1.
- wash: opacity, wet, then x,y pairs (at least 3 points)
- blob: opacity, wet, cx, cy, rx, ry, then an optional angle in degrees (default 0)
- stroke: opacity, wet, width, then x,y pairs (at least 2 points)
- Anything else returns null, so comments and prose are ignored.

Randomness: use mulberry32 with a per-shape seed of `Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(shapeIndex + 1, 0x85ebca6b)`, so a stroke file always renders the same. Get Gaussian values from Box-Muller.

reset(): paint the paper with putImageData. Each pixel is rgb(248, 244, 235) + k, where k = 9 * (fine - 0.5) + 6 * (coarse - 0.5) + 3 * (random - 0.5). fine and coarse are bilinear value noise with cell sizes max(2, px / 450) and max(8, px / 90).

Base outline. Points are [x, y, v] with v = 0.5 + random().
- blob: a 12-point ellipse rotated by angle, then 1 pass of closed Chaikin corner cutting (each edge a->b becomes the points 0.75a+0.25b and 0.25a+0.75b).
- wash: 2 passes of closed Chaikin through the points. Don't use Catmull-Rom here, because it bows straight sides outward.
- For both blob and wash, then split any edge longer than clamp(size / 7, 12, 70), where size is the larger bounding-box side. Don't skip this: displacement scales with edge length, so long edges make giant spikes.
- stroke: open Catmull-Rom through the path (8 samples per segment, end points duplicated). Sample it every max(2, 0.6 * width) units of arc length. Offset each sample along the normal by ±half, where half = width / 2 * (0.2 + 0.8 * sin(PI * t) ^ 0.45) and t is the fraction of arc length. The outline is the left side plus the reversed right side.

deform(points, depth, variance): repeat depth times. Between each pair a, b (wrapping around), insert the midpoint displaced in x and in y by gauss() * |ab| * variance * avg(a.v, b.v). Give it v = max(0.2, avg(v) * (1 + 0.3 * gauss())).

Per-shape settings:
- blob and wash: base = deform(outline, 2, 0.06 + 0.2 * wet); layers = round(26 + 22 * wet); layer variance = 0.08 + 0.18 * wet; layer depth 2; 10 texture holes per layer
- stroke: base = deform(outline, 1, 0.02 + 0.06 * wet); layers = round(6 + 10 * wet); layer variance = 0.02 + 0.08 * wet; layer depth 1; no holes

draw(shape). Do it exactly this way. Drawing faint colored layers straight onto the painting drifts the hue through 8-bit rounding.
1. Keep one full-size scratch canvas from makeCanvas(px, px). Take the base's bounding box, padded by 30 + 0.2 * size, convert it to pixels and clamp it to the canvas. That is the region. Clear the region on the scratch canvas and clip to it.
2. Let target = min(opacity, 0.97). Cap layers at max(4, floor(ln(1 - target) / ln(1 - 8/255))) so each layer's alpha stays at or above 8/255. Below that, faint washes round away to nothing in 8 bits. Draw in black with globalAlpha = 1 - (1 - target) ^ (1 / layers). For each layer, take poly = deform(base, layer depth, layer variance).
   - blob and wash: save, clip to poly, then fill one path with fill('evenodd'): the padded bounding-box rectangle plus 10 random circles (radius size * (0.02 to 0.08), centers inside the box). The circles become holes. Restore.
   - stroke: fill poly.
3. Edge pooling: let e = opacity * 0.6 * (1 - 0.8 * wet). If e > 0.02, stroke deform(base, 1, layer variance * 0.5) with alpha e and lineWidth 2 (for strokes, max(0.6, width * 0.12)).
4. Tint: reset the transform, set globalAlpha to 1 and composite to 'source-in', then fillRect the region with the shape's color.
5. On the main canvas, set composite to 'multiply', drawImage the region from the scratch canvas, then set composite back to 'source-over'.

## 3. server.mjs

Use node:http, with port from PORT or 8787. Load env files with a small KEY=VALUE parser that strips surrounding quotes and never overrides a variable that's already set: first `.env` in the script's folder, then `~/.openclaw/.env`. Read PAINTER.md at startup.

Lanes. Run the same prompt on all of them at once and drop any lane without a key:
- cerebras: label "Cerebras", base https://api.cerebras.ai/v1, key CEREBRAS_API_KEY, model CEREBRAS_MODEL or "moonshotai-kimi-k3.1-pro-trial"
- gpu: label GPU_LABEL or "GPU provider", base GPU_BASE_URL, key GPU_API_KEY, model GPU_MODEL, plus extra request-body fields parsed from the JSON in GPU_EXTRA_BODY (default {})

If no lane has a key, print which variables to set and exit.

Routes:
- `GET /` serves index.html and `GET /renderer.js` serves renderer.js (text/javascript).
- `GET /lanes` returns `[{ id, label, model }]`.
- `GET /status` returns `{ pages, busy }`: how many pages are connected to /events, and whether a paint is running.
- `GET /events` is Server-Sent Events. Keep a set of open responses and broadcast `data: <json>\n\n`.
- `POST /paint` takes `{ prompt }` and returns 409 while busy. It runs every lane at once:
  - Each lane streams `POST {base}/chat/completions` with `{ model, stream: true, temperature: 0.7, max_tokens: 8000, messages: [system PAINTER, user prompt], ...extra }`.
  - Split the SSE body on newlines. For each `data:` line (skip `[DONE]`), broadcast `{ lane, type: 'text', text }` for choices[0].delta.content. Keep usage from `json.usage` or `json.choices[0].usage`.
  - Broadcast `{ lane, type: 'start' }` before the request. When it finishes, broadcast `{ lane, type: 'done', stats }`, where stats = `{ lane, label, model, tokens, estimated, seconds, firstTokenSeconds, tps }`. tokens is usage.completion_tokens, or characters / 4 with estimated true. tps = tokens / (end - first token).
  - On failure, broadcast `{ lane, type: 'error', error }`.
  - Save each lane's text to `out/<stamp>-<lane>.txt`.
  - Once all lanes are done, if any page is connected, broadcast `{ type: 'snapshot', stamp }` and wait up to 5 s for the PNGs.
  - Respond with `{ prompt, results, images: { lane: pngPath } }`.
- `POST /snapshot?stamp&lane` saves the request body to `out/<stamp>-<lane>.png`. Accept only a lane matching /^[a-z0-9]+$/ and a stamp that is pending.

## 4. index.html

A dark page made for screen recording. At the top is a form with a prompt input (default "Paint a peony.") and a Paint button (background #c4451b, white text) that POSTs /paint.

Below it, one panel per lane from /lanes, side by side in a grid. Size it so two square canvases fit on one screen: max-width min(1400px, calc((100vh - 170px) * 2 + 48px)).

Each panel has:
- A header with the lane label (22px bold) and model name, underlined in a 3px accent: #f15a29 for cerebras, #8a8f98 for gpu.
- Large tabular numbers on the right for time, tokens/s and strokes.
- A 1000 x 1000 canvas with a createPainter.
- A status line under the canvas.

Use an EventSource on /events:
- start: reset the painter and the counters, then begin a requestAnimationFrame ticker.
- text: append to the lane's buffer and draw every complete line with drawLine, counting the true results as strokes. Live tokens/s is characters / 4 / seconds since the first text.
- done: draw the leftover partial line, then show the server's tokens/s and token count.
- error: show the error in the status line.
- snapshot: canvas.toBlob, then POST each lane's PNG to /snapshot.

## 5. paint.mjs

A CLI: `node paint.mjs "Paint a peony."` POSTs to http://localhost:8787/paint (or PORT) and prints the JSON. If the connection is refused, it says to start `node server.mjs`; for any other failure it prints the error.

## 6. SKILL.md

Write this text exactly:

<<<SKILL
---
name: watercolor
description: Paint any subject as a live watercolor, streamed stroke by stroke from Kimi K3.1 Pro on Cerebras next to a GPU provider. Use when the user asks to paint, draw or sketch something.
---

# Watercolor

This folder holds a live painting server. The model writes a small stroke language and the page renders it as watercolor while the tokens stream in.

1. If nothing answers at http://localhost:8787, start the server from this folder in the background: `nohup node server.mjs > /dev/null 2>&1 &`. It reads API keys from the environment, `.env` in this folder, or `~/.openclaw/.env`.
2. If `curl -s localhost:8787/status` shows `"pages":0`, open the page (on macOS: `open http://localhost:8787`) and wait 2 seconds. It shows every lane painting side by side and saves PNG snapshots when they finish.
3. From this folder run `node paint.mjs "Paint <subject>."` with the user's subject. It prints JSON with each lane's seconds, tokens per second and PNG path.
4. Reply with one line comparing each lane's time and tokens per second.
SKILL>>>

## 7. .env.example

```
CEREBRAS_API_KEY=
CEREBRAS_MODEL=moonshotai-kimi-k3.1-pro-trial
GPU_LABEL=GPU provider
GPU_BASE_URL=
GPU_API_KEY=
GPU_MODEL=
GPU_EXTRA_BODY={}
```

## 8. README.md

Keep it short and use only relative paths:
- A title, "Watercolor Harness".
- One sentence: Kimi K3.1 Pro paints in watercolor live, stroke by stroke, with Cerebras and a GPU provider side by side.
- How it works in three bullets: the stroke language in PAINTER.md, the renderer, and the split-screen server.
- How to run: put the keys from .env.example in `.env` or `~/.openclaw/.env`, run `node server.mjs`, open http://localhost:8787, then paint from the page or with `node paint.mjs "Paint a peony."`.
- One line saying the app was written by Kimi K3.1 Pro on Cerebras through OpenClaw.

## 9. .gitignore

```
.env
out/
node_modules/
.DS_Store
```

## Finish

Once the files are written, make one exec call that runs exactly this. It checks the code, commits and pushes, starts the server, opens the page if no browser has it open yet, and paints a peony:

```sh
cd {{REPO_DIR}} && node --check server.mjs && node --check paint.mjs && git add -A && git commit -q -m "Add live watercolor painting harness" && git push -q -u origin main && (nohup node server.mjs > /dev/null 2>&1 &) && for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf localhost:8787/lanes && break; sleep 0.5; done && sleep 2 && { curl -s localhost:8787/status | grep -q '"pages":0' && open http://localhost:8787 && sleep 2; true; } && node paint.mjs "Paint a peony."
```

If any part fails, fix the cause and run the rest. When it succeeds, reply in two lines: what you built, and each lane's tokens per second from the JSON that paint.mjs printed.
