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

## Deploy native di EC2 dengan PM2

1. Install Node.js 20+ untuk AMI yang digunakan, lalu verifikasi `node --version` dan `npm --version`.
2. Salin folder ini ke EC2, misalnya ke `/opt/session15-observability-demo`.
3. Buat folder log dan pasang PM2:

   ```bash
   cd /opt/session15-observability-demo
   mkdir -p logs
   npm ci --omit=dev
   sudo npm install --global pm2
   ```

4. Jalankan app:

   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   pm2 logs session15-observability-demo
   ```

5. Supaya PM2 hidup kembali setelah reboot, jalankan `pm2 startup`, ikuti perintah yang dicetak PM2, lalu:

   ```bash
   pm2 save
   ```

6. Di Security Group EC2, izinkan TCP 3000 hanya dari IP kelas/jaringan lab. Buka `http://EC2_PUBLIC_IP:3000` dari browser yang diizinkan.

Perintah berguna saat demo:

```bash
pm2 restart session15-observability-demo
pm2 stop session15-observability-demo
pm2 start ecosystem.config.cjs
```

PM2 cocok untuk demo karena mudah dilihat status, restart, dan log-nya. **systemd** adalah alternatif native tanpa PM2 dan sering lebih sesuai dengan standar operasional server; jika memakai systemd, sesuaikan lagi konfigurasi CloudWatch Agent untuk sumber log yang digunakan.

## Hubungkan ke CloudWatch

1. Pasang EC2 instance profile dengan izin CloudWatch Agent. Jangan menyimpan access key AWS di source code atau file `.env`.
2. Install **Amazon CloudWatch Agent** untuk AMI yang digunakan.
3. File konfigurasi contoh ada di `config/cloudwatch-agent.json`. File itu mengumpulkan PM2 stdout/stderr dari:
   - `/opt/session15-observability-demo/logs/app-out.log`
   - `/opt/session15-observability-demo/logs/app-error.log`
4. Jika aplikasi diletakkan di path lain, ubah `file_path` pada konfigurasi sebelum menjalankan agent.
5. Jalankan konfigurasi agent:

   ```bash
   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
     -a fetch-config -m ec2 \
     -c file:/opt/session15-observability-demo/config/cloudwatch-agent.json \
     -s
   ```

6. Jalankan `npm run demo:traffic`, lalu periksa log group:
   - `/session15-observability-demo/application`
   - `/session15-observability-demo/errors`

CloudWatch Agent mengirim host metrics ke `Session15/ObservabilityDemo/Host`. EMF di application log akan menghasilkan custom metrics di `Session15/ObservabilityDemo`; tunggu beberapa menit untuk ingestion. Atur retention log group sesuai durasi latihan agar log tidak tersimpan tanpa batas.

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
