/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build to plain static files (packages/dashboard/out). Loclyn's dashboard
  // server serves them, so no separate Next.js process is needed to use it.
  output: "export",
};

export default nextConfig;