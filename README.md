# Hanyu Resource Saver

這是一個 Chrome Manifest V3 擴展，使用 `MAIN world` 腳本 hook 頁面內的 `fetch` 和 `XMLHttpRequest`，再由 bridge 腳本把資料傳回擴展背景頁保存到下載目錄。

## 使用方法

1. 打開 `chrome://extensions/`
2. 開啟「開發人員模式」
3. 點「載入未封裝項目」
4. 選擇本目錄：`chrome_resource_saver`
5. 如果先前已載入過舊版本，請先點一次「重新載入」
6. 打開目標網站並完成登入
7. 點擴展圖標，設置下載子目錄後，點「開始抓取」
8. 切換詞條或刷新頁面，觀察調試面板中的事件

## 文件命名

- 如果 URL 裡有 `dictionaryCode` 和 `entryName`，按 `詞典名_詞條名.json` 命名
- 如果沒有，就回退到 `主機名_路徑名_查詢哈希.json`

`entryName` 會先嘗試按 URL 編碼解碼，例如 `%XX%XX` 形式會先轉回原文字再落盤。

## 目前特性

- 不使用 `chrome.debugger`
- 不限制網站域名，方便復用
- 使用 CSP 友好的雙腳本結構：`page_hook_main.js` + `page_bridge.js`
- Popup 內置調試面板，可查看最近的攔截、跳過、保存與錯誤事件

## 注意事項

- 這個版本只抓開始之後的新請求。
- 主要適合 API / JSON 類資料，不適合完整鏡像整個站點。
- 文件會保存到 Chrome 預設下載目錄下的指定子目錄。
