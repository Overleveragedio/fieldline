# Fieldline — Industrial Sourcing Intelligence

AI-powered sourcing tool for pipes, valves, fittings, and flanges.
Enter a part number or upload a nameplate photo — the AI searches the web and
returns distributor contacts, manufacturer info, spec sheets, and cross-references.

---

## Quick Start

### 1. Prerequisites
- [Node.js 18+](https://nodejs.org/) installed on your machine or server

### 2. Install
```bash
# Unzip the package, then:
cd fieldline
npm install
```

### 3. Add your API key
```bash
cp .env.example .env
```
Open `.env` and paste in your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-XXXXXXXX...
```
Get a key at https://console.anthropic.com/settings/keys

### 4. Run
```bash
npm start
```
Open your browser to **http://localhost:3000**

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## Project Structure
```
fieldline/
├── server.js          ← Express proxy server (keeps API key off the client)
├── package.json
├── .env.example       ← Copy to .env and add your API key
├── .gitignore
├── README.md
└── public/
    └── index.html     ← The full frontend app
```

---

## Deploying to a Server (optional)

Any Linux box or cloud VM works. Example with a $6/mo DigitalOcean droplet:

```bash
# On the server:
git clone <your-repo> fieldline
cd fieldline
npm install
cp .env.example .env
nano .env                # add your API key

# Run persistently with PM2:
npm install -g pm2
pm2 start server.js --name fieldline
pm2 startup             # auto-restart on reboot
pm2 save
```

Point your domain's DNS A record at the server IP, then use
[nginx](https://nginx.org/) or [Caddy](https://caddyserver.com/) as a reverse
proxy on port 80/443 for HTTPS.

---

## Security Notes
- The `.env` file is in `.gitignore` — never commit it
- The API key never leaves the server
- The `/api/search` endpoint forwards only the fields the frontend needs
- Rate limiting can be added to `server.js` if you expose this publicly

---

## Customization
- **System prompt**: edit `buildSystemPrompt()` in `public/index.html`
- **Product type list**: add/remove options in the `<select id="typeSelect">` dropdown
- **Port**: change `PORT=3000` in `.env`
