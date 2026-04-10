# 設備管理網頁（Desktop-first）頁面設計規格

## A. Global Styles（全站）
- Design tone：暗色科技風（高對比、霓虹輔色、細網格/微雜訊背景可選）。
- Design tokens
  - Background: #0B1020（主背景）, #0F1730（區塊背景）
  - Surface/Border: #1B2A4A（邊框/分隔線，1px）
  - Text: #E6F1FF（主文字）, #9BB0D0（次文字）
  - Accent: #00E5FF（主要強調）, #7C5CFF（次強調）
  - Status: Success #27D7A5, Warning #FFB020, Danger #FF4D6D, Muted #5B6B8A
- Typography（桌面優先）
  - H1 24/32, H2 20/28, H3 16/24, Body 14/20, Caption 12/16
  - Font: 系統字體 + 等寬字體用於 device_code（例如 ui-monospace）
- Buttons / Links
  - Primary：Accent 實心；Hover 提亮 8%；Disabled 降低透明度
  - Secondary：透明底 + Accent 邊框
  - Link：Accent 文字 + 底線 Hover
- Layout system
  - 主要採 CSS Grid（頁面骨架）+ Flex（列內對齊）
  - Desktop（≥1024px）：左側固定寬 Sidebar + 右側內容
  - Tablet/Phone：Sidebar 折疊為 Drawer；表格自動轉卡片列表

## B. Page 1：登入/註冊頁（/auth）
### Meta Information
- title：設備管理後台｜登入
- description：登入以查看設備連線、使用與定位狀態。
- og:title / og:description 同步

### Page Structure
- 置中單欄卡片（max-width 420px），背景使用深色漸層或微網格。

### Sections & Components
1. Brand Header
   - Logo/產品名、簡短標語（1 行）。
2. Auth Card
   - Tabs：登入 / 註冊
   - Inputs：Email、Password
   - CTA：主要按鈕（登入/建立帳號）
   - Secondary actions：忘記密碼（文字連結）
   - Error/Success inline message：卡片內顯示
3. Footer
   - 版權/版本號（可選）

## C. Page 2：設備管理總覽頁（/）
### Meta Information
- title：設備管理後台｜總覽
- description：以帳號為單位的設備狀態總覽。

### Page Structure（Desktop）
- Grid：
  - Left：Sidebar（240px）
  - Right：Header（固定高）+ Content（可捲動）
- Content 區塊：上方 KPI/狀態列 + 下方設備清單（表格為主）

### Sections & Components
1. Sidebar
   - Nav：總覽（active）、（可預留）
   - Account block：顯示 Email、登出
2. Top Header
   - Page title「設備總覽」
   - 右側：手動重新整理按鈕、最後同步時間
3. Account Location Status Bar（關鍵）
   - 顯示定位權限狀態：
     - 未授權：提示文字 + 引導按鈕「啟用定位」
     - 已授權：顯示「每 5 分鐘回報中」+ 最後回報時間
   - 小字說明：僅在你保持登入且頁面開啟時回報
4. Filters
   - Search：設備名稱/代碼
   - Status filters：連線狀態、使用狀態、定位狀態（下拉或 Pills）
5. Device List（表格 Desktop-first）
   - Columns：設備名稱、代碼、連線、使用、定位、最後回報、操作
   - Status badge：顏色對應 Success/Warning/Danger/Muted
   - Row action：進入詳情
   - Empty state：引導文案 + 重新整理

## D. Page 3：設備詳情頁（/devices/:deviceId）
### Meta Information
- title：設備管理後台｜設備詳情
- description：查看單台設備狀態、位置與帳號定位紀錄。

### Page Structure（Desktop）
- 上：Breadcrumb（總覽 / 設備名稱）+ 標題列
- 下：左右雙欄 Grid
  - Left（2/3）：地圖卡 + 設備狀態卡
  - Right（1/3）：帳號位置紀錄列表（可捲動）

### Sections & Components
1. Header + Breadcrumb
   - Back to「總覽」
   - Device title（display_name）+ device_code（等寬小標）
2. Device Status Card
   - 三個主要狀態：連線/使用/定位（Badge）
   - Last seen：最後回報時間
3. Map Card
   - 地圖容器（深色樣式）
   - Marker：設備位置（若有 last_lat/lng）
   - Controls：縮放、重新置中、（可選）切換顯示「帳號位置點」
4. Account Positions Panel
   - List items：時間（captured_at）、lat/lng、accuracy
   - Item interaction：點擊後地圖置中到該點；高亮選取狀態
   - Loading/Empty/Error states 明確呈現

## E. Interaction & Motion Guidelines（精簡）
- 重要互動（登入、寫入位置、切換設備）都要有 loading 狀態與失敗提示。
- Transition：卡片 hover 微浮起（translateY 1–2px）+ 邊框提亮；避免過度動畫。
- 響應式：≤768px 時設備表格改卡片、詳情頁改單欄堆疊（地圖在上、列表在下）。