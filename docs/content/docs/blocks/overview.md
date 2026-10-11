---
title: Blocks
description: Composed UI sections (hero, pricing, cards) that bake good design into your app — install one command, no props to wire up.
---

## What blocks are

Primitives (`Button`, `Card`, `Input`) are unstyled toolkit pieces. They give you flexibility but no opinion. **Blocks** are the missing layer on top — composed sections with hardcoded copy, layout, and typography rhythm. Drop one in, then edit the copy in place.

Blocks follow the shadcn philosophy: copy-paste source, no runtime configuration, you own the file.

## Layers

```
Primitives  →  Blocks  →  Pages
(Button)       (FeatureCard)   (Landing)
```

## Install

```bash
bun x bosia@latest add block cards/feature
```

Files land in `src/lib/blocks/<category>/<name>/`. Primitive dependencies (Card, Button, etc.) install automatically.

## Page blocks don't include a navbar

Page-level blocks (heros, cards, sections) don't carry their own site navbar — that's deliberate. The navbar, footer, and sidebar belong in your `+layout.svelte` so they render once across every route. Pair a page block with a [navbar block](/blocks/navbars/standard) placed in the layout; dropping a hero on a page and a navbar in the layout gives you exactly one navbar, not two.

## Available blocks

150+ blocks across ten categories. Install any with `bun x bosia@latest add block <category>/<name>`.

### Heros (17)

Full-bleed landing hero sections, one per vertical:
[agency](/blocks/heros/agency) ·
[app](/blocks/heros/app) ·
[apparel](/blocks/heros/apparel) ·
[bags](/blocks/heros/bags) ·
[bookstore](/blocks/heros/bookstore) ·
[campus](/blocks/heros/campus) ·
[consulting](/blocks/heros/consulting) ·
[course](/blocks/heros/course) ·
[delivery](/blocks/heros/delivery) ·
[home-goods](/blocks/heros/home-goods) ·
[lookbook](/blocks/heros/lookbook) ·
[new-drop](/blocks/heros/new-drop) ·
[product](/blocks/heros/product) ·
[restaurant](/blocks/heros/restaurant) ·
[sale](/blocks/heros/sale) ·
[shop-split](/blocks/heros/shop-split) ·
[toys](/blocks/heros/toys)

### Navbars (19)

- [Standard](/blocks/navbars/standard) — classic light layouts: centered, split, search-led, minimal, two-tier
- [App & Interactive](/blocks/navbars/app) — dashboard, e-commerce, docs, mega-menu, announcement, mobile
- [Themes](/blocks/navbars/themes) — dark, glass, brutalist, floating pill, gradient, brand bar, overlay

### Docks (4)

Mobile [bottom-navigation bars](/blocks/docks) — edge, floating, pill, center-FAB.

### Footers (12)

- [Standard](/blocks/footers/standard) — classic light layouts: minimal, columns, newsletter, centered, mega, split-brand
- [Themes](/blocks/footers/themes) — dark, glass, gradient, brutalist, editorial, terminal

### Sections (28)

Marketing sections for the middle of a page — between the hero and the footer:

- [Pricing](/blocks/pricing) — columns, comparison, simple
- [Testimonials](/blocks/testimonials) — grid, spotlight
- [FAQ](/blocks/faq) — accordion, grid
- [CTA](/blocks/cta) — banner, panel
- [Features](/blocks/features) — grid, split, bento
- [Stats](/blocks/stats) — band, cards, sentiment bar
- [Logos](/blocks/logos) — row, grid
- [Contact](/blocks/contact) — split, simple
- [Team](/blocks/team) — grid, spotlight
- [Gallery](/blocks/gallery) — grid with lightbox, masonry
- [Process](/blocks/process) — steps, timeline
- [Newsletter](/blocks/newsletter) — centered, split
- [Consent](/blocks/consent) — cookie banner

### Blog (4)

Editorial sections for a content site — pair with the [`blog` feature](/guides/blog/) for the
database-backed posts behind them:

- [Blog](/blocks/blog) — post-list, post-header, post-body, related

### Cards (30)

- [People](/blocks/cards/people) — profile, contact, testimonial
- [Data & Dashboard](/blocks/cards/data) — stat, progress, chart, balance
- [Auth & Marketing](/blocks/cards/auth) — login, feature
- [Media](/blocks/cards/media) — article, music, video, gallery
- [Commerce](/blocks/cards/commerce) — product, pricing, order, review
- [Utility & System](/blocks/cards/utility) — notification, weather, event, file, task, storage, code, map, integration, poll, stepper, chat, pick list

### Storefront (36)

The Mercato commerce blocks:
[Layout](/blocks/storefront/layout) ·
[Home Sections](/blocks/storefront/home) ·
[Catalog & Cart](/blocks/storefront/catalog) ·
[Listing](/blocks/storefront/listing) ·
[Product](/blocks/storefront/product) ·
[Cart & Wishlist](/blocks/storefront/cart-wishlist) ·
[Checkout](/blocks/storefront/checkout) ·
[Account](/blocks/storefront/account)

### Auth (9)

Shared [auth blocks](/blocks/auth) — brand, shell, card, social row, divider, field, password strength, OTP input, form messages.

### Files (3)

[Upload Area](/blocks/files/upload-area) ·
[Crop Image](/blocks/files/crop-image) ·
[Image Dialog](/blocks/files/image-dialog)

## Theming

Blocks consume **semantic tokens only** — `bg-card`, `text-foreground`, `font-display`. Swap themes without touching the block:

```bash
bun x bosia@latest add theme editorial
```

See [Themes](/themes/overview).
