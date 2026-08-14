# 上线指引（Render 版）

> 完整说明见同目录 `README.md`。此处为极简步骤。

## 真搭子上线（Render，推荐）

项目已整理为「单 Node 服务托管前端 + API」的标准形态，含 `package.json` / `render.yaml`。

1. 本地 git 提交并推到你的 GitHub：
   ```bash
   git init -b main && git add . && git commit -m "feat: 真搭子版" && \
   git remote add origin <你的仓库> && git push -u origin main
   ```
2. Render Dashboard → New + → Web Service → 连接仓库 → 自动读 `render.yaml` → Create。
3. 拿到 `https://poop-tracker-xxxx.onrender.com`，搭子功能即真实在线。

## 本地跑

```bash
node server.js   # http://localhost:3000
```

## 静态降级

仅部署 `index.html` 等静态文件（如 CloudStudio）时，搭子自动走本地 mock，主打卡流程不受影响。

## 冷启动优化（free 层必做）

Render free 层 15 分钟无访问会休眠，下次进来有几秒~二十秒冷启动。已做两层缓解：

1. **前端**：Service Worker 预缓存应用外壳（index.html / manifest / icon），首屏秒开；只有首次搭子请求等后端唤醒。
2. **保活**：用外部定时探活抵消休眠。任选其一：
   - **UptimeRobot**（免费）：加一个监控，`URL = https://你的域名/healthz`，间隔 5 分钟，HTTP 监控即可。这样服务几乎常驻。
   - 或用任意 cron / GitHub Action 定时 `curl https://你的域名/healthz`。
   - 健康检查端点：`GET /healthz` 返回 `{ok:true, uptime, buddies}`。

## 数据持久化说明

- 搭子配对与离线留言写入 `data/buddies.json`，进程重启/休眠不再清空（信任底线）。
- 隐私埋点事件追加写入 `data/events.log`（仅匿名事件，无 PII，无原始记录）。
- 这些文件在 Render 临时盘上，**free 层重建/迁移可能丢失**；如需长期留存，升级付费层或外接对象存储。
