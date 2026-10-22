/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  output: "standalone",
  // The optimizer re-requests images internally without the browser's Host,
  // which the request guard rejects; it also turns /_next/image into a
  // server-side fetch of arbitrary local paths.
  images: { unoptimized: true },
};

export default nextConfig;
