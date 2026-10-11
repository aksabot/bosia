---
title: Themes
description: Token sets that drive color, font, and radius across every block and primitive. Swap themes without touching components.
---

## What themes are

A theme is a `tokens.css` file that defines Tailwind v4 `@theme` custom properties — `--color-background`, `--color-card`, `--font-display`, `--radius-lg`, and so on. Blocks and primitives reference these tokens semantically (`bg-card`, `font-display`), never raw values. Switch themes → everything restyles.

## Install

```bash
bun x bosia@latest add theme editorial
```

The CLI copies tokens to `src/lib/themes/<name>.css` and rewrites the active import in `src/app.css`. Only one theme is active at a time (v1).

## Available themes

- [neutral](/themes/neutral) — default shadcn-inspired palette + system stack
- [editorial](/themes/editorial) — warm cream + Instrument Serif display
- [zinc](/themes/zinc) — cool blue-gray, developer-tool aesthetic
- [stone](/themes/stone) — warm gray, document and publishing aesthetic
- [claude](/themes/claude) — violet palette, AI assistant and productivity aesthetic
- [ocean](/themes/ocean) — deep navy + teal, SaaS and data app aesthetic
- [forest](/themes/forest) — earthy green + amber, nature and sustainability aesthetic
- [rose](/themes/rose) — rose palette, creative and lifestyle aesthetic
- [sunset](/themes/sunset) — warm orange + pink accent, consumer and marketing aesthetic
- [midnight](/themes/midnight) — indigo, dark-first dashboard and analytics aesthetic
- [mono](/themes/mono) — brutalist monochrome, sharp corners + monospace stack
- [amber](/themes/amber) — amber + yellow, cozy hospitality and food aesthetic
- [paper](/themes/paper) — warm cardstock neutrals + ink-blue brand, clean editorial feel
- [carbon](/themes/carbon) — brutalist mono, hard offset shadows + orange brand
- [bloom](/themes/bloom) — soft pastel pink, big radius + diffuse tinted shadows
- [terminal](/themes/terminal) — dark green phosphor, mono display + accent glow
- [sage](/themes/sage) — calm muted green, small radius + quiet shadows
- [grape](/themes/grape) — dark lilac/purple with a soft accent glow
- [clay](/themes/clay) — warm paper neutrals + terracotta brand, general-store storefront feel

## Authoring a theme

See [Creating themes](/themes/creating-themes).
