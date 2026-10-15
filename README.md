# Agent Voxel World

Independent local prototype: TypeScript, pnpm workspace, React/Vite, Three.js, Colyseus, PostgreSQL/Prisma.

## Start

Node 22+, pnpm 10. `pnpm install`, then `pnpm dev`. Web: http://127.0.0.1:5173; server: http://127.0.0.1:2567/health.
`pnpm check` runs type checks, tests and production web build.

## Scope and staged delivery

1. Workspace and test baseline.
2. 3D voxel terrain, character controls and block editing.
3. Authoritative multiplayer, interpolation, chat and reconnect.
4. PostgreSQL world persistence and migrations.
5. Structured Agent observation/events and validated actions.
6. Replaceable voice interface, mock subtitles and interruption.

No cloud services, real AI inference, real microphone transport or paid APIs are enabled. Scripted agents and voice mocks are labelled. Secrets stay server-side; never commit `.env`.
