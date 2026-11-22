# Powderline · 雪线 — 加拿大实时雪况、交互式雪道地图与雪上定位

一个专注于实时查看滑雪场雪况、开放雪道、运行缆车、雪上 GPS 定位与 2D/3D 交互式雪道地图的全栈 Web App，原生适配 **Cloudflare Workers + Static Assets** 边缘部署。

目前已完整接入两大滑雪区域共 **7 座雪场**：

- **班夫国家公园 · SkiBig3（Alberta）**：
  - **Banff Sunshine Village（班夫阳光村滑雪场）**
  - **Lake Louise Ski Resort（露易丝湖滑雪场）**
  - **Mt. Norquay（诺奎山滑雪场）**
- **多伦多周边 · 南安省雪带（Greater Toronto / Ontario）**：
  - **Blue Mountain Resort（蓝山滑雪度假村 · Collingwood）**
  - **Mount St. Louis Moonstone（圣路易斯月石山滑雪场 · Coldwater）**
  - **Horseshoe Valley Resort（马蹄谷滑雪度假村 · Barrie）**
  - **Glen Eden（格伦伊登滑雪场 · Milton）**

## 核心功能

- **多雪区一键切换与核心雪况总览**：
  - **开放雪道 (`Open Runs`)**：实时开放条数 / 总雪道数、今日已压雪（Groomed）条数与占比进度条。
  - **实时降雪量 (`Snowfall & Base`)**：过夜新雪、24 小时新雪、7 日累计降雪、雪底厚度（Base）、本雪季累计及未来 7 日降雪预报（`cm` / `in` 一键切换）。
  - **运行缆车 (`Open Lifts`)**：当前正在运行的箱式缆车（Gondola）、高速吊椅（8-Pack / 6-Pack / Quad）与魔毯（Magic Carpet）列表及运营时段。
- **交互式 2D/3D 实时雪道与缆车地图 (`MapLibre GL JS`) + 雪上 GPS 定位**：
  - 基于 **OpenStreetMap** 真实 GPS 雪道（`piste:type=downhill`）与缆车索道（`aerialway=*`）矢量数据，实时叠加各雪场当日 **开放 / 关闭 / 压雪** 状态与北美雪道难度分级（`●` 绿道、`■` 蓝道、`◆` 黑钻、`◆◆` 双黑钻）。
  - 内置 **雪上实时定位 (`Ski GPS`)**：开启手机定位与电子罗盘扇形朝向，自动吸附显示当前所在雪道名称、难度、实时滑行速度（`km/h` / `mph`）、海拔与最近开放缆车距离；异地亦可一键体验雪道滑行模拟演示。
  - 支持 **2D 零视差精准雪道图** 与 **3D 1:1 真实高程地形（AWS Terrarium DEM + 山体阴影）** 切换，支持 **雪山图 / 等高线地形图 / 卫星实景图** 三种底图。
- **高山气象、未来 7 日降雪预报与实时摄像头**：
  - 单次批量请求 **Open-Meteo** 全部 7 座雪场海拔气象数据（山顶/山脚实时气温、风速、未来 7 日每日降雪量预报）。
  - 内置雪场官方实时摄像头（Webcams）免跨域流式代理预览（`/api/webcam`）与官方视频直播跳转。
  - 支持 **中文 / English** 双语切换、**公制 (`cm / °C`) / 英制 (`in / °F`)** 切换，以及 **冰川日间 / 夜滑深色** 主题切换。

## 架构说明（Cloudflare Workers 原生边缘架构）

- **前端静态资源 (`./dist`)**：由 Cloudflare Workers Static Assets 全球边缘直出（`not_found_handling: "single-page-application"`），静态资源与 GeoJSON 零 Worker 调用计费。
- **边缘 API (`./worker/index.ts`)**：通过 `run_worker_first: ["/api/*"]` 路由至纯 Web Standard（零 Node.js 依赖）的 Worker 脚本：
  - `GET /api/conditions`：并发拉取班夫与多伦多周边 7 座雪场官方数据源及单次批量 Open-Meteo 气象预报（总上游子请求仅 ~10 个，远低于 Workers 免费版 50 子请求上限），结合 Cloudflare Edge Cache (`caches.default`, 5 分钟 TTL) 与内存缓存加速；传 `?refresh=1` 可强制刷新。
  - `GET /api/webcam?url=...`：白名单校验后流式转发雪场实时摄像头画面并缓存 60 秒。

## 本地开发

```bash
npm install
npm run dev
```

使用 Wrangler 在本地 `workerd` 运行时预览：

```bash
npm run cf:dev
```

## 部署到 Cloudflare Workers

项目根目录已配置好 `wrangler.jsonc`，支持以下任一方式直接部署：

### 方式一：Cloudflare Dashboard 连接 GitHub 自动部署（推荐）

1. 登录 Cloudflare Dashboard -> **Compute (Workers) -> Workers & Pages -> Create**。
2. 选择 **Import a repository**，关联 GitHub 仓库 `wch930/ski-cond`。
3. 构建配置保持默认即可：
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
4. 点击 **Save and Deploy**，每次推送到 `main` 分支都会自动构建并发布全球边缘节点。

### 方式二：命令行一键部署

```bash
npx wrangler login
npm run deploy
```
