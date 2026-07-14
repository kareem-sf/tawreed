# Tawreed product film

A single 30.5-second, 4:5 Remotion product film for the redesigned Tawreed
portable desktop app. It is built for muted autoplay on LinkedIn and GitHub:
every scene is understandable without narration or captions.

## Story

1. BOQs are dense; decisions should not be.
2. Choose one workbook.
3. Inspect, classify, and validate every item.
4. Review counts, coverage, and warnings.
5. Approve once and generate the workbook.
6. Portable, local-first, and open source.

## Commands

```powershell
pnpm install
pnpm lint
pnpm dev
pnpm render:still
pnpm render
```

Outputs:

- `out/tawreed-product-film.mp4`
- `out/tawreed-product-film-cover.png`

The production uses only the current Tawreed UI captures, the Tawreed logo,
and a self-hosted Geist variable font. The project contains only assets needed
by this composition.
