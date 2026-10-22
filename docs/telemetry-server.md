# Telemetry collector: setup guide

The collector is a tiny service (`server/collector/`) that receives the app's anonymous usage events, re-checks each one against the same allow-list the app uses, stores raw events for **90 days** and daily counts for **12 months**, and deletes everything past that on its own. It has no npm dependencies (Node 22's built-in SQLite), stores no IP address or device information, and keeps no web access logs.

## What it needs

Almost nothing. A few thousand events a day is a few hundred KB of data and a trickle of requests.

| Choice | Recommendation |
|---|---|
| Instance type | **t4g.nano** (2 vCPU ARM, 0.5 GiB RAM, roughly US$3 a month). Node idles around 50 MB and Caddy around 30 MB. If you want more comfort, **t4g.micro** (1 GiB, roughly US$6 a month) is the same thing with more room; you can switch later by stopping the instance and changing its type. |
| Region | **ap-south-1 (Mumbai)**, closest to the users. |
| OS image | **Ubuntu Server 24.04 LTS, Arm (64-bit)**. Pick the ARM architecture to match t4g. |
| Disk | The default 8 GiB gp3 is far more than enough. |
| Public address | An **Elastic IP**, so the address survives a stop/start. |

## 1. Launch the VM (AWS console)

1. EC2 > **Launch instance**. Name it `exman-collector`.
2. Image: Ubuntu Server 24.04 LTS, architecture **64-bit (Arm)**. Instance type: `t4g.nano`.
3. Key pair: create one (`.pem`) and keep it safe; it is how you log in.
4. Network settings > security group, three inbound rules:
   - SSH (22) from **My IP** only
   - HTTP (80) from anywhere (needed once for the HTTPS certificate)
   - HTTPS (443) from anywhere
5. Launch. Then EC2 > **Elastic IPs** > Allocate > Associate it with the instance.

## 2. Pick a hostname (no domain purchase needed)

HTTPS needs a hostname. If you don't own a domain, use a free `sslip.io` name made from the Elastic IP: for IP `13.232.10.4` the hostname is `13-232-10-4.sslip.io`. It resolves to that IP and Caddy gets a real certificate for it automatically. If you do own a domain, point an A record at the Elastic IP and use that name instead.

## 3. Install

From your computer, in a checkout of this repo:

```bash
scp -i your-key.pem -r server/collector ubuntu@<elastic-ip>:~/collector
ssh -i your-key.pem ubuntu@<elastic-ip>
sudo bash ~/collector/deploy/setup.sh 13-232-10-4.sslip.io     # your hostname
```

The script installs Node 22 and Caddy, starts the collector as a locked-down systemd service, and checks it from outside. It ends by printing the URL to use.

## 4. Turn it on in the app

1. On GitHub: repo **Settings > Secrets and variables > Actions > Variables > New repository variable**: name `TELEMETRY_URL`, value `https://<your-hostname>/t`.
2. Re-run the **OTA update** workflow (Actions tab > OTA update > Run workflow). The address is baked into the update when it is published, so the installed app (Build 12) gets it by update; no new APK is needed.
3. On the phone: Settings > App updates > Check for updates and restart. Then Settings > Privacy & data > Usage data > **Send now**. It should say "Sent N events".

Nothing is uploaded until the first-run usage-data notice has been seen, and never while the switch in Usage data is off. Turning it off also asks the collector to delete that install's raw events.

## Day to day

Read the numbers (run on the VM):

```bash
sudo DATA_DIR=/var/lib/exman-collector node --disable-warning=ExperimentalWarning /opt/exman-collector/report.mjs 30
```

It prints app versions, screen load times (median and 95th percentile), crashes, messages read vs missed per bank, feature use, import timings, and the masked message formats people reported.

Update the service after pulling a new version of this repo:

```bash
scp -i your-key.pem -r server/collector ubuntu@<elastic-ip>:~/collector
ssh -i your-key.pem ubuntu@<elastic-ip> 'sudo cp ~/collector/*.mjs /opt/exman-collector/ && sudo systemctl restart exman-collector'
```

Check health: `curl https://<hostname>/healthz` should return `{"ok":true}`. Logs: `sudo journalctl -u exman-collector -e`.

## Privacy and limits, in plain terms

- **Stored:** event name, the allow-listed fields (screen name, milliseconds, bank key, error class name, etc.), the app's random install ID, and times. **Not stored:** IP address, device model, user agent, amounts, merchants, accounts, message text (other than a masked template the user explicitly reported).
- **Retention:** raw events 90 days, daily aggregate counts 12 months, deleted automatically every hour.
- **Forget me:** turning telemetry off in the app deletes that install's raw events. Aggregated counts hold no install ID, so they cannot be traced back and are kept.
- **Abuse limits:** 256 KB per request, 100 events per batch, 120 requests a minute per address (held in memory only), 3,000 events a day per install ID. Anything not on the allow-list is dropped.
- **Backups:** none needed. The data is disposable; if the VM is lost, the app keeps its own queue and counts restart from zero.
- **Cost watch:** a small VM, one Elastic IP (free while attached to a running instance) and a trickle of traffic. Set a US$5 AWS budget alert if you want a safety net.
