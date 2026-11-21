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
