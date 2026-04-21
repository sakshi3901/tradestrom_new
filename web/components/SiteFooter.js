import Image from "next/image";
import Link from "next/link";

const footerTerms = [
  { label: "About Us", href: "/aboutUs" },
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Terms & Conditions", href: "/termsAndCondition" },
  { label: "Privacy Policy", href: "/privacyPolicy" }
];

const whyTradestromBullets = [
  "Instantly Spot the Biggest Intraday Moves - Stay ahead of the market with real-time alerts on the best trading opportunities.",
  "One-Click Simplicity - No complicated setups; just plug in and start trading smarter.",
  "Proven Results - Our tool has helped traders achieve exponential profits by capturing market trends at the right time.",
  "Designed for All Traders - Whether you’re a day trader, swing trader, or scalper, TradeStrom is built to enhance your strategies."
];

export default function SiteFooter({ logoHref = "/" }) {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 pt-8 pb-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(37,99,235,0.16)_0%,transparent_48%),radial-gradient(circle_at_75%_92%,rgba(30,64,175,0.2)_0%,transparent_46%),linear-gradient(180deg,#000000_0%,#02060d_100%)]" />
      <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-6 lg:flex-row lg:items-center">
          <div className="max-w-[440px]">
            <Link href={logoHref} className="inline-flex items-center">
              <Image
                src="/assets/images/logo/logo_b.png"
                width={225}
                height={35}
                quality={100}
                alt="TradeStrom"
                className="h-auto w-[195px] sm:w-[225px]"
              />
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
              TradeStrom makes trading easier and more profitable, helping you achieve
              remarkable success.
            </p>
          </div>

          <div className="flex flex-col gap-2 lg:items-end lg:pr-2">
            <h4 className="text-xl font-semibold tracking-[-0.01em] text-[#9fadc1]">
              Terms Of Use
            </h4>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
              {footerTerms.map((term) => (
                <li key={term.label}>
                  <Link
                    href={term.href}
                    className="text-sm text-[#737d8b] transition hover:text-white sm:text-base"
                  >
                    {term.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 text-[#737d8b]">
          <h3 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-[#9fadc1] sm:text-3xl">
            Welcome to TradeStrom - Your Ultimate Trading Companion
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
            At <strong className="font-semibold text-[#9fadc1]">TradeStrom</strong>, we believe
            in empowering traders with cutting-edge technology that simplifies and enhances their
            trading experience. Our powerful tool is designed to identify high-potential intraday
            moves, helping traders maximize their profits with ease.
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <div>
              <h4 className="text-xl font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-2xl">
                Our Journey
              </h4>
              <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
                TradeStrom was born out of a passion for trading and a vision to create a tool
                that delivers{" "}
                <strong className="font-semibold text-[#9fadc1]">
                  real-time, high-impact market insights
                </strong>
                . With a focus on accuracy, speed, and efficiency, TradeStrom has helped traders{" "}
                <strong className="font-semibold text-[#9fadc1]">
                  transform small investments into significant gains
                </strong>{" "}
                in a short span.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
                One of our most remarkable success stories is turning an initial investment into{" "}
                <strong className="font-semibold text-[#9fadc1]">
                  10X profits in just a few weeks
                </strong>
                , proving the true power of this tool.
              </p>
            </div>

            <div>
              <h4 className="text-xl font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-2xl">
                Why TradeStrom?
              </h4>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#737d8b] sm:text-base">
                {whyTradestromBullets.map((point) => (
                  <li key={point} className="flex gap-3">
                    <span className="mt-[8px] inline-block h-1.5 w-1.5 rounded-full bg-[#5aa0ff]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xl font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-2xl">
                Our Mission
              </h4>
              <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
                We are committed to{" "}
                <strong className="font-semibold text-[#9fadc1]">revolutionizing trading</strong>{" "}
                by making it faster, smarter, and more accessible to everyone. TradeStrom is
                your trading partner, helping you{" "}
                <strong className="font-semibold text-[#9fadc1]">
                  seize opportunities, minimize risks, and maximize returns
                </strong>{" "}
                with confidence.
              </p>
            </div>

            <div>
              <h4 className="text-xl font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-2xl">
                Join the TradeStrom Revolution
              </h4>
              <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">
                Take control of your trading success today. With{" "}
                <strong className="font-semibold text-[#9fadc1]">TradeStrom</strong>, you
                don&apos;t just trade, you trade smarter, faster, and more profitably.
              </p>
              <p className="mt-3 text-lg font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-xl">
                🚀 Start Your Journey with TradeStrom Now!
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-white/10 pt-5 text-sm text-[#737d8b] sm:flex-row sm:items-center">
          <p>© 2026 TradeStrom. All Rights Reserved</p>
          <div className="flex items-center gap-3">
            <a
              href="https://insta.openinapp.co/k0xyh"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#436ea7]/50 bg-[#0a1528]/65 text-[#dbe8ff] transition hover:border-[#66a6ff] hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5.2" />
                <circle cx="12" cy="12" r="4.1" />
                <circle cx="17.2" cy="6.8" r="1.05" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a
              href="https://telegram.openinapp.co/55h1o"
              target="_blank"
              rel="noreferrer"
              aria-label="Telegram"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#436ea7]/50 bg-[#0a1528]/65 text-[#dbe8ff] transition hover:border-[#66a6ff] hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 4 10.4 14.2" />
                <path d="m21 4-9 16-2.7-6.9L3 10.5 21 4Z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
