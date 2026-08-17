# Production Deployment & Operations Guide

## Overview

This guide details the procedure for deploying the **LAN-First Restaurant POS Hub** in a physical restaurant setting (e.g. Hotel Mejwani).

---

## 1. Network Infrastructure Setup

### Wi-Fi Router Requirements
- A dedicated Wi-Fi router (e.g. TP-Link, Netgear, or Ubiquiti) installed inside the restaurant.
- **SSID Recommendation**: `Mejwani-POS-Internal` (Password protected).
- **Subnet Reservation**: Assign a Static IP reservation for the Reception Laptop (e.g. `192.168.1.50`).

### Windows Firewall Configuration (Reception Laptop)
On Windows, Windows Defender Firewall blocks incoming TCP connections on port `4000` by default.

To allow Waiter phones to reach the hub server, run PowerShell as Administrator:
```powershell
New-NetFirewallRule -DisplayName "Mejwani POS Hub Server (Port 4000)" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
```

---

## 2. Server Startup & Service Management

### Manual Startup
```bash
cd /path/to/SAAS_Restaurant
npm run build
npm run hub
```

### Auto-Start on Windows Boot (pm2 or nssm)
To ensure the hub server restarts automatically if the laptop reboots:

Using `pm2`:
```bash
npm install -g pm2
pm2 start hub_server/server.js --name "mejwani-pos-hub"
pm2 save
pm2 startup
```

---

## 3. Waiter Handset PWA Onboarding

1. Connect waiter mobile phone to `Mejwani-POS-Internal` Wi-Fi.
2. Scan the QR code displayed on the Kitchen KDS screen or open `http://<hub-ip>:4000/waiter`.
3. In Chrome/Safari, tap **"Add to Home Screen"**.
4. Launch the installed PWA app from the home screen.

---

## 4. Verification Checklist

| Step | Action | Expected Behavior | Pass/Fail |
|---|---|---|---|
| 1 | Open Waiter App on phone | Displays pairing code input or auto-pairs to Hub LAN IP | [ ] |
| 2 | Place order for Table 4 | Order arrives on KDS in < 1 second. Table 4 turns Amber ("In Kitchen") | [ ] |
| 3 | Mark Ready on Kitchen KDS | KDS ticket marks ready. Table 4 turns Blue ("Bill Ready") on phone | [ ] |
| 4 | Disconnect Laptop Internet (WAN) | Keep router Wi-Fi active. Orders continue flowing LAN-side without error | [ ] |
| 5 | Reconnect Internet (WAN) | Cloud sync indicator updates. Pending tickets sync silently to Supabase | [ ] |
