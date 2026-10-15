import express from 'express';
const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, phase: 'scaffold' }));
app.listen(2567, '127.0.0.1', () => console.log('Voxel server http://127.0.0.1:2567'));
