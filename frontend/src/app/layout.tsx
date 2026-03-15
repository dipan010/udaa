import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HandOff: Universal Digital Accessibility Agent",
  description: "A multimodal AI agent that autonomously navigates UI interfaces.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
