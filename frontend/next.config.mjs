/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Brand art is self-hosted from public/ — imgur was removed along with
    // the hot-linked logo and illustrations it used to serve.
    remotePatterns: [
      // Supabase storage (avatars, thumbnails)
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
};
export default nextConfig;

