#!/bin/bash
# ─────────────────────────────────────────────────────────────
# FIELDLINE — One-Shot Server Deployment Script
# Run this on a fresh Ubuntu 22.04/24.04 VPS (e.g. DigitalOcean)
#
# Usage:
#   1. scp this file to your server:  scp deploy.sh root@YOUR_IP:~
#   2. SSH in:                        ssh root@YOUR_IP
#   3. Run it:                        chmod +x deploy.sh && ./deploy.sh
#
# What it does:
#   - Installs Node.js 20, Git, Caddy
#   - Clones your repo (or pulls if already cloned)
#   - Installs dependencies
#   - Sets up PM2 to keep Fieldline running
#   - Configures Caddy for auto-HTTPS reverse proxy
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIG — Edit these before running ──────────────────────
DOMAIN="yourdomain.com"           # Your domain (e.g. fieldline.io)
REPO_URL=""                       # Your GitHub repo URL (e.g. https://github.com/you/fieldline.git)
APP_DIR="/opt/fieldline"          # Where the app lives on the server
NODE_VERSION="20"                 # Node.js major version
# ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   FIELDLINE DEPLOYMENT SCRIPT        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Validate config ─────────────────────────────────────────
if [ "$DOMAIN" = "yourdomain.com" ]; then
  echo -e "${RED}✗ Edit deploy.sh first — set DOMAIN to your actual domain.${NC}"
  exit 1
fi

if [ -z "$REPO_URL" ]; then
  echo -e "${RED}✗ Edit deploy.sh first — set REPO_URL to your GitHub repo URL.${NC}"
  exit 1
fi

# ── 1. System updates ──────────────────────────────────────
echo -e "${YELLOW}[1/6] Updating system packages...${NC}"
apt update -qq && apt upgrade -y -qq

# ── 2. Install Node.js ─────────────────────────────────────
echo -e "${YELLOW}[2/6] Installing Node.js ${NODE_VERSION}...${NC}"
if ! command -v node &>/dev/null; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt install -y -qq nodejs
fi
echo -e "${GREEN}  ✓ Node $(node -v) / npm $(npm -v)${NC}"

# ── 3. Install Git ──────────────────────────────────────────
echo -e "${YELLOW}[3/6] Ensuring git is installed...${NC}"
apt install -y -qq git
echo -e "${GREEN}  ✓ Git $(git --version | awk '{print $3}')${NC}"

# ── 4. Clone/pull repo & install deps ──────────────────────
echo -e "${YELLOW}[4/6] Setting up Fieldline app...${NC}"
if [ -d "$APP_DIR" ]; then
  echo "  App directory exists — pulling latest code..."
  cd "$APP_DIR"
  git pull
else
  echo "  Cloning from $REPO_URL..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

npm install --production
echo -e "${GREEN}  ✓ Dependencies installed${NC}"

# ── Check for .env ──────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo -e "${YELLOW}  ⚠  .env created from .env.example${NC}"
  echo -e "${YELLOW}  ⚠  You MUST edit it now:  nano ${APP_DIR}/.env${NC}"
  echo -e "${YELLOW}  ⚠  At minimum, set ANTHROPIC_API_KEY${NC}"
  echo ""
  read -p "  Press Enter after you've edited .env (or Ctrl+C to abort)..."
fi

# ── 5. PM2 setup ───────────────────────────────────────────
echo -e "${YELLOW}[5/6] Setting up PM2 process manager...${NC}"
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi

# Stop existing instance if running
pm2 delete fieldline 2>/dev/null || true

pm2 start server.js --name fieldline
pm2 startup systemd -u root --hp /root 2>/dev/null || true
pm2 save
echo -e "${GREEN}  ✓ Fieldline running via PM2${NC}"

# ── 6. Caddy (reverse proxy + auto-HTTPS) ──────────────────
echo -e "${YELLOW}[6/6] Setting up Caddy web server...${NC}"
if ! command -v caddy &>/dev/null; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudflare.com/public/keys/caddy-stable.gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
  curl -1sLf 'https://dl.cloudflare.com/public/keys/caddy-stable.list' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null 2>&1 || true
  # Fallback: install via apt if available, otherwise use the official method
  apt update -qq
  apt install -y -qq caddy 2>/dev/null || {
    echo "  Installing Caddy via official installer..."
    curl -fsSL https://caddyserver.com/api/download?os=linux&arch=amd64 -o /usr/bin/caddy
    chmod +x /usr/bin/caddy
  }
fi

# Write Caddyfile
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy localhost:3000
}
EOF

systemctl restart caddy
systemctl enable caddy
echo -e "${GREEN}  ✓ Caddy configured for ${DOMAIN} with auto-HTTPS${NC}"

# ── Done! ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DEPLOYMENT COMPLETE!               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Your app is running at: https://${DOMAIN}"
echo ""
echo "  Useful commands:"
echo "    pm2 logs fieldline     — View app logs"
echo "    pm2 restart fieldline  — Restart the app"
echo "    pm2 monit              — Live monitoring"
echo "    nano ${APP_DIR}/.env   — Edit environment variables"
echo "    caddy validate         — Check Caddy config"
echo ""
echo -e "${YELLOW}  REMINDER: Make sure your domain's DNS A record${NC}"
echo -e "${YELLOW}  points to this server's IP address.${NC}"
echo ""
