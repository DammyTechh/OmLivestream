# OmliveStream Frontend — Changes Applied

This is the complete frontend with the following changes applied.
(`node_modules` and `.next` are excluded — run `npm install` then `npm run dev` / `npm run build`.)

## Bug fixes (responsive)
- **src/components/landing/AIFeatures.tsx** — AI Studio title chips were overflowing off
  the right edge on mobile. Added `min-w-0 flex-1` to the truncating text span so long
  titles ellipsize instead of pushing the card past the viewport.
- **src/components/landing/Features.tsx** — platform tiles (TikTok/Instagram) overlapped on
  mobile because of fixed pixel offsets (`left-44`). Tiles are now pinned to the container
  edges on mobile and the original desktop layout is restored from `md` up. The decorative
  connecting lines were split into a mobile set and the original desktop set to match.

## New pages
- **src/app/about/page.tsx** + **src/components/landing/AboutContent.tsx** — `/about` page
  built from the project brief, matching the existing design system and motion style.
- **src/app/terms/page.tsx** — `/terms` Terms of Service page (21 standard sections for a
  subscription live-streaming platform).

## Minor
- **src/components/landing/Footer.tsx** — added an "About" link so `/about` is reachable.

## Placeholders to confirm in Terms (src/app/terms/page.tsx)
- Contact email: `support@omlivestream.com`
- Governing law: Nigeria (inferred from ₦ pricing)
- "Last updated" date
Have these terms reviewed by qualified legal counsel before launch. A matching /privacy
page is still needed (footer + Terms link to it).

## Note
`next@14.2.15` has a flagged security advisory — consider bumping to a patched 14.2.x.
