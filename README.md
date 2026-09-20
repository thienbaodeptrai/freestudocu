# FreeStudocu 🚀

**FreeStudocu** is a lightweight browser extension (Manifest V3) designed to remove premium blurs, hide annoying ads, clean up upsell clutter on Studocu, and allow you to download complete documents as high-quality PDFs. This project is an enhanced version built directly upon the open-source foundations of **StudocuHack**, introducing an advanced **Factory Reset** feature to purge site storage and session cookies (including HttpOnly keys).

## ✨ Key Features

- **Smart Unblurring:** Automatically strips the CSS blur filters from any document page whose content Studocu sends to your browser.
- **Automatic Preloading:** Automatically loads all document pages upon opening, eliminating the need to scroll manually through the viewer to render them.
- **High-Quality PDF Exports:** Adds a clean "Download" button. The extension reads signed CDN URL parameters from the page to fetch full-resolution assets, rendering both text and background layers into a complete PDF.
- **UI Decoupling & Ad Shield:** Instantly hides premium banners, upgrade buttons, the "Ask a question" AI toolbar, and intrusive ad tags (such as Refinery89, Google Publisher Tag, and Adagio).
- **Factory Reset (Enhanced Feature):** Clears all Studocu site data—including strict HttpOnly cookies, LocalStorage, and SessionStorage—directly from the extension to resolve session locks or reset storage limits instantly.

## 🛠️ Installation Guide (Chrome / Edge / Brave)

1. Download the source code repository as a `.zip` file and extract it on your local machine.
2. Open your browser's extension management dashboard:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Toggle on **Developer mode** in the top right corner.
4. Click the **Load unpacked** button.
5. Select the extracted project folder (the directory containing `manifest.json`).

## 📖 How to Use

1. Navigate to any document on **Studocu** (supports `.com`, `.vn`, `.nl`, and `.id` country domains).
2. The extension automatically removes page blurs and hides obstructive overlays.
3. Click the blue **Download** button positioned above the viewer. A local capture window will overlay the screen to sequentially scan the document pages.
   - *Note:* Keep this tab in the foreground while capturing. Browsers automatically throttle background tabs, which will halt the downloading process.
4. Once capturing completes, the system print layout opens. Set the destination to **Save as PDF** and confirm.
5. *Tip:* If the website exhibits layout bugs or triggers viewer limit blocks, execute the **Factory Reset** action from the extension popup to cleanly clear site state data.

## 🚨 Technical Limits

Studocu translates its document views via `pdf2htmlEX` outputs handled by a React virtual scroller. Each individual page is split into two elements: an underlying graphical background image and an absolute-positioned HTML text layer.

For heavily premium-locked pages, Studocu **completely blocks** the text asset layer from being served to your computer. Because that data never leaves the server, no browser utility can magically recover it. The extension dynamically checks for this condition and marks failed nodes as `premium-locked` in the viewport so you can spot them.

## 🤝 Credits & Acknowledgements

This extension extends and refines core components, logical structures, and code architecture originally authored by:
- **Original Repository:** [studocuhack]([https://github.com](https://github.com/danieltyukov/studocuhack)) created by [@danieltyukov]([https://github.com](https://github.com/danieltyukov)).
- **Custom Enhancements:** Patched lightweight domain permissions under Manifest V3 specifications and packaged background handlers to achieve deep session cookie purging capabilities.

## 📄 License & Disclaimer

This project is licensed under the terms of the MIT License. Code assets are shared entirely for independent technological study and educational research. This tool maintains no official association with Studocu, and end-users are independently accountable for complying with third-party Terms of Service.
