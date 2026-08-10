# OmliveStream Frontend — Changes Applied

Complete frontend with the changes below. (`node_modules` and `.next` are excluded —
run `npm install` then `npm run dev` / `npm run build`.)

## Bug fixes (responsive)
- **src/components/landing/AIFeatures.tsx** — AI Studio title chips overflowed off the right
  edge on mobile. Added `min-w-0 flex-1` to the truncating text span so long titles ellipsize.
- **src/components/landing/Features.tsx** — platform tiles overlapped on mobile due to fixed
  pixel offsets (`left-44`). Tiles are now pinned to container edges on mobile and the original
  desktop layout is restored from `md` up; connecting lines split into mobile + desktop sets.

## New pages
- **src/app/about/page.tsx** + **src/components/landing/AboutContent.tsx** — `/about`, built
  from the project brief, matching the existing design system and motion style.
- **src/app/terms/page.tsx** — `/terms`, 21 standard sections for a subscription streaming platform.
- **src/app/privacy/page.tsx** — `/privacy`, standard privacy policy (collection, use, sharing,
  third-party platform integrations, cookies, retention, security, your rights).

## Minor
- **src/components/landing/Footer.tsx** — added an "About" link. Privacy & Terms were already linked.

## Placeholders to confirm before launch
- Terms contact email: `support@omlivestream.com`
- Privacy contact email: `privacy@omlivestream.com`
- Governing law: Nigeria (inferred from ₦ pricing)
- "Last updated" dates on both legal pages

These are solid standard documents, but have them reviewed by qualified legal counsel for your
specific situation before you rely on them.

## Note
`next@14.2.15` has a flagged security advisory — consider bumping to a patched 14.2.x.
