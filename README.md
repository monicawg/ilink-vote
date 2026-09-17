# ilink-vote｜四份 Case，你會錄取誰？

講座「AI 無法取代的能力」第四幕的互動體驗：觀眾掃 QR → 讀 Brief → 看四份匿名 Case → 投票 → 講者控制現場結果與真實結果揭曉。
Source of Truth：`../AI_Hiring_Talk_Strategy_Handoff_v2_REBUILT.md`；規格：`../AI_Hiring_Talk_Interactive_MVP_Spec_v0.1.md`。

## 檔案

```
index.html          觀眾端（手機／桌機）
presenter.html      講者控制台（?s=<session>&key=<presenter key>）
config.js           唯一要改的設定：backend / supabaseUrl / supabaseAnonKey / sessionId
content/cases.json  所有文案、四份 Case 的中性描述與 Reveal 文案（引用 Handoff，勿改結果）
assets/cases/       去識別化後的頁面圖（A/B/C/D，webp + jpg）
supabase/schema.sql 後端：表、RLS、RPC、seed
tools/render_cases.py  素材管線（從資料夾上一層的 PDF 重新輸出；原始 PDF 不進 repo）
tools/serve.py      本機測試伺服器
```

## 本機試跑（不需帳號）

```bash
python3 tools/serve.py 8765
```

- 觀眾端：http://127.0.0.1:8765/
- 講者端：http://127.0.0.1:8765/presenter.html

`config.js` 的 `backend: "local"` 時，狀態只存在同一個瀏覽器（不同分頁會同步），適合自己順流程。

## 正式部署（GitHub Pages + Supabase）

1. **Supabase**：用 GitHub 登入 supabase.com → New project（Region 選 Tokyo / Singapore）。
2. SQL Editor → 貼上 `supabase/schema.sql`，**先把最後兩行的 `CHANGE-ME…` 換成你自己的長亂碼**（這就是講者 key）→ Run。
3. Project Settings → API：複製 **Project URL** 與 **anon public key**，填進 `config.js`，並把 `backend` 改成 `"supabase"`。
4. **GitHub**：新建 repo（例如 `ilink-vote`），把這個資料夾內容 push 上去；Settings → Pages → Source: `main` / root。
5. 幾分鐘後網址會是 `https://<你的帳號>.github.io/ilink-vote/`。用這個網址做 QR Code 與短網址。
6. 講者網址：`https://<你的帳號>.github.io/ilink-vote/presenter.html?s=ilink-0918&key=<你的 key>`（不要公開）。

彩排用 `?s=rehearsal`（觀眾端 `config.js` 的 `sessionId` 也要一致，或把 rehearsal 的 key 給自己手機測）。

## 講者操作（對照 Deck）

| Deck | Console 按鈕 | 觀眾手機 |
|---|---|---|
| S10 QR | 開場前先 **Reset** | Intro，可自由看 Brief / Cases |
| S12 四份 Case | **1 開始瀏覽 Cases** | Gallery（約 2 分鐘） |
| S13 投票 | **2 開放投票** → 看右側票數 → **3 截止投票** | Vote 解鎖／截止 |
| S14 Reveal | **4 顯示現場結果** → **5 Reveal** ×4（或「全部揭曉」） | 自動跳 Live Results → 逐張翻牌 |
| S15 起 | **6 回到講座** | UNDERSTAND → THINK → JUDGE → MOVE |

- 右上「全螢幕結果視圖」：只留大字結果，適合直接分享這個視窗；鍵盤 `→` 下一步、`←` 上一步、`Esc` 關閉。
- 黃色按鈕永遠是「下一步」；Reset 會跳確認框。
- **離線 Fallback**：Console 最下方「手動輸入舉手票數」→ 套用後，全螢幕視圖與觀眾手機都會顯示這組數字。

## 現場故障對照

| 狀況 | 做法 |
|---|---|
| 觀眾掃不到 QR | 會議聊天室貼短網址 |
| Supabase 掛掉 | 觀眾仍可看 Brief / Cases；請大家舉手 → Console 手動輸入票數 → 照常 Reveal |
| 手機顯示「同步中…」 | 5 秒內會自動輪詢；不影響瀏覽 |
| 整個網站掛掉 | 用 Deck 的 S12 / S14 直接講 |

## 去識別化

原始 PDF / PPTX 含候選人姓名，**只放在 repo 外面**（上一層資料夾）。`assets/cases/` 是遮罩後重新輸出的圖片，不含 metadata。若要重出：

```bash
pip3 install --user pymupdf pillow
python3 tools/render_cases.py        # 或 python3 tools/render_cases.py A D
```

遮罩座標在 `tools/render_cases.py` 的 `SOURCES`。Case C 由 Keynote 匯出 `Case C.pdf` 後再跑。
