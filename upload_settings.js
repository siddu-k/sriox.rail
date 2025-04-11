module.exports = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  CLOUDFLARE_TOKEN: process.env.CLOUDFLARE_TOKEN,
  ZONE_ID: process.env.CLOUDFLARE_ZONE_ID,
  DOMAIN: 'sriox.com',
  GITHUB_ORG: process.env.GITHUB_ORG || 'sriox-user-sites',
  GITHUB_REPO_PREFIX: 'site',
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ALLOWED_FILE_TYPES: ['.zip'],
  RESERVED_SUBDOMAINS: ['www', 'api', 'admin', 'test', 'staging']
};