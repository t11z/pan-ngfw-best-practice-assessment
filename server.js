const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

app.post('/api/upload', upload.single('file'), async (req, res) => {
  const { clientId, clientSecret, tsgId, email } = req.body;
  const filePath = req.file.path;

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

    const authText = await auth.text();
    let authData;

    try {
      authData = JSON.parse(authText);
    } catch (e) {
      console.error('❌ Failed to parse auth response:', authText);
      return res.status(500).json({ error: 'OAuth response was not valid JSON' });
    }

    console.log('✅ OAuth token fetched:', authData.access_token);
    const token = authData.access_token;
    if (!token) return res.status(500).json({ error: 'No token received from OAuth server' });

    // Step 2: Request BPA job
    console.log('➡️ Sending BPA job request...');
    const bpaRes = await fetch('https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 'requester-email': email })
    });

    const bpaText = await bpaRes.text();
    console.log('📥 BPA response status:', bpaRes.status);
    console.log('📥 BPA response body:', bpaText);

    if (!bpaRes.ok) {
      return res.status(500).json({ error: 'Failed to start BPA job', details: bpaText });
    }

    const bpa = JSON.parse(bpaText);
    const jobId = bpa.id;
    const uploadUrl = bpa['upload-url'];

    // Step 3: Upload file
    const uploadFile = fs.readFileSync(filePath);
    await fetch(uploadUrl, {
      method: 'PUT',
      body: uploadFile,
      headers: { 'Content-Type': 'application/octet-stream' }
    });

    // Step 4: Poll until report is ready
    let reportReady = false, attempts = 0;
    while (!reportReady && attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const status = await statusRes.json();
      if (status.status && status.status.includes('COMPLETED')) {
        reportReady = true;
      } else if (status.status && status.status.includes('FAILED')) {
        return res.status(500).json({ error: 'BPA job failed.' });
      }
      attempts++;
    }

    if (!reportReady) return res.status(500).json({ error: 'Timeout waiting for BPA job.' });

    // Step 5: Download report
    const reportRes = await fetch(`https://api.stratacloud.paloaltonetworks.com/aiops/bpa/v1/reports/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const reportMeta = await reportRes.json();
    const downloadRes = await fetch(reportMeta['download-url']);
    const reportData = await downloadRes.json();

    fs.unlinkSync(filePath);
    res.json(reportData);
  } catch (err) {
    console.error('🔥 Unexpected error:', err);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
