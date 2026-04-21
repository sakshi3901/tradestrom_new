import Image from "next/image";
import Link from "next/link";
import GoogleSignInButton from "@/components/GoogleSignInButton";

const optionLinks = [
  { id: "option-8", label: "Luminous Beam Hero" },
  { id: "option-7", label: "Skyline AI Hero" },
  { id: "option-3", label: "Cinematic Pulse" },
  { id: "option-4", label: "Aurora Command" },
  { id: "option-6", label: "Orbit Vault" }
];

const pulseBars = [22, 34, 29, 46, 39, 52, 48, 61, 56, 68, 62, 73, 70, 82];
const vaultBars = [30, 38, 41, 36, 55, 48, 63, 52, 68, 60, 74, 66];

function OptionBadge({ number, title, description }) {
  return (
    <div className="mb-8">
      <span className="inline-flex rounded-full border border-[#4f6795]/50 bg-[#0a152a]/70 px-3 py-1 text-[11px] font-medium tracking-[0.14em] text-[#a9bcda] uppercase">
        Option {number}
      </span>
      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{title}</h2>
      <p className="mt-3 max-w-[640px] text-sm leading-relaxed text-[#9fb2ce] sm:text-base">{description}</p>
    </div>
  );
}

function OptionCtas() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <GoogleSignInButton
        label="Continue with Google"
        className="!h-11 !rounded-xl !bg-gradient-to-b !from-[#71baff] !to-[#2f8dff] !px-6 !text-[15px] !font-semibold !text-white shadow-[0_14px_34px_rgba(47,141,255,0.35)] hover:brightness-110"
      />
      <Link
        href="#option-6"
        className="inline-flex h-11 items-center justify-center rounded-xl border border-[#6f8fb8]/55 bg-[#0b1220]/70 px-5 text-sm font-semibold text-[#dce7f8] transition hover:border-[#a9c6ee]"
      >
        View Pricing
      </Link>
    </div>
  );
}

function MetricChip({ label, value, up = true }) {
  return (
    <div className="rounded-xl border border-[#334a70]/55 bg-[#0a1428]/75 px-3 py-2">
      <p className="text-[11px] tracking-[0.08em] text-[#7f95b6] uppercase">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${up ? "text-[#69d5a6]" : "text-[#d9e6f8]"}`}>{value}</p>
    </div>
  );
}

export default function HeroOptionsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-[10000] border-b border-white/10 bg-[#02050d]/78 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-12 xl:px-16">
          <div className="flex items-center gap-3">
            <Image
              src="/assets/images/logo/logo_b.png"
              width={225}
              height={35}
              quality={100}
              alt="TradeStrom"
              className="h-auto w-[176px] sm:w-[212px]"
            />
            <span className="hidden rounded-full border border-[#3f5578]/50 bg-[#0d1628]/70 px-2.5 py-1 text-[11px] tracking-[0.08em] text-[#9fb2ce] uppercase sm:inline-flex">
              Premium Hero Showcase
            </span>
          </div>

          <nav className="hidden items-center gap-2 lg:flex">
            {optionLinks.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium tracking-[0.04em] text-[#9fb2ce] transition hover:border-[#5f7aa5]/55 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#6f8fb8]/55 bg-[#0b1220]/70 px-4 text-sm font-semibold text-[#dce7f8] transition hover:border-[#9fc0eb]"
          >
            Back to Landing
          </Link>
        </div>
      </header>

      <section id="option-8" className="relative overflow-hidden border-b border-white/10 bg-[#010611]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(44,124,255,0.18)_0%,transparent_34%),linear-gradient(180deg,#010611_0%,#010814_58%,#020d20_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-[-24%] h-[700px] w-[180px] -translate-x-1/2 rotate-[20deg] bg-[linear-gradient(180deg,rgba(142,205,255,0.88)_0%,rgba(71,149,255,0.36)_35%,rgba(9,32,77,0.02)_78%)] blur-[24px]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[180px] bg-[radial-gradient(ellipse_at_center,rgba(35,118,255,0.25)_0%,rgba(12,47,114,0.08)_56%,transparent_78%)]" />

        <div className="relative mx-auto w-full max-w-[1260px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24 xl:px-16">
          <div className="mx-auto max-w-[980px] text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3d6ca8]/55 bg-[#0b1c39]/72 px-4 py-1.5 text-[14px] font-medium text-[#d9e9ff]">
              <span className="text-[#8bc8ff]">✦</span>
              New: Our AI integration just landed
            </div>

            <h2 className="mt-6 text-5xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Achieve trading success using
              <span className="block">powerful AI-driven tools.</span>
            </h2>

            <p className="mx-auto mt-4 max-w-[760px] text-base leading-relaxed text-[#adbfdb] sm:text-lg">
              Get funded. Stay funded. Our intelligent dashboard uses real-time AI to help you avoid losses, optimize
              withdrawals, and grow your trading account confidently.
            </p>

            <div className="mt-9 flex justify-center">
              <GoogleSignInButton
                label="Get Started →"
                className="!h-14 !rounded-full !bg-gradient-to-b !from-[#56a8ff] !to-[#2f87ff] !px-10 !text-lg !font-semibold shadow-[0_18px_40px_rgba(47,135,255,0.48)] hover:brightness-110"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="option-7" className="relative overflow-hidden border-b border-white/10 bg-[#020712]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-18%,rgba(36,128,255,0.16)_0%,transparent_42%),linear-gradient(180deg,#030b1a_0%,#01050f_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[560px] w-[170px] -translate-x-1/2 rotate-[24deg] bg-[linear-gradient(180deg,rgba(147,207,255,0.8)_0%,rgba(61,145,255,0.44)_32%,rgba(9,29,64,0)_76%)] blur-[30px]" />
        <div className="pointer-events-none absolute left-1/2 bottom-[-44%] h-[520px] w-[1380px] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(40,146,255,0.9)_0%,rgba(21,86,179,0.58)_34%,rgba(8,34,82,0.22)_58%,transparent_80%)] blur-[22px]" />
        <div className="pointer-events-none absolute left-1/2 bottom-[-30%] h-[360px] w-[1050px] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(83,166,255,0.2)_0%,rgba(24,88,182,0.08)_46%,transparent_74%)]" />

        <div className="relative mx-auto w-full max-w-[1260px] px-5 pt-14 pb-20 sm:px-8 lg:px-12 xl:px-16">
          <div className="mx-auto max-w-[900px] text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3d6ca8]/55 bg-[#0b1c39]/72 px-4 py-1.5 text-[14px] font-medium text-[#d9e9ff]">
              <span className="text-[#8bc8ff]">✦</span>
              New: AI-integrated trading control
            </div>

            <h2 className="mt-6 text-5xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Achieve trading success using
              <span className="bg-gradient-to-r from-[#d6e9ff] via-[#8cc6ff] to-[#d6e9ff] bg-clip-text text-transparent"> AI-driven tools.</span>
            </h2>

            <p className="mx-auto mt-4 max-w-[760px] text-base leading-relaxed text-[#adbfdb] sm:text-lg">
              Get funded. Stay funded. Real-time analytics to manage risk, optimize execution, and grow consistently.
            </p>

            <div className="mt-8 flex justify-center">
              <GoogleSignInButton
                label="Get Started →"
                className="!h-14 !rounded-full !bg-gradient-to-b !from-[#56a8ff] !to-[#2f87ff] !px-10 !text-lg !font-semibold shadow-[0_18px_40px_rgba(47,135,255,0.48)] hover:brightness-110"
              />
            </div>
          </div>

          <div className="relative z-10 mt-14 flex justify-center">
            <div className="relative w-full max-w-[1060px]">
              <div className="pointer-events-none absolute inset-x-10 bottom-[-10%] h-[220px] rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(39,138,255,0.55)_0%,rgba(18,77,170,0.24)_48%,transparent_80%)] blur-[28px]" />
              <div className="relative mx-auto w-full max-w-[1260px]">
                <Image
                  src="/assets/images/background/hero_monitor_replacement.png"
                  width={1536}
                  height={1024}
                  quality={100}
                  alt="TradeStrom trading interface"
                  className="h-auto w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="option-3" className="relative overflow-hidden border-b border-white/10 bg-[#040a15]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_18%,rgba(79,138,255,0.24)_0%,transparent_48%),radial-gradient(circle_at_12%_86%,rgba(38,84,176,0.28)_0%,transparent_54%)]" />
        <div className="pointer-events-none absolute -left-[12%] top-[8%] h-[460px] w-[460px] rounded-full bg-[conic-gradient(from_120deg_at_50%_50%,rgba(68,131,255,0.38),rgba(58,106,221,0.12),rgba(12,24,54,0.02),rgba(68,131,255,0.38))] blur-[96px]" />
        <div className="pointer-events-none absolute right-[-10%] bottom-[-20%] h-[500px] w-[620px] rotate-[-12deg] bg-[radial-gradient(ellipse_at_center,rgba(86,150,255,0.28)_0%,rgba(21,45,96,0.08)_45%,transparent_78%)]" />

        <div className="relative mx-auto grid w-full max-w-[1360px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:py-24 lg:px-12 xl:px-16">
          <div>
            <OptionBadge
              number="03"
              title="Cinematic Pulse Terminal"
              description="A cinematic, institutional-grade hero with data pulse bars, execution context, and trust-first visual hierarchy."
            />

            <h3 className="text-4xl font-semibold leading-[1.04] tracking-[-0.02em] sm:text-5xl xl:text-6xl">
              Read Momentum.
              <span className="bg-gradient-to-r from-[#9ed2ff] to-[#3f86ff] bg-clip-text text-transparent"> Execute With Control.</span>
            </h3>
            <p className="mt-5 max-w-[620px] text-base leading-relaxed text-[#9fb2ce] sm:text-lg">
              Designed for active market participants who need clear directional conviction and tighter risk discipline.
            </p>
            <OptionCtas />
          </div>

          <div className="rounded-3xl border border-[#39557f]/55 bg-[#081224]/74 p-4 shadow-[0_32px_78px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-5">
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#314a72]/60 bg-[#060f1d]/85 px-3 py-2 text-xs text-[#a9bcda]">
              <span>NIFTY / BANKNIFTY • Intraday Grid</span>
              <span>Execution Window: Active</span>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-[#2a3f62]/55 bg-[#050a13] p-4">
                <div className="relative h-52 overflow-hidden rounded-xl border border-[#243854]/60 bg-[#02060d]">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_64%_38%,rgba(67,140,255,0.26),transparent_54%)]" />
                  <div className="absolute bottom-4 left-4 right-4 flex items-end gap-1.5">
                    {pulseBars.map((height, idx) => (
                      <span
                        key={`pulse-${idx}`}
                        className={`w-2.5 rounded-full ${idx % 4 === 0 ? "bg-[#2ac680]" : "bg-[#4390ff]"}`}
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-[#b5c7e2]">
                  <div className="rounded-lg border border-[#2f466d]/55 bg-[#0a1427]/80 px-2 py-2">Signal Strength 87%</div>
                  <div className="rounded-lg border border-[#2f466d]/55 bg-[#0a1427]/80 px-2 py-2">Trend Confidence High</div>
                  <div className="rounded-lg border border-[#2f466d]/55 bg-[#0a1427]/80 px-2 py-2">Risk Budget 0.8R</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-[#324a72]/60 bg-[#071022]/86 p-3">
                  <p className="text-[11px] tracking-[0.08em] text-[#7f95b6] uppercase">Live Watchlist</p>
                  <ul className="mt-2 space-y-1.5 text-xs text-[#c6d7ef]">
                    <li className="flex justify-between"><span>BANKNIFTY</span><span className="text-[#2ac680]">+1.23%</span></li>
                    <li className="flex justify-between"><span>RELIANCE</span><span className="text-[#2ac680]">+0.68%</span></li>
                    <li className="flex justify-between"><span>HDFCBANK</span><span className="text-[#f2a0a0]">-0.29%</span></li>
                  </ul>
                </div>
                <MetricChip label="Session PnL" value="+₹48,920" />
                <MetricChip label="Trade Precision" value="9.1 / 10" up={false} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="option-4" className="relative overflow-hidden border-b border-white/10 bg-[#03060f]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(72,110,216,0.28)_0%,transparent_42%),radial-gradient(circle_at_86%_30%,rgba(84,140,255,0.3)_0%,transparent_54%)]" />
        <div className="pointer-events-none absolute -left-[8%] top-[24%] h-[250px] w-[560px] rotate-[7deg] bg-[linear-gradient(90deg,transparent_0%,rgba(92,152,255,0.26)_36%,rgba(132,95,255,0.2)_66%,transparent_100%)] blur-[62px]" />
        <div className="pointer-events-none absolute right-[-14%] top-[42%] h-[270px] w-[620px] rotate-[-10deg] bg-[linear-gradient(90deg,transparent_0%,rgba(60,123,240,0.24)_34%,rgba(146,108,255,0.2)_68%,transparent_100%)] blur-[66px]" />

        <div className="relative mx-auto grid w-full max-w-[1360px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr] lg:py-24 lg:px-12 xl:px-16">
          <div>
            <OptionBadge
              number="04"
              title="Aurora Command Deck"
              description="A more artistic and premium command layout with layered glow fields, floating analytics modules, and mobile-first execution visual."
            />

            <h3 className="text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl xl:text-6xl">
              Trade The
              <span className="bg-gradient-to-r from-[#97c6ff] via-[#7ea0ff] to-[#8f73ff] bg-clip-text text-transparent"> Institutional Pulse</span>
            </h3>
            <p className="mt-5 max-w-[620px] text-base leading-relaxed text-[#9fb2ce] sm:text-lg">
              This concept blends premium SaaS polish with market-focused visual storytelling for higher perceived trust.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <MetricChip label="Momentum" value="Strong" up={false} />
              <MetricChip label="Volatility" value="Controlled" up={false} />
              <MetricChip label="Execution" value="Window Open" up={false} />
            </div>

            <OptionCtas />
          </div>

          <div className="relative h-[470px] sm:h-[530px]">
            <div className="absolute left-1/2 top-[10%] h-[280px] w-[280px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(76,136,255,0.5)_0%,rgba(36,69,165,0.3)_45%,transparent_78%)] blur-[94px]" />

            <div className="absolute left-[6%] top-[10%] w-[56%] rounded-2xl border border-[#36517a]/55 bg-[#091326]/78 p-4 shadow-[0_22px_54px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <p className="text-xs tracking-[0.08em] text-[#87a0c3] uppercase">Execution Confidence</p>
              <div className="mt-3 h-2 rounded-full bg-[#13233c]">
                <div className="h-2 w-[74%] rounded-full bg-gradient-to-r from-[#42b8ff] to-[#6a86ff]" />
              </div>
              <p className="mt-2 text-sm text-[#c7d8f0]">74% setup alignment</p>
            </div>

            <div className="absolute right-[5%] top-[20%] w-[44%] rounded-2xl border border-[#36517a]/55 bg-[#091326]/78 p-4 shadow-[0_22px_54px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <p className="text-xs tracking-[0.08em] text-[#87a0c3] uppercase">Liquidity Radar</p>
              <p className="mt-2 text-2xl font-semibold text-[#ddedff]">+2.4σ</p>
              <p className="text-xs text-[#9eb3d1]">Unusual participation detected</p>
            </div>

            <div className="absolute bottom-0 left-1/2 w-[64%] -translate-x-1/2 rounded-[28px] border border-[#385481]/55 bg-[#071022]/84 p-4 shadow-[0_30px_72px_rgba(0,0,0,0.56)] backdrop-blur-xl">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs tracking-[0.08em] text-[#87a0c3] uppercase">Aurora Mobile Panel</p>
                  <p className="mt-1 text-xl font-semibold text-[#deedff]">Ready For Entry</p>
                </div>
                <Image
                  src="/assets/images/iphone/2.png"
                  width={180}
                  height={860}
                  alt="aurora mobile"
                  className="h-auto w-[95px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="option-6" className="relative overflow-hidden bg-black">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_30%,rgba(54,118,255,0.24)_0%,transparent_48%),linear-gradient(180deg,#000000_0%,#030710_100%)]" />
        <div className="pointer-events-none absolute left-[-12%] top-[10%] h-[360px] w-[620px] rotate-[12deg] bg-[linear-gradient(90deg,transparent_0%,rgba(97,154,255,0.2)_42%,rgba(68,125,235,0.08)_67%,transparent_100%)] blur-[72px]" />
        <div className="pointer-events-none absolute right-[-14%] bottom-[8%] h-[380px] w-[640px] rotate-[-14deg] bg-[linear-gradient(90deg,transparent_0%,rgba(80,141,255,0.18)_44%,rgba(44,83,175,0.08)_69%,transparent_100%)] blur-[76px]" />

        <div className="relative mx-auto grid w-full max-w-[1320px] items-center gap-12 px-5 py-22 sm:px-8 lg:grid-cols-[1fr_1fr] lg:py-24 lg:px-12 xl:px-16">
          <div>
            <OptionBadge
              number="06"
              title="Orbit Vault Experience"
              description="A signature, high-concept fintech hero using orbital geometry, premium gradients, and structured metrics. Distinctive and memorable."
            />

            <h3 className="text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl xl:text-6xl">
              The Next-Gen
              <span className="bg-gradient-to-r from-[#9fd1ff] to-[#4e8bff] bg-clip-text text-transparent"> Trading Vault</span>
            </h3>
            <p className="mt-5 max-w-[620px] text-base leading-relaxed text-[#9fb2ce] sm:text-lg">
              Blends institutional clarity with modern product aesthetics, perfect for a premium trading brand launch.
            </p>
            <OptionCtas />
          </div>

          <div className="relative mx-auto h-[430px] w-full max-w-[520px] sm:h-[520px]">
            <div className="absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#3e5983]/45" />
            <div className="absolute left-1/2 top-1/2 h-[470px] w-[470px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#2d4363]/40" />
            <div className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(72,132,255,0.5)_0%,rgba(30,63,148,0.34)_46%,transparent_78%)] blur-[84px]" />

            <div className="absolute left-1/2 top-1/2 w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-[#37537e]/55 bg-[#071123]/84 p-4 shadow-[0_30px_72px_rgba(0,0,0,0.56)]">
              <p className="text-xs tracking-[0.08em] text-[#87a0c3] uppercase">Vault Analytics</p>
              <div className="mt-3 flex items-end gap-1.5">
                {vaultBars.map((height, idx) => (
                  <span
                    key={`vault-${idx}`}
                    className={`w-2.5 rounded-full ${idx % 3 === 0 ? "bg-[#2ac680]" : "bg-[#4a92ff]"}`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#c8d9f0]">
                <div className="rounded-md bg-[#0d1a31]/72 px-2 py-2 text-center">Risk Map Synced</div>
                <div className="rounded-md bg-[#0d1a31]/72 px-2 py-2 text-center">Entry Score 91</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
