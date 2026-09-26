# FreeStudocu 🚀

**FreeStudocu** is a lightweight browser extension (Manifest V3) designed to remove premium blurs, hide annoying ads, clean up upsell clutter on Studocu, and allow you to download complete documents as high-quality PDFs. This project is an enhanced version built directly upon the open-source foundations of **StudocuHack**.
<div align="center">
  <img src="https://github.com/user-attachments/assets/29f8a5a3-e5a0-4222-829e-dbc5a5000026" alt="FreeStudocu Extension Demo" style="width: 100%; max-width: 750px; height: auto; image-rendering: -webkit-optimize-contrast; border-radius: 6px;">
  <p><i>FreeStudocu: Unblurring Demo</i></p>
</div>

<div align="center">
  <img src="https://github.com/user-attachments/assets/7350bf13-a896-480d-aa4d-4f0b6e92c799" alt="FreeStudocu Extension Demo" style="width: 100%; max-width: 750px; height: auto; image-rendering: -webkit-optimize-contrast; border-radius: 6px;">
  <p><i>FreeStudocu: PDF Export Demo</i></p>
</div>


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
4. Click the **Load unpacked** 

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

## 🤝 Credits & Acknowledgements

This extension extends, refines, and integrates core components, logical structures, and third-party tools originally authored by:

- **Core Architecture & Logic:** Based on the [studocuhack](https://github.com/danieltyukov/studocuhack) repository created by [@danieltyukov](https://github.com/danieltyukov).
- **Core Conversion Engine:** Powered by [pdf2htmlEX](https://github.com/pdf2htmlex/pdf2htmlex), an excellent tool licensed under GPLv3+ used for precise PDF-to-HTML conversion.
- **Custom Enhancements:** Patched lightweight domain permissions under Manifest V3 specifications and packaged background handlers to achieve deep session cookie purging capabilities.

## 📄 License & Disclaimer

This project is licensed under the terms of the MIT License. Code assets are shared entirely for independent technological study and educational research. This tool maintains no official association with Studocu, and end-users are independently accountable for complying with third-party Terms of Service.

## 💬 Feedback & Discussions / Góp ý & Thảo luận

<details open>
<summary><b>🌍 English</b></summary>

If you encounter any bugs, have questions, or want to suggest new features, please choose the right channel below:
* 🪲 **Bug Reports:** If the extension is broken or fails to unblur, please file a detailed report at [GitHub Issues](https://github.com/thienbaodeptrai/freestudocu/issues).
* 💡 **Feature Requests:** Want to support more features or sites? Share your thoughts in [GitHub Discussions](https://github.com/thienbaodeptrai/freestudocu/discussions).
* ⭐ **Support:** If this extension saved your day, please drop a **Star** to keep the project alive!

</details>

<details open>
<summary><b>🇻🇳 Tiếng Việt</b></summary>

Nếu bạn gặp lỗi trong quá trình sử dụng, có câu hỏi hoặc muốn đề xuất tính năng mới, vui lòng chọn kênh phù hợp dưới đây:
* 🪲 **Báo lỗi kỹ thuật:** Nếu tiện ích bị lỗi hoặc không gỡ được mờ tài liệu, hãy báo cáo chi tiết tại [GitHub Issues](https://github.com/thienbaodeptrai/freestudocu/issues).
* 💡 **Đề xuất tính năng:** Bạn muốn công cụ tối ưu hơn hoặc hỗ trợ thêm trang web nào khác? Hãy gợi ý tại [GitHub Discussions](https://github.com/thienbaodeptrai/freestudocu/discussions).
* ⭐ **Ủng hộ:** Nếu công cụ này giúp ích cho việc học của bạn, đừng quên tặng mình **1 Star** nhé!

</details>
