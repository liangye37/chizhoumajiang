# 池州麻将 · Cloudflare Workers 免费公网联机中继

部署后，GitHub Pages 上的安卓、iOS 和电脑浏览器无需电脑开服，直接输入 6 位房间码即可跨设备联机。

## 3 步部署（免费套餐即可）

1. 在本目录执行部署（首次会自动打开浏览器登录 Cloudflare 账号）：

```powershell
cd signaling/cloudflare-worker
npx wrangler deploy
```

部署成功后终端会输出类似地址：
`https://chizhou-mahjong-relay.<你的子域>.workers.dev`

2. 在 GitHub 仓库里配置构建变量：
   - 打开 `Settings -> Secrets and variables -> Actions -> Variables`
   - 新建 Repository variable：
     - Name: `VITE_SELF_HOST_SIGNALING`
     - Value: `wss://chizhou-mahjong-relay.<你的子域>.workers.dev/signal`

3. 触发一次 GitHub Pages 重新部署（推送任意提交或在 Actions 手动点 `Run workflow`），GitHub Pages 网页即默认启用全端联机。

> 临时测试（不改 GitHub 变量也可以）：直接在池州麻将 GitHub Pages 的「联机对战」面板里粘贴上述 `wss://.../signal` 地址即可生效。
