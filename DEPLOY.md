# Fieldline — Deployment Guide

## What You Need

- A domain name (~$10/year)
- A VPS server (~$6/month)
- Your code on GitHub
- ~30 minutes

---

## Step 1: Buy a Domain

Go to **Cloudflare Registrar** (https://dash.cloudflare.com) — cheapest long-term, no markup on renewals.

Good options to search for:
- `fieldline.io`
- `fieldlinesourcing.com`
- `getfieldline.com`

Alternative: **Namecheap** (https://namecheap.com) if Cloudflare doesn't have what you want.

**Don't configure anything yet** — just buy the domain. We'll set up DNS in Step 5.

---

## Step 2: Push Your Code to GitHub

On your local machine (where Fieldline lives now):

```bash
cd /path/to/fieldline

# Initialize git if you haven't already
git init
git add .
git commit -m "Initial commit"

# Create a repo on GitHub (install gh CLI first: https://cli.github.com)
gh repo create fieldline --private --source=. --push
```

Or manually: go to https://github.com/new, create a **private** repo called `fieldline`, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/fieldline.git
git branch -M main
git push -u origin main
```

**Important:** Double-check that `.env` and `fieldline.db` are NOT in your repo (they're in `.gitignore`).

---

## Step 3: Get a VPS on DigitalOcean

1. Go to https://digitalocean.com and create an account
2. Click **Create → Droplets**
3. Settings:
   - **Region:** San Francisco (SFO) or Toronto (TOR) — pick closest to your users
   - **Image:** Ubuntu 24.04 LTS
   - **Plan:** Basic → Regular → **$6/mo** (1 GB RAM, 25 GB SSD)
   - **Authentication:** Choose **SSH Key** (more secure) or Password
4. Click **Create Droplet**
5. Copy the **IP address** it gives you (e.g. `143.198.xxx.xxx`)

### If you chose SSH key:
You'll need to generate one if you don't have one:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub   # Copy this into DigitalOcean
```

---

## Step 4: Deploy with the Script

### Upload and run:

```bash
# From your local machine, copy the deploy script to your server
scp deploy.sh root@YOUR_SERVER_IP:~

# SSH into your server
ssh root@YOUR_SERVER_IP

# Edit the script first — set your domain and repo URL
nano deploy.sh
# Change these two lines near the top:
#   DOMAIN="yourdomain.com"      →  DOMAIN="fieldline.io"  (your actual domain)
#   REPO_URL=""                  →  REPO_URL="https://github.com/you/fieldline.git"

# Run it
chmod +x deploy.sh
./deploy.sh
```

The script will pause and ask you to edit `.env` — paste in your real keys:

```bash
nano /opt/fieldline/.env
```

Fill in at minimum:
- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/settings/keys
- `PRIVY_APP_ID` — from https://dashboard.privy.io
- `LEMONSQUEEZY_WEBHOOK_SECRET` — from https://app.lemonsqueezy.com

Press Enter to continue, and the script finishes setting everything up.

---

## Step 5: Point Your Domain (DNS)

Go to wherever you bought your domain (Cloudflare or Namecheap).

Add an **A Record**:
- **Type:** A
- **Host/Name:** `@`
- **Value:** Your server's IP address (e.g. `143.198.xxx.xxx`)
- **TTL:** Auto

If using Cloudflare, set the proxy status to **DNS only** (grey cloud) for now — Caddy handles HTTPS.

Wait 5–10 minutes for DNS to propagate.

---

## Step 6: Verify

Visit `https://yourdomain.com` in your browser. You should see Fieldline!

If something's wrong:

```bash
# Check if the app is running
pm2 status
pm2 logs fieldline

# Check if Caddy is working
systemctl status caddy
journalctl -u caddy --no-pager -n 50

# Test locally on the server
curl http://localhost:3000
```

---

## Day-to-Day Commands

| What | Command |
|------|---------|
| View logs | `pm2 logs fieldline` |
| Restart app | `pm2 restart fieldline` |
| Live monitoring | `pm2 monit` |
| Edit env vars | `nano /opt/fieldline/.env` then `pm2 restart fieldline` |
| Deploy updates | `cd /opt/fieldline && git pull && npm install --production && pm2 restart fieldline` |
| Check Caddy | `systemctl status caddy` |

---

## Estimated Costs

| Item | Cost |
|------|------|
| Domain | ~$10/year |
| DigitalOcean Droplet | $6/month |
| **Total** | **~$82/year** |
