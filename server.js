const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const fs = require('fs');
const tar = require('tar');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });

const basePath = process.env.BASE_PATH || '/';
app.use(basePath, express.static('public'));

function extractSystemInfo(fileContent) {
  const systemInfoSectionMatch = fileContent.match(/> show system info\s*([\s\S]*?)(\n> |\n?$)/);
  if (!systemInfoSectionMatch) return {};

  const section = systemInfoSectionMatch[1];

  const extractLineValue = (label) => {
    const match = section.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };

  return {
    serial: extractLineValue('serial'),
    model: extractLineValue('model'),
    version: extractLineValue('sw-version'),
    family: extractLineValue('family')
  };
}

function assertRequiredFields(info) {
  const missingFields = ['serial', 'model', 'version', 'family'].filter((field) => !info[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required system info fields: ${missingFields.join(', ')}`);
  }
}



app.post(`${basePath}api/upload`, upload.single('file'), async (req, res) => {
  const { email, requesterName } = req.body;
  const filePath = req.file.path;
  const extractDir = `extracted_${uuidv4()}`;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const tsgId = process.env.TSG_ID;

  if (!email || !requesterName) {
    return res.status(400).json({ error: 'Requester email and name are required.' });
  }

  if (!clientId || !clientSecret || !tsgId) {
    return res.status(500).json({ error: 'Client credentials or TSG ID are not configured on the server.' });
  }

  try {
    // Step 1: Get OAuth token
    const auth = await fetch('https://auth.apps.paloaltonetworks.com/oauth2/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=client_credentials&scope=tsg_id:${tsgId}`
    });

    const authData = await auth.json();
    const token = authData.access_token;
    if (!token) throw new Error('OAuth token missing');
    console.log('✅ OAuth token fetched:', token);

    // Step 2: Extract .tgz
    fs.mkdirSync(extractDir, { recursive: true });
    await tar.x({ file: filePath, cwd: extractDir });
    const cliDir = path.join(extractDir, 'tmp', 'cli');
    const cliFiles = fs.readdirSync(cliDir).filter(f => f.endsWith('.txt'));
    if (cliFiles.length === 0) throw new Error('No CLI info file found in Tech Support');
    const cliContent = fs.readFileSync(path.join(cliDir, cliFiles[0]), 'utf8');
    const info = extractSystemInfo(cliContent);
    assertRequiredFields(info);

    // Step 3: Request BPA job
    const normalizedRequesterName = (requesterName || email || '').trim();
    if (!normalizedRequesterName) {
      throw new Error('Requester name could not be determined.');
    }

    const bpaRes = await fetch('https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requesterEmail: email,
        requesterName: normalizedRequesterName,
        serial: info.serial,
        model: info.model,
        version: info.version,
        family: info.family
      })
    });

    const bpaText = await bpaRes.text();
    console.log('📥 BPA response status:', bpaRes.status);
    console.log('📥 BPA response body:', bpaText);

    if (!bpaRes.ok) {
      throw new Error(`Failed to start BPA job: ${bpaText}`);
    }

    const bpa = JSON.parse(bpaText);
    const jobId = bpa.id;
    const uploadUrl = bpa['upload-url'];

    // Step 4: Upload original file to AIOps
    const uploadFile = fs.readFileSync(filePath);
    await fetch(uploadUrl, {
      method: 'PUT',
      body: uploadFile,
      headers: { 'Content-Type': 'application/octet-stream' }
    });

    // Step 5: Poll for report readiness
    let reportReady = false, attempts = 0;
    while (!reportReady && attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!statusRes.ok) {
        const statusText = await statusRes.text();
        throw new Error(`Failed to fetch BPA job status: ${statusRes.status} ${statusText}`);
      }

      const status = await statusRes.json();
      if (status.status === 'COMPLETED_WITH_SUCCESS') {
        reportReady = true;
      } else if (status.status === 'COMPLETED_WITH_ERROR') {
        throw new Error('BPA job completed with an error');
      }
      attempts++;
    }

    if (!reportReady) throw new Error('Timeout waiting for BPA job.');

    const reportRes = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/reports/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!reportRes.ok) {
      const reportText = await reportRes.text();
      throw new Error(`Failed to fetch BPA report metadata: ${reportRes.status} ${reportText}`);
    }

    const reportMeta = await reportRes.json();
    const downloadUrl = reportMeta['download-url'];

    if (!downloadUrl) throw new Error('BPA report download URL missing from response');

    res.json({
      id: jobId,
      'download-url': downloadUrl
    });
  } catch (err) {
    console.error('🔥 Error:', err);
    res.status(500).json({ error: err.message || 'Unexpected error' });
  } finally {
    // Clean up files and dirs
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
