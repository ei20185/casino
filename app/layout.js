import "./globals.css";

export const metadata = {
  title: "オンラインカジノ風 Webアプリ",
  description: "WebSocketによるリアルタイム通信のカジノ（架空チップ・換金なし）",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
