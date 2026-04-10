# Smart Lock 管理網頁

React + Vite + Tailwind 的暗色科技風管理後台，使用 Supabase Auth + PostgreSQL。

## 功能
- Supabase Auth：登入/註冊/忘記密碼
- 設備總覽：依登入帳號顯示 devices 狀態，並以 Realtime 訂閱即時更新
- 設備詳情：單台設備狀態 + 地圖（OSM embed）
- 定位回報：登入且頁面開啟時，使用者可啟用「每 5 分鐘寫入 positions」

## 環境變數
建立 `.env`：
```bash
VITE_SUPABASE_URL=你的_supabase_url
VITE_SUPABASE_ANON_KEY=你的_supabase_anon_key
```

可參考 `.env.example`。

## Supabase 資料表
SQL 遷移檔：`supabase/migrations/001_init.sql`

## 開發
```bash
npm.cmd install
npm.cmd run dev
```

## 檢查
```bash
npm.cmd run check
npm.cmd run lint
npm.cmd run test
```

## 部署到 GitHub Pages
本專案使用 Hash Router，適合 GitHub Pages 這類靜態空間。

1. 建置
```bash
npm.cmd run build
```

2. 一鍵發布（gh-pages）
```bash
npm.cmd run deploy
```
