# Watercolor Harness

Kimi K3.1 Pro paints in watercolor live, stroke by stroke, with Cerebras and a GPU provider side by side.

## How it works

- `PAINTER.md` teaches the model a small stroke language for washes, blobs and strokes.
- `renderer.js` turns streamed commands into layered watercolor on cold-press paper.
- `server.mjs` streams both providers into the split-screen page and saves paintings.

## Run

Put the keys from `.env.example` in `.env` or `~/.openclaw/.env`, run `node server.mjs`, and open http://localhost:8787. Paint from the page or with `node paint.mjs "Paint a peony."`.

Written by Kimi K3.1 Pro on Cerebras through OpenClaw.
