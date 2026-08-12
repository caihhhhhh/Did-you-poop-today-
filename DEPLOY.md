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
