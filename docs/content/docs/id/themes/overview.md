---
title: Themes
description: Kumpulan token yang menggerakkan warna, font, dan radius di setiap block dan primitif. Ganti tema tanpa menyentuh komponen.
---

## Apa itu themes

Sebuah tema adalah file `tokens.css` yang mendefinisikan custom property `@theme` Tailwind v4 — `--color-background`, `--color-card`, `--font-display`, `--radius-lg`, dan seterusnya. Block dan primitif merujuk token ini secara semantik (`bg-card`, `font-display`), tidak pernah nilai mentah. Ganti tema → semuanya berganti gaya.

## Install

```bash
bun x bosia@latest add theme editorial
```

CLI menyalin token ke `src/lib/themes/<name>.css` dan menulis ulang import aktif di `src/app.css`. Hanya satu tema yang aktif pada satu waktu (v1).

## Tema yang tersedia

- [neutral](/themes/neutral) — palet default terinspirasi shadcn + tumpukan sistem
- [editorial](/themes/editorial) — krem hangat + display Instrument Serif
- [zinc](/themes/zinc) — biru-abu sejuk, estetika developer-tool
- [stone](/themes/stone) — abu hangat, estetika dokumen dan penerbitan
- [claude](/themes/claude) — palet violet, estetika asisten AI dan produktivitas
- [ocean](/themes/ocean) — navy pekat + teal, estetika SaaS dan aplikasi data
- [forest](/themes/forest) — hijau earthy + amber, estetika alam dan keberlanjutan
- [rose](/themes/rose) — palet rose, estetika kreatif dan gaya hidup
- [sunset](/themes/sunset) — oranye hangat + aksen pink, estetika konsumen dan marketing
- [midnight](/themes/midnight) — indigo, estetika dashboard dan analitik dark-first
- [mono](/themes/mono) — monokrom brutalist, sudut tajam + tumpukan monospace
- [amber](/themes/amber) — amber + kuning, estetika hospitality dan makanan yang nyaman
- [paper](/themes/paper) — netral cardstock hangat + brand ink-blue, nuansa editorial bersih
- [carbon](/themes/carbon) — mono brutalist, bayangan offset keras + brand oranye
- [bloom](/themes/bloom) — pink pastel lembut, radius besar + bayangan bernuansa difus
- [terminal](/themes/terminal) — fosfor hijau gelap, display mono + kilau aksen
- [sage](/themes/sage) — hijau redup yang tenang, radius kecil + bayangan kalem
- [grape](/themes/grape) — ungu lilac gelap dengan kilau aksen lembut

## Membuat tema

Lihat [Membuat tema](/themes/creating-themes).
