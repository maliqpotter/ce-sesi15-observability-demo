# Session 15 — Monitoring & Logging Demo

Demo app kecil untuk materi **Monitoring & Logging**. Aplikasi ini berjalan langsung di EC2 sebagai proses Node.js—**tidak memakai Docker atau container** dan tidak memiliki dependency aplikasi eksternal. PM2 digunakan untuk process management.

## Yang bisa didemokan

- Structured JSON application logs ke stdout/stderr, dikelola PM2 sebagai file log
- Custom CloudWatch metrics melalui **Embedded Metric Format (EMF)** di log
- Host CPU, memory, dan disk metrics melalui CloudWatch Agent
- Controlled latency, application error, request ID, dan korelasi `traceparent`
- Alarm, Logs Insights, serta incident response sederhana

> `/api/slow` dan `/api/error` sengaja dibuat untuk latihan. Jangan membuka app ini ke internet publik; batasi akses melalui Security Group ke IP kelas atau jaringan lab.

## Persyaratan

- Node.js 20 atau lebih baru dan npm
- EC2 Linux untuk integrasi CloudWatch
- PM2 global untuk menjalankan app sebagai service
- CloudWatch Agent dan EC2 instance profile yang memiliki izin menulis log/metrics (misalnya `CloudWatchAgentServerPolicy` atau policy least-privilege yang setara)

## Endpoint demo

| Endpoint | Fungsi |
|---|---|
| `/` | Halaman demo dengan tombol untuk memicu request |
| `/healthz` | Health check untuk load balancer; tidak dimasukkan ke application metrics |
| `/api/orders` | Request normal |
| `/api/checkout` | Request dengan simulated dependency call; event log dapat dikorelasikan lewat request/trace ID |
| `/api/slow?ms=1500` | Menambah latency secara terkontrol; maksimum 5 detik |
| `/api/error` | Menghasilkan error HTTP 500 yang aman dan disengaja |

Setiap request aplikasi menghasilkan JSON log dan EMF event. EMF mengirim metrik `RequestCount`, `ErrorCount`, `SlowRequestCount`, dan `RequestDurationMs` ke namespace `Session15/ObservabilityDemo`, dengan dimensi terbatas `Service`, `Route`, dan `StatusCode`.

## Jalankan lokal

```bash
cd session15-observability-demo
node --version
npm test
npm start
```

Buka `http://localhost:3000`. Untuk menghasilkan traffic demo dari terminal, di terminal lain jalankan:

```bash
npm run demo:traffic
```

Atau arahkan script ke EC2:

```bash
BASE_URL=http://EC2_PUBLIC_IP:3000 bash scripts/demo-traffic.sh
```

Jangan membuka port 3000 ke `0.0.0.0/0`; gunakan IP tepercaya untuk latihan.

## Deploy dan Jalankan di EC2 dengan PM2

Langkah berikut menggunakan `APP_DIR` agar tidak bergantung pada nama folder tertentu. Ganti contoh path dengan lokasi project di instance. Variabel ini hanya berlaku pada shell saat ini; tetapkan lagi saat membuka SSH session baru.

### Persiapan awal

1. Install Node.js 20+ dan npm untuk AMI yang digunakan. Verifikasi:

   ```bash
   node --version
   npm --version
   ```

2. Salin/clone project ke EC2. Contoh:

   ```bash
   APP_DIR="$HOME/session15-observability-demo" # ganti dengan path yang dipilih
   # Jika menggunakan Git:
   git clone <REPO_URL> "$APP_DIR"
   # Jika file sudah disalin ke EC2, cukup masuk ke folder tersebut:
   cd "$APP_DIR"
   ```

3. Install dependency (project ini tidak memiliki dependency aplikasi eksternal), siapkan log folder, dan pasang PM2 jika belum ada:

   ```bash
   npm ci --omit=dev
   mkdir -p logs
   sudo npm install --global pm2
   ```

   Jangan jalankan perintah PM2 dengan `sudo`; jalankan sebagai user Linux yang memiliki project dan akan menjalankan aplikasi.

### Start aplikasi

```bash
APP_DIR="$HOME/session15-observability-demo" # ganti dengan path project di EC2
cd "$APP_DIR"
pm2 start ecosystem.config.cjs
pm2 save
```

Verifikasi process, endpoint, dan lokasi file log:

```bash
pm2 status
pm2 describe session15-observability-demo
curl -i http://127.0.0.1:3000/healthz
ls -lh "$APP_DIR/logs"
```

`ecosystem.config.cjs` mengatur log ke `logs/app-out.log` dan `logs/app-error.log` relatif terhadap folder project.

### Perintah operasional PM2

```bash
pm2 status
pm2 logs session15-observability-demo
pm2 restart session15-observability-demo --update-env
pm2 stop session15-observability-demo
pm2 start ecosystem.config.cjs
```

### Update aplikasi

Untuk deployment dari Git:

```bash
APP_DIR="$HOME/session15-observability-demo" # ganti dengan path project di EC2
cd "$APP_DIR"
git pull --ff-only
npm ci --omit=dev
pm2 restart session15-observability-demo --update-env
pm2 save
```

Jika `ecosystem.config.cjs` ikut berubah, muat ulang definisi app dari file ecosystem:

```bash
APP_DIR="$HOME/session15-observability-demo" # ganti dengan path project di EC2
cd "$APP_DIR"
pm2 startOrReload ecosystem.config.cjs
pm2 save
```

Jika project tidak menggunakan Git, salin file versi terbaru ke `$APP_DIR`, lalu jalankan `npm ci --omit=dev` dan restart PM2 seperti di atas.

### Aktifkan PM2 saat reboot

Jalankan `pm2 startup`, ikuti perintah `sudo` yang dicetak PM2, kemudian simpan process list:

```bash
pm2 startup
pm2 save
```

Di Security Group EC2, batasi TCP 3000 ke IP/jaringan kelas. Jangan membuka port tersebut ke `0.0.0.0/0` untuk demo.

PM2 digunakan pada panduan ini karena mudah untuk demo dan mengelola file log. **systemd** juga dapat menjalankan Node.js secara native; jika memilih systemd, atur CloudWatch Agent untuk membaca sumber log systemd yang digunakan.

## Hubungkan dan Jalankan CloudWatch Agent

### 1. IAM role dan jaringan

- Pasang EC2 instance profile/role dengan policy `CloudWatchAgentServerPolicy` atau izin least-privilege yang setara untuk mengirim logs dan metrics.
- Nama role boleh berbeda. Yang penting role tersebut terpasang pada EC2 dan memiliki izin yang diperlukan.
- Jangan menyimpan AWS access key di source code atau file `.env`.
- Instance perlu akses HTTPS keluar ke CloudWatch. Untuk private subnet, sediakan NAT atau VPC endpoints yang diperlukan.

### 2. Install CloudWatch Agent

Pilih cara install sesuai AMI. Contoh Ubuntu:

```bash
cd /tmp
ARCH=$(dpkg --print-architecture)
curl -fLo amazon-cloudwatch-agent.deb \
  "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/${ARCH}/latest/amazon-cloudwatch-agent.deb"
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
```

Untuk Amazon Linux 2023 gunakan `sudo dnf install -y amazon-cloudwatch-agent`; untuk Amazon Linux 2 gunakan `sudo yum install -y amazon-cloudwatch-agent`.

### 3. Buat konfigurasi khusus untuk path instance

Template `config/cloudwatch-agent.json` mengarah ke `/opt/session15-observability-demo`. Agar tidak mengubah file template atau mengasumsikan nama folder EC2, buat salinan runtime di `/tmp` dengan path app yang sebenarnya:

```bash
APP_DIR="$HOME/session15-observability-demo" # ganti dengan path project di EC2
cd "$APP_DIR"
APP_DIR="$(pwd)"

sed "s#/opt/session15-observability-demo#${APP_DIR}#g" \
  "$APP_DIR/config/cloudwatch-agent.json" \
  > /tmp/session15-cloudwatch-agent.json

grep -n file_path /tmp/session15-cloudwatch-agent.json
```

Pastikan hasilnya menunjuk ke file log PM2 yang nyata. Periksa dengan `pm2 describe session15-observability-demo`; jika PM2 menulis ke lokasi selain `$APP_DIR/logs/`, sesuaikan `file_path` pada salinan di `/tmp` tersebut.

### 4. Start atau update konfigurasi agent

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/tmp/session15-cloudwatch-agent.json \
  -s
```

Perintah yang sama dapat dijalankan lagi setelah konfigurasi berubah untuk memuat ulang agent.

Verifikasi agent dan log diagnostiknya:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
sudo journalctl -u amazon-cloudwatch-agent -n 50 --no-pager
```

### 5. Generate traffic dan verifikasi di CloudWatch

Jalankan traffic **setelah agent aktif** supaya menghasilkan log baru:

```bash
APP_DIR="$HOME/session15-observability-demo" # ganti dengan path project di EC2
cd "$APP_DIR"
npm run demo:traffic
```

Di CloudWatch Console, pilih region yang sama dengan EC2, lalu cek log groups:

- `/session15-observability-demo/application`
- `/session15-observability-demo/errors`

CloudWatch Agent mengirim host metrics ke namespace `Session15/ObservabilityDemo/Host`. Log EMF dari app menghasilkan custom metrics di `Session15/ObservabilityDemo`: `RequestCount`, `ErrorCount`, `SlowRequestCount`, dan `RequestDurationMs`. Metrik baru muncul setelah request dikirim dan mungkin perlu beberapa menit untuk ingestion.

Atur retention log groups sesuai durasi kelas agar log tidak tersimpan tanpa batas.

### Update/reload CloudWatch Agent

Jika path app atau konfigurasi CloudWatch berubah:

1. Buat ulang `/tmp/session15-cloudwatch-agent.json` dengan langkah 3.
2. Jalankan ulang perintah `amazon-cloudwatch-agent-ctl -a fetch-config ... -s` pada langkah 4.
3. Periksa status agent dan log groups kembali.

## Contoh demo di console

**CloudWatch Logs Insights — cari error:**

```text
fields @timestamp, level, event, request_id, route, status_code, duration_ms, trace_id
| filter event = "http_request" and status_code >= 500
| sort @timestamp desc
| limit 50
```

**CloudWatch alarm — error:** pilih `ErrorCount` di namespace `Session15/ObservabilityDemo` untuk dimensi service, route `/api/error`, dan status `500`; gunakan `Sum > 0` sebagai alarm latihan.

**CloudWatch alarm — latency:** pilih `RequestDurationMs` untuk route `/api/slow`, status `200`; misalnya gunakan `Average > 1000 ms`.

Script traffic juga mengirim header W3C `traceparent`, sehingga `trace_id` dapat dicari di related log events. Demo ini **belum mengirim distributed spans ke AWS X-Ray**—trace ID di sini hanya untuk latihan korelasi log. Untuk tampilan trace X-Ray yang sesungguhnya, app perlu diinstrumentasi dengan OpenTelemetry dan collector/ADOT.
