# LinguaPractice web app (Next.js 16)

Frontend for the English Learning & Practice Platform. See the repository root `README.md` for setup.

```powershell
npm run dev        # http://localhost:3000 (needs the FastAPI backend on :8000)
npm run build      # production build
npm test           # typing-engine unit tests (Node test runner)
npm run lint
npm run typecheck
```

Configuration: `apps/web/.env.local` holds public values only (`NEXT_PUBLIC_API_BASE_URL`,
`NEXT_PUBLIC_ABLY_AUTH_URL`). It is written by `scripts/setup.ps1`. Never put secrets here.
