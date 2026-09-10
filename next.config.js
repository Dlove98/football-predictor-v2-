/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Autorise le chargement des blasons d'équipes servis par football-data.org (crests.football-data.org)
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'crests.football-data.org',
      },
      {
        protocol: 'https',
        hostname: '**.football-data.org',
      },
    ],
  },
};

module.exports = nextConfig;
