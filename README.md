[![Build and Publish Docker Image](https://github.com/t11z/pan-ngfw-best-practice-assessment/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/t11z/pan-ngfw-best-practice-assessment/actions/workflows/docker-publish.yml)
# AIOps BPA Report Viewer (Dockerized)

This web application allows you to upload a PAN-OS tech support or config file, authenticate using a Service Account, and retrieve a Best Practice Assessment (BPA) report via the Palo Alto Networks AIOps API.

## 🔧 Features

- Upload `.tgz` or `.xml` PAN-OS configuration files
- Enter Client ID, Client Secret, TSG ID, and email
- Generates BPA report through official AIOps for NGFW BPA API
- Displays JSON report in a clean, readable format
- Tailwind CSS design with a dark theme (inspired by Palo Alto's Gravatar styling)
- Packaged as a fully self-contained Docker container

---

## 🚀 Quickstart

### 1. Build the Docker image

```bash
docker build -t bpa-report-app .
```

### 2. Run the container

```bash
docker run -p 3000:3000 bpa-report-app
```

### 3. Open in your browser

Visit: [http://localhost:3000](http://localhost:3000)

---

## 📂 Project Structure

```
bpa-report-app/
├── public/
│   └── index.html        # Tailwind-styled frontend
├── server.js             # Express backend API proxy
├── package.json          # Node.js dependencies
├── Dockerfile            # Container definition
```

---

## 🔐 Authentication Notes

You need a valid Service Account for AIOps API access. The following fields are required:

- `Client ID`
- `Client Secret`
- `TSG ID` (Tenant Service Group ID)
- `Requester Email`

OAuth tokens are retrieved and used for all subsequent API requests.

---

## 📄 Output

The app will poll the BPA job status and, once complete, retrieve and display the full JSON report in the browser.

---

## 🛠️ Dependencies

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Palo Alto Networks AIOps BPA API](https://pan.dev/aiops/api/bpa/)

---

## 📬 Feedback & Contributions

Feel free to fork, improve, or suggest enhancements via GitHub Issues or Pull Requests.
