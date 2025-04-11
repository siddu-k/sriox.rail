const express = require('express');
const multer = require('multer');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const settings = require('../upload_settings');

const app = express();
app.use(cors());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Handle favicon.ico requests
app.use((req, res, next) => {
  if (req.url === '/favicon.ico') {
    res.status(204).end(); // No Content
  } else {
    next();
  }
});

// Configure multer for memory storage
const upload = multer({
  limits: {
    fileSize: settings.MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/zip') {
      cb(new Error('Only ZIP files are allowed'));
      return;
    }
    cb(null, true);
  }
});

// Validate subdomain format
const validateSubdomain = (subdomain) => {
  if (!subdomain || typeof subdomain !== 'string') {
    throw new Error('Subdomain is required');
  }

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/i.test(subdomain)) {
    throw new Error('Invalid subdomain format. Use only letters, numbers, and hyphens');
  }

  if (settings.RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
    throw new Error('This subdomain is reserved');
  }
};

// Configure GitHub client
const octokit = new Octokit({
  auth: settings.GITHUB_TOKEN
});

app.post('/api/deploy', upload.single('zip'), async (req, res) => {
  const subdomain = req.body.subdomain?.toLowerCase();
  const tempDir = path.join('/tmp', `${subdomain}-${Date.now()}`);

  try {
    // Validate inputs
    validateSubdomain(subdomain);
    if (!req.file) {
      throw new Error('ZIP file is required');
    }

    // Extract ZIP
    await fs.ensureDir(tempDir);
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(tempDir, true);

    // Validate extracted contents
    const hasIndex = await fs.pathExists(path.join(tempDir, 'index.html'));
    if (!hasIndex) {
      throw new Error('ZIP file must contain an index.html file');
    }

    // Create GitHub repository
    const repoName = `${settings.GITHUB_REPO_PREFIX}-${subdomain}`;
    try {
      await octokit.repos.createInOrg({
        org: settings.GITHUB_ORG,
        name: repoName,
        auto_init: false,
        private: false,
        description: `Deployed site for ${subdomain}.${settings.DOMAIN}`
      });
    } catch (error) {
      if (error.status === 422) {
        throw new Error('This subdomain is already in use');
      }
      throw error;
    }

    // Create default branch
    const defaultBranch = 'main';

    // Upload files to GitHub
    const files = await fs.readdir(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const content = await fs.readFile(filePath);
      await octokit.repos.createOrUpdateFileContents({
        owner: settings.GITHUB_ORG,
        repo: repoName,
        path: file,
        message: `Deploy ${file}`,
        content: content.toString('base64'),
        branch: defaultBranch
      });
    }

    // Enable GitHub Pages
    await octokit.repos.createPagesSite({
      owner: settings.GITHUB_ORG,
      repo: repoName,
      source: {
        branch: defaultBranch,
        path: '/'
      }
    });

    // Configure Cloudflare DNS
    const cloudflareResponse = await axios({
      method: 'POST',
      url: `https://api.cloudflare.com/client/v4/zones/${settings.ZONE_ID}/dns_records`,
      headers: {
        'Authorization': `Bearer ${settings.CLOUDFLARE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: {
        type: 'CNAME',
        name: subdomain,
        content: `${settings.GITHUB_ORG}.github.io`,
        proxied: true,
        ttl: 1
      }
    });

    if (!cloudflareResponse.data.success) {
      throw new Error('Failed to configure DNS');
    }

    // Return success response
    res.json({
      success: true,
      url: `https://${subdomain}.${settings.DOMAIN}`,
      github_url: `https://github.com/${settings.GITHUB_ORG}/${repoName}`,
      message: 'Deployment successful! Site will be live in a few minutes.'
    });

  } catch (error) {
    console.error('Deployment error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    // Cleanup
    await fs.remove(tempDir);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start the server
const PORT = process.env.PORT || 3000; // Ensure PORT is used
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
