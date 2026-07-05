/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // WebSocketの二重接続を避けるため開発時もoff
};

module.exports = nextConfig;
