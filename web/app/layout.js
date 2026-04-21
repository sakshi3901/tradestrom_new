import "./globals.css";

export const metadata = {
  title: "Tradestrom",
  description: "Access-managed trading operations portal"
};

export default async function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
