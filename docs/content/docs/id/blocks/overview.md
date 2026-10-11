---
title: Blocks
description: Bagian UI tersusun (hero, harga, kartu) yang membawa desain bagus ke aplikasi Anda — satu perintah instal, tanpa prop untuk dirangkai.
---

## Apa itu blocks

Primitif (`Button`, `Card`, `Input`) adalah potongan toolkit tanpa gaya. Mereka memberi fleksibilitas tetapi tanpa opini. **Blocks** adalah lapisan yang hilang di atasnya — bagian tersusun dengan teks, tata letak, dan ritme tipografi yang dikode keras. Letakkan satu, lalu sunting teksnya langsung di tempat.

Blocks mengikuti filosofi shadcn: salin-tempel sumber, tanpa konfigurasi runtime, Anda memiliki filenya.

## Lapisan

```
Primitives  →  Blocks  →  Pages
(Button)       (FeatureCard)   (Landing)
```

## Install

```bash
bun x bosia@latest add block cards/feature
```

File mendarat di `src/lib/blocks/<category>/<name>/`. Dependensi primitif (Card, Button, dll.) terinstal otomatis.

## Page block tidak menyertakan navbar

Block tingkat halaman (heros, cards, sections) tidak membawa navbar situsnya sendiri — itu disengaja. Navbar, footer, dan sidebar berada di `+layout.svelte` Anda agar dirender sekali di setiap rute. Pasangkan page block dengan [navbar block](/id/blocks/navbars/standard) yang diletakkan di layout; menaruh hero di halaman dan navbar di layout memberi Anda tepat satu navbar, bukan dua.

## Block yang tersedia

150+ block dalam sepuluh kategori. Instal apa pun dengan `bun x bosia@latest add block <category>/<name>`.

### Heros (17)

Section hero landing full-bleed, satu per vertikal:
[agency](/id/blocks/heros/agency) ·
[app](/id/blocks/heros/app) ·
[apparel](/id/blocks/heros/apparel) ·
[bags](/id/blocks/heros/bags) ·
[bookstore](/id/blocks/heros/bookstore) ·
[campus](/id/blocks/heros/campus) ·
[consulting](/id/blocks/heros/consulting) ·
[course](/id/blocks/heros/course) ·
[delivery](/id/blocks/heros/delivery) ·
[home-goods](/id/blocks/heros/home-goods) ·
[lookbook](/id/blocks/heros/lookbook) ·
[new-drop](/id/blocks/heros/new-drop) ·
[product](/id/blocks/heros/product) ·
[restaurant](/id/blocks/heros/restaurant) ·
[sale](/id/blocks/heros/sale) ·
[shop-split](/id/blocks/heros/shop-split) ·
[toys](/id/blocks/heros/toys)

### Navbars (19)

- [Standard](/id/blocks/navbars/standard) — layout terang klasik: centered, split, search-led, minimal, two-tier
- [App & Interactive](/id/blocks/navbars/app) — dashboard, e-commerce, docs, mega-menu, announcement, mobile
- [Themes](/id/blocks/navbars/themes) — dark, glass, brutalist, floating pill, gradient, brand bar, overlay

### Docks (4)

[Bar navigasi bawah](/id/blocks/docks) untuk mobile — edge, floating, pill, center-FAB.

### Footers (12)

- [Standard](/id/blocks/footers/standard) — layout terang klasik: minimal, columns, newsletter, centered, mega, split-brand
- [Themes](/id/blocks/footers/themes) — dark, glass, gradient, brutalist, editorial, terminal

### Sections (28)

Section marketing untuk bagian tengah halaman — di antara hero dan footer:

- [Pricing](/id/blocks/pricing) — columns, comparison, simple
- [Testimonials](/id/blocks/testimonials) — grid, spotlight
- [FAQ](/id/blocks/faq) — accordion, grid
- [CTA](/id/blocks/cta) — banner, panel
- [Features](/id/blocks/features) — grid, split, bento
- [Stats](/id/blocks/stats) — band, cards, sentiment bar
- [Logos](/id/blocks/logos) — row, grid
- [Contact](/id/blocks/contact) — split, simple
- [Team](/id/blocks/team) — grid, spotlight
- [Gallery](/id/blocks/gallery) — grid dengan lightbox, masonry
- [Process](/id/blocks/process) — steps, timeline
- [Newsletter](/id/blocks/newsletter) — centered, split
- [Consent](/id/blocks/consent) — banner cookie

### Blog (4)

Section editorial untuk situs konten — pasangkan dengan [feature `blog`](/id/guides/blog/) untuk
post berbasis database di baliknya:

- [Blog](/id/blocks/blog) — post-list, post-header, post-body, related

### Cards (30)

- [People](/id/blocks/cards/people) — profile, contact, testimonial
- [Data & Dashboard](/id/blocks/cards/data) — stat, progress, chart, balance
- [Auth & Marketing](/id/blocks/cards/auth) — login, feature
- [Media](/id/blocks/cards/media) — article, music, video, gallery
- [Commerce](/id/blocks/cards/commerce) — product, pricing, order, review
- [Utility & System](/id/blocks/cards/utility) — notification, weather, event, file, task, storage, code, map, integration, poll, stepper, chat, pick list

### Storefront (36)

Block commerce Mercato:
[Layout](/id/blocks/storefront/layout) ·
[Home Sections](/id/blocks/storefront/home) ·
[Catalog & Cart](/id/blocks/storefront/catalog) ·
[Listing](/id/blocks/storefront/listing) ·
[Product](/id/blocks/storefront/product) ·
[Cart & Wishlist](/id/blocks/storefront/cart-wishlist) ·
[Checkout](/id/blocks/storefront/checkout) ·
[Account](/id/blocks/storefront/account)

### Auth (9)

[Block auth](/id/blocks/auth) bersama — brand, shell, card, social row, divider, field, password strength, OTP input, form messages.

### Files (3)

[Upload Area](/id/blocks/files/upload-area) ·
[Crop Image](/id/blocks/files/crop-image) ·
[Image Dialog](/id/blocks/files/image-dialog)

## Theming

Blocks hanya mengonsumsi **token semantik** — `bg-card`, `text-foreground`, `font-display`. Ganti tema tanpa menyentuh block:

```bash
bun x bosia@latest add theme editorial
```

Lihat [Themes](/id/themes/overview).
