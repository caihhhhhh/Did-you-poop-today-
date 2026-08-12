# 🚽 今天你拉了吗？

趣味肠道打卡 + 匿名「搭子」互踩。纯前端趣味网站，无医疗诊断、无变现。

- **前端**：单文件 `index.html`（原生 JS + PWA，可离线打卡）
- **后端**：`server.js` 单 Node 进程，**同时托管前端静态资源与 `/api/*` 搭子接口**
- **隐私**：搭子后端仅做匿名配对 + 脱敏状态中转 + 互踩转发，**内存存储、进程重启即清空**，绝不存储任何原始排便记录

---

## 本地运行

```bash
node server.js
# 打开 http://localhost:3000
```

无需 `npm install`（仅用 Node 内置模块）。

---

## 部署到 Render（真搭子上线）

本项目已是 Render 标准形态：单进程 + `process.env.PORT` + 同源相对 API。

### 你只要 2 步：

**① 把代码推到你的 GitHub**

```bash
cd poop-tracker-pwa
git init -b main
git add .
git commit -m "feat: 今天你拉了吗 真搭子版"
git remote add origin https://github.com/<你的用户名>/poop-tracker.git
git push -u origin main
```

**② 在 Render 一键拉起**

1. 登录 https://render.com → **New + → Web Service**
2. 连接上面的 GitHub 仓库
3. Render 会自动读取仓库里的 `render.yaml`，直接点 **Create Web Service**
4. 约 1–2 分钟部署完成，拿到 `https://poop-tracker-xxxx.onrender.com`

搞定。打开线上地址，「找搭子」就是**真正的实时配对 + 互踩**（不再是本地 mock）。

> 免费用法提示：Render free 版 15 分钟无访问会休眠，下次访问有几秒冷启动；App 外壳走 Service Worker 缓存会秒开，只有首次搭子请求会等后端唤醒，属正常现象。

---

## 降级说明

若前端运行在**纯静态环境**（无 Node 后端，如直接打开 HTML / 静态托管），`/api/*` 会 404，前端自动降级为「本地自娱自乐」模式（搭子互踩走本地 mock），不影响打卡主流程。

---

## 隐私边界

- 打卡数据全部存在浏览器 `localStorage`，不上传。
- 搭子后端只接收脱敏公开字段（连续天数 / 今日是否打卡 / 形状 1–7 / 是否成就），且不落盘。
- 匹配码形如「神秘便友#1234」，无账号、无实名。

> 报告由产品战略团队 AI 协作生成；本说明供上线参考。
