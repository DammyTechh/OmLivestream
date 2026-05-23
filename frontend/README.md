# OmliveStream Frontend

Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion + Three.js.

## Setup

```bash
npm install
cp .env.local.example .env.local
# set NEXT_PUBLIC_API_URL to your backend
npm run dev
```

Opens at `http://localhost:3000`.

## Route Map

| Path                                    | Purpose                                              | Auth       |
|-----------------------------------------|------------------------------------------------------|------------|
| `/`                                     | Landing page (hero, features, pricing, contact)      | Public     |
| `/auth/signup`                          | Sign up with email or social                         | Public     |
| `/auth/signin`                          | Sign in with email or social                         | Public     |
| `/auth/verify`                          | OTP verification (6-digit code)                      | Public     |
| `/onboarding`                           | 3-step new user onboarding                           | User       |
| `/dashboard`                            | User overview (stats, recent streams)                | User       |
| `/dashboard/streams`                    | List of all streams                                  | User       |
| `/dashboard/streams/new`                | Create new stream                                    | User       |
| `/dashboard/streams/[id]`               | Live control room (Socket.io real-time comments)     | User       |
| `/dashboard/recordings`                 | Recordings list, AI edit, download, delete          | User       |
| `/dashboard/platforms`                  | Connect/disconnect streaming platforms (OAuth)       | User       |
| `/dashboard/analytics`                  | Views, impressions, engagement charts                | User       |
| `/dashboard/billing`                    | Plan + invoice history                               | User       |
| `/dashboard/settings`                   | Profile, account deletion                            | User       |
| `/payment`                              | Paystack checkout page                               | User       |
| `/admin`                                | Admin login                                          | Public     |
| `/admin/dashboard`                      | Admin KPIs + revenue / growth charts                 | Admin      |
| `/admin/users`                          | User management (flag, suspend, ban, restore)        | Admin      |
| `/admin/contact`                        | Contact form inbox (unread / read / replied)         | Admin      |
| `/admin/broadcasts`                     | Email broadcasts list                                | Admin      |
| `/admin/broadcasts/new`                 | Compose email campaign (segmented + scheduled)       | Admin      |
| `/admin/payments`                       | All transactions                                     | Admin      |

## Architecture

- **API client**: `src/lib/api.ts` with JWT refresh interceptor. Separate token stores for user vs admin (`omlive_access` / `omlive_admin_access`).
- **Auth stores**: Zustand-based (`src/store/auth.ts`). Two independent stores: `useAuth` and `useAdmin`.
- **Protected routes**: `AuthGuard` and `AdminGuard` components — check hydrated tokens and redirect if unauthenticated.
- **Real-time**: Stream detail page uses `socket.io-client` to subscribe to live viewers + unified cross-platform comments.
- **3D**: Hero section uses `@react-three/fiber` + `@react-three/drei` with morphing blobs.

## Design System

- **Fonts**: Fraunces (display / headings), DM Sans (body), JetBrains Mono
- **Colors**: Deep purple base (`#07050F`) with primary `#A855F7` and accent `#EC4899`
- **Motion**: Framer Motion for page transitions, CSS keyframes for ambient animations
- **Glass + Aurora**: Backdrop-blur glass cards layered over animated aurora gradients + noise texture

## Environment

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```
