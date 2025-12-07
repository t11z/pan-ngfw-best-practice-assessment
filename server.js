const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static frontend files (e.g. from any reverse proxy base path)
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// BPA Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const { clientId, clientSecret, tsgId, email } = req.body;
  const filePath = req.file?.path;

  if (!clientId || !clientSecret || !tsgId || !email || !filePath) {
    return res.status(400).json({ error: 'Missing required fields or file.' });
  }

  try {
    // Step 1: Get OAuth Token
    const authResponse = await fetch('https://auth.apps.paloaltonetworks.com/oauth2/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=client_credentials&scope=tsg_id:${tsgId}`
    });

    const authData = await authResponse.json();
    if (!authData.access_token) throw new Error('Failed to retrieve access token.');
    const token = authData.access_token;

    // Step 2: Initiate BPA job
    const jobResponse = await fetch('https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 'requester-email': email })
    });

    const jobData = await jobResponse.json();
    const jobId = jobData.id;
    const uploadUrl = jobData['upload-url'];
    if (!jobId || !uploadUrl) throw new Error('Failed to start BPA job.');

    // Step 3: Upload the file
    const fileBuffer = fs.readFileSync(filePath);
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBuffer,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    });

    if (!uploadResponse.ok) throw new Error('Failed to upload file.');

    // Step 4: Poll until report is ready
    let reportReady = false;
    let attempts = 0;
    const maxAttempts = 20;

    while (!reportReady && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 3000)); // 3 sec delay
      const statusResponse = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const statusData = await statusResponse.json();
      if (statusData.status?.includes('COMPLETED')) {
        reportReady = true;
      } else if (statusData.status?.includes('FAILED')) {
        return res.status(500).json({ error: 'BPA job failed.' });
      }

      attempts++;
    }

    if (!reportReady) return res.status(500).json({ error: 'Timeout waiting for BPA job.' });

    // Step 5: Get report
    const reportMetaResponse = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/reports/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const reportMeta = await reportMetaResponse.json();
    const downloadUrl = reportMeta['download-url'];
    if (!downloadUrl) throw new Error('No download URL received.');

    const reportDownload = await fetch(downloadUrl);
    const reportData = await reportDownload.json();

    fs.unlinkSync(filePath); // cleanup
    res.json(reportData);
  } catch (err) {
    console.error('[BPA ERROR]', err);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
