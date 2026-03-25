# Security Operations Mini Dashboard

Realtime SOC-style mini dashboard for demonstrating `DoS/DDoS attack and defense` on `AWS EC2 Ubuntu` with `Nginx + Node.js + Socket.IO + PM2`.

## Features

- Public demo page at `/` with lightweight content and `/api/ping`.
- Protected admin dashboard at `/dashboard` with login session.
- Realtime metrics from Linux and Nginx:
  - CPU, RAM, load average, disk usage
  - network in / out
  - requests per second
  - average response time
  - active connections
  - reading / writing / waiting
  - 2xx / 4xx / 5xx rates
  - top client IPs
  - unique source IP count
- Attack heuristics for `NORMAL`, `UNDER DOS`, `UNDER DDOS`, `DEFENSE ENABLED`.
- Real Nginx defense controls:
  - rate limiting
  - connection limiting
  - emergency mode
  - safe reload with `nginx -t`
- Realtime logs and 60-second charts.

## Project structure

```text
.
|-- config/
|   |-- nginx/
|   |   |-- conf.d/
|   |   |-- snippets/
|   |   |-- emergency.html
|   |   `-- security-dashboard-site.conf
|-- public/
|   |-- dashboard.html
|   |-- dashboard.js
|   |-- index.html
|   |-- login.html
|   |-- login.js
|   |-- public-app.js
|   `-- styles.css
|-- routes/
|   |-- api.js
|   `-- defense.js
|-- scripts/
|   |-- demo-ddos-worker.sh
|   |-- demo-dos.sh
|   |-- install-nginx-config.sh
|   `-- setup-ubuntu.sh
|-- server/
|   |-- app.js
|   `-- index.js
|-- services/
|   |-- auth/
|   |   `-- sessionAuth.js
|   |-- logs/
|   |   `-- eventLogService.js
|   |-- metrics/
|   |   |-- accessLogParser.js
|   |   |-- attackStateAnalyzer.js
|   |   |-- metricsEngine.js
|   |   |-- nginxStatusCollector.js
|   |   `-- systemCollector.js
|   `-- nginx/
|       `-- defenseManager.js
|-- .env.example
|-- ecosystem.config.js
|-- package.json
`-- README.md
```

## 1. Install dependencies

### Local Ubuntu / EC2

```bash
cp .env.example .env
npm install
```

If Node.js is not installed yet on Ubuntu EC2:

```bash
chmod +x scripts/setup-ubuntu.sh
./scripts/setup-ubuntu.sh
```

## 2. Configure `.env`

Create `.env` from `.env.example` and update at least:

```env
PORT=3000
DASHBOARD_USER=admin
DASHBOARD_PASS=your-strong-password
SESSION_SECRET=replace-with-long-random-secret
NGINX_STATUS_URL=http://127.0.0.1/nginx_status
NGINX_ACCESS_LOG_PATH=/var/log/nginx/security_dashboard_access.log
NGINX_TEST_COMMAND=sudo nginx -t
NGINX_RELOAD_COMMAND=sudo systemctl reload nginx
```

Recommended:

- keep `PORT=3000`
- keep dashboard private behind login
- use a strong `SESSION_SECRET`
- keep `COOKIE_SECURE=false` if demo is only HTTP on EC2
- set `COOKIE_SECURE=true` only if you put HTTPS in front

## 3. Configure Nginx

### Copy the sample configuration

```bash
chmod +x scripts/install-nginx-config.sh
./scripts/install-nginx-config.sh
```

This script installs:

- site config to `/etc/nginx/sites-available/security-dashboard.conf`
- log format config to `/etc/nginx/conf.d/security-dashboard-log-format.conf`
- defense snippet to `/etc/nginx/snippets/security-dashboard-defense.conf`
- emergency page to `/var/www/html/security-dashboard-emergency.html`

### Manual installation

If you prefer manual steps:

```bash
sudo cp config/nginx/conf.d/security-dashboard-log-format.conf /etc/nginx/conf.d/
sudo cp config/nginx/snippets/security-dashboard-defense.conf /etc/nginx/snippets/
sudo cp config/nginx/emergency.html /var/www/html/security-dashboard-emergency.html
sudo cp config/nginx/security-dashboard-site.conf /etc/nginx/sites-available/security-dashboard.conf
sudo ln -sf /etc/nginx/sites-available/security-dashboard.conf /etc/nginx/sites-enabled/security-dashboard.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 4. Enable `stub_status`

The sample site config already includes:

```nginx
location = /nginx_status {
    stub_status;
    access_log off;
    allow 127.0.0.1;
    allow ::1;
    deny all;
}
```

Important:

- `/nginx_status` must not be public on the internet
- the backend reads it from `http://127.0.0.1/nginx_status`

## 5. Configure access log with `request_time`

The parser expects a log format like this:

```nginx
log_format soc_dashboard
    '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" rt=$request_time';
```

The sample site config uses:

```nginx
access_log /var/log/nginx/security_dashboard_access.log soc_dashboard;
```

Create the log file if it does not exist:

```bash
sudo touch /var/log/nginx/security_dashboard_access.log
sudo chown www-data:adm /var/log/nginx/security_dashboard_access.log
```

## 6. Run app locally

### Development

```bash
npm install
npm run dev
```

### Production

```bash
npm install --omit=dev
npm start
```

Open:

- `http://SERVER_IP/` for the public demo page
- `http://SERVER_IP/dashboard` for the admin dashboard

## 7. Deploy on AWS EC2 Ubuntu

### EC2 Security Group

Open at least:

- `22/tcp` for SSH
- `80/tcp` for HTTP

Optional:

- `443/tcp` if you later add HTTPS

Do not expose:

- `3000/tcp` publicly if Nginx is reverse proxying locally

### Deployment flow

```bash
ssh ubuntu@YOUR_EC2_PUBLIC_IP
git clone <your-repo-or-copy-project>
cd security-operations-mini-dashboard
cp .env.example .env
npm install --omit=dev
./scripts/install-nginx-config.sh
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Configure PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

Follow the `pm2 startup` command output once, then run:

```bash
pm2 save
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs security-ops-dashboard
pm2 restart security-ops-dashboard
```

## 9. Test dashboard

1. Visit `http://EC2_PUBLIC_IP/dashboard`
2. Login with `DASHBOARD_USER` and `DASHBOARD_PASS`
3. Confirm charts and cards start updating every second
4. Check that `/api/ping` works on the public page
5. Confirm `/nginx_status` is blocked from public internet

Recommended terminal checks:

```bash
curl http://127.0.0.1/nginx_status
tail -f /var/log/nginx/security_dashboard_access.log
pm2 logs security-ops-dashboard
```

## 10. Test defense buttons

From the dashboard:

1. Click `Enable Rate Limiting`
2. Click `Enable Connection Limiting`
3. Click `Enable Emergency Mode`
4. Click `Reload Nginx` if needed
5. Disable them again after the test

What happens internally:

- app writes only its managed Nginx files
- app creates backups before changing them
- app runs `nginx -t`
- if config test fails, app rolls back
- only then app runs `systemctl reload nginx`

Note:

- the app user must be allowed to run `sudo nginx -t` and `sudo systemctl reload nginx`
- simplest demo setup is to allow these two commands in sudoers for the service account

## 11. Demo DoS and DDoS from other machines

### Scenario A: DoS

Run from one attacker machine:

```bash
chmod +x scripts/demo-dos.sh
./scripts/demo-dos.sh http://EC2_PUBLIC_IP/ 10000 200
```

Expected dashboard behavior:

- `requests/sec` spikes sharply
- `active connections` increases
- one source IP dominates the `Top 5 Source IPs`
- `unique source IP count` stays low
- mode trends toward `UNDER DOS`

### Scenario B: DDoS

Run from multiple different machines or cloud lab instances at the same time.

On each attacking client:

```bash
chmod +x scripts/demo-ddos-worker.sh
./scripts/demo-ddos-worker.sh http://EC2_PUBLIC_IP/ 5000 120
```

Expected dashboard behavior:

- higher combined `requests/sec`
- `active connections` increases further
- `unique source IP count` increases
- traffic distribution becomes more spread out
- mode trends toward `UNDER DDOS`

Important:

- for a real DDoS-style demo, use multiple source machines
- multiple terminals on the same machine will still look like a single source IP in Nginx logs

## API reference

Protected routes:

- `GET /api/metrics/current`
- `GET /api/metrics/history`
- `GET /api/logs/recent`
- `POST /api/defense/rate-limit/enable`
- `POST /api/defense/rate-limit/disable`
- `POST /api/defense/conn-limit/enable`
- `POST /api/defense/conn-limit/disable`
- `POST /api/defense/emergency/enable`
- `POST /api/defense/emergency/disable`
- `POST /api/nginx/reload`
- `GET /api/status`

Public route:

- `GET /api/ping`

## Heuristic notes

The attack analyzer is heuristic, not a full IDS:

- request spike compared with moving baseline
- low unique IP count + dominant top IP => DoS-like behavior
- high unique IP count + distributed traffic => DDoS-like behavior
- any active defense control changes mode to `DEFENSE ENABLED`

This is intentionally simple so the demo is easy to explain in class.

## Operational notes

- The collectors are designed not to crash the whole app if one metric source fails.
- If access log parsing fails, the dashboard keeps running and shows collector warnings.
- The dashboard is optimized for desktop presentation.
- `Chart.js` is served locally from `node_modules`, so the demo does not depend on external CDNs.

## Recommended EC2 demo checklist

1. Start PM2 and Nginx
2. Open dashboard on projector
3. Show normal traffic first
4. Trigger DoS from one remote machine
5. Explain top IP dominance and low unique source count
6. Enable rate limit or connection limit
7. Trigger DDoS from multiple machines
8. Explain higher unique source count and traffic spread
9. Enable emergency mode
10. Show mitigation and recovery
