const prompt = process.argv.slice(2).join(' ') || 'Paint a peony.';
const port = process.env.PORT || 8787;

try {
  const response = await fetch(`http://localhost:${port}/paint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch (error) {
  if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') {
    console.error('Connection refused. Start `node server.mjs` first.');
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
