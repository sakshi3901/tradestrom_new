import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import LandingUnauthorizedToast from "@/components/LandingUnauthorizedToast";
import BackToTopButton from "@/components/BackToTopButton";
import SiteFooter from "@/components/SiteFooter";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

const featureCards = [
  {
    title: "Structured Trade Management",
    description:
      "Build disciplined entries, set risk before execution, and keep every decision in a repeatable framework.",
    stat: "Execution-first workflow",
    context: "Pre-trade structure"
  },
  {
    title: "Risk-First Analytics",
    description:
      "Track drawdown, exposure, and confidence in real time so risk controls stay active before emotions take over.",
    stat: "Live risk visibility",
    context: "Real-time guardrails"
  },
  {
    title: "Precision Performance Tracking",
    description:
      "Measure consistency with session-level analytics, setup quality scoring, and outcome attribution.",
    stat: "Signal-to-result clarity",
    context: "Session-level attribution"
  }
];

const showcaseCards = [
  {
    title: "Command-Center Dashboard",
    description:
      "A high-signal workspace that prioritizes market structure, momentum shifts, and execution readiness.",
    bullets: ["Real-time chart context", "High-conviction setup visibility", "Fast decision surface"],
    image: "/assets/images/iphone/4.png"
  },
  {
    title: "Role-Based Control",
    description:
      "Grant and revoke access securely with admin-controlled visibility and protected internal API flows.",
    bullets: ["Admin + client segmentation", "Controlled onboarding", "Secure internal actions"],
    image: "/assets/images/iphone/1.png"
  },
  {
    title: "Performance Confidence Layer",
    description:
      "Review performance quality and risk adherence in a clean, trader-focused analytics interface.",
    bullets: ["Outcome audit trail", "Setup-quality tracking", "Continuous improvement loop"],
    image: "/assets/images/iphone/2.png"
  }
];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);

  if (session?.user?.email) {
    let hasAccess = false;

    try {
      const access = await checkAccess(session.user.email);
      hasAccess = Boolean(access?.allowed);
    } catch (error) {
      hasAccess = false;
    }

    if (hasAccess) {
      redirect("/nifty-contribution");
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#03060f] text-white">
      <LandingUnauthorizedToast />

      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_72%_22%,rgba(56,124,255,0.2),transparent_46%),linear-gradient(180deg,#02050d_0%,#040a18_60%,#061227_100%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.18] [background-image:linear-gradient(rgba(145,182,238,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(145,182,238,0.4)_1px,transparent_1px)] [background-size:136px_136px]" />

      <section id="loginpage_section1" className="relative min-h-screen overflow-hidden border-b border-[#6f8fb8]/20">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/hero/loginbg3_ultra.webp?v=20260218y')" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,15,0.82)_0%,rgba(2,6,15,0.56)_32%,rgba(2,6,15,0.24)_58%,rgba(2,6,15,0.18)_100%)]" />

        <header className="fixed inset-x-0 top-0 z-[10000]">
          <div className="border-b border-[#6f8fb8]/30 bg-[rgba(5,12,27,0.32)] shadow-[0_12px_35px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-5 py-3 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
              <a href="#loginpage_section1" className="flex items-center">
                <Image
                  src="/assets/images/logo/logo_b.png"
                  width={225}
                  height={35}
                  quality={100}
                  alt="TradeStrom"
                  className="h-auto w-[190px] sm:w-[225px]"
                />
              </a>

              <GoogleSignInButton
                label="Login Now"
                className="!h-11 !w-[150px] !rounded-xl border border-[#a8c3e6]/60 !bg-[rgba(8,18,33,0.45)] !px-3 !py-2 text-sm !font-semibold tracking-[0.01em] text-[#e5eefb] shadow-[0_8px_20px_rgba(0,0,0,0.35)] hover:!border-[#d8e7ff] hover:!bg-[rgba(15,31,56,0.7)] sm:text-[15px]"
              />
            </div>
          </div>
        </header>

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] items-center px-5 pb-16 pt-28 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="w-full max-w-[760px]">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b8d6ff]">
              Structured Trading Environment
            </p>

            <h1 className="mt-6 text-[42px] font-semibold leading-[1.03] tracking-[-0.03em] text-white sm:text-[56px] lg:text-[74px] 2xl:text-[86px]">
              Trade Smarter.
              <span className="block bg-gradient-to-r from-[#d8e8ff] via-[#7db6ff] to-[#4a8eff] bg-clip-text text-transparent">
                Execute with Discipline.
              </span>
            </h1>

            <p className="mt-6 max-w-[620px] text-[17px] leading-[1.75] text-[#bdd0ea] sm:text-[20px]">
              Tradestrom is a premium, structured trading workspace for serious market
              participants who want high-signal execution and risk-controlled growth.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <GoogleSignInButton
                label="Continue with Google"
                className="!h-12 !rounded-xl !bg-gradient-to-b !from-[#60a8ff] !to-[#2486fa] !px-6 !text-[15px] !font-semibold text-white shadow-[0_14px_35px_rgba(36,134,250,0.45)] hover:brightness-110"
              />
              <a
                href="#pricing_section"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-[#8fb8ff]/40 bg-[#0d2044]/45 px-6 text-[15px] font-semibold text-[#d6e7ff] transition hover:border-[#b6d4ff]/70 hover:bg-[#143163]/55"
              >
                View Pricing
              </a>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-[#b8cbe7] sm:text-base">
              <p className="leading-none">
                <span className="text-lg font-semibold text-[#ecf4ff] sm:text-xl">99.2%</span>{" "}
                Execution Uptime
              </p>
              <span className="hidden h-1 w-1 rounded-full bg-[#7dafff] sm:inline-block" />
              <p className="leading-none">
                <span className="text-lg font-semibold text-[#ecf4ff] sm:text-xl">24/7</span> Signal
                Monitoring
              </p>
              <span className="hidden h-1 w-1 rounded-full bg-[#7dafff] sm:inline-block" />
              <p className="leading-none">
                <span className="text-lg font-semibold text-[#ecf4ff] sm:text-xl">Role-Secured</span>{" "}
                Access Layer
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative overflow-hidden py-24 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_28%,rgba(58,127,243,0.15),transparent_40%),radial-gradient(circle_at_80%_62%,rgba(39,93,201,0.14),transparent_44%)]" />
        <div className="mx-auto w-full max-w-[1450px] px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="mx-auto max-w-[920px] text-center">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#8ab4ee] uppercase">
              Why Traders Choose Tradestrom
            </p>
            <h2 className="mt-4 text-[40px] font-semibold leading-[1.06] tracking-[-0.035em] text-[#edf4ff] sm:text-[58px] lg:text-[74px]">
              Built for serious market participants
            </h2>
            <p className="mx-auto mt-5 max-w-[760px] text-base leading-relaxed text-[#9eb3d2] sm:text-[21px]">
              Institutional visual language, clean decision surfaces, and role-controlled workflows
              designed for clarity under pressure.
            </p>
          </div>

          <div className="mx-auto mt-16 max-w-[1160px]">
            <div className="relative">
              <span className="pointer-events-none absolute bottom-0 left-4 top-2 hidden w-px bg-gradient-to-b from-[#6ea7ef]/40 via-[#2f5c9f]/35 to-transparent md:block" />

              {featureCards.map((card, index) => (
                <article
                  key={card.title}
                  className="group relative grid gap-4 border-b border-[#2d4d79]/45 py-8 md:grid-cols-[250px_1fr_auto] md:gap-9 md:pl-14 md:py-10"
                >
                  <span className="absolute left-0 top-10 hidden h-8 w-8 items-center justify-center rounded-full border border-[#82b6fb]/45 bg-[linear-gradient(180deg,rgba(22,50,95,0.55)_0%,rgba(8,22,46,0.35)_100%)] text-sm font-semibold text-[#d3e5ff] shadow-[0_8px_20px_rgba(8,20,45,0.5)] backdrop-blur-xl md:flex">
                    {index + 1}
                  </span>

                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#89b4ee] md:pt-1">
                    {card.stat}
                  </p>

                  <div>
                    <h3 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-[#eaf2ff] sm:text-[38px]">
                      {card.title}
                    </h3>
                    <p className="mt-3 max-w-[780px] text-[16px] leading-relaxed text-[#9db4d5] sm:text-[21px]">
                      {card.description}
                    </p>
                  </div>

                  <div className="flex items-start md:items-center md:justify-end">
                    <span className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#bfd4f1]">
                      <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#8ab5ee]/75 md:w-10" />
                      {card.context}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="relative py-24 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(56,121,235,0.12),transparent_45%)]" />
        <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <div className="mb-12 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8fb9f2]">
              Product Showcase
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-[#ebf3ff] sm:text-5xl lg:text-6xl">
              Built for decisive execution
            </h2>
          </div>

          <div className="space-y-2">
            {showcaseCards.map((item, index) => (
              <article
                key={item.title}
                className="group grid items-center gap-10 border-b border-[#315381]/35 py-14 lg:grid-cols-[1.04fr_0.96fr] lg:gap-14"
              >
                <div className={`max-w-[640px] ${index % 2 === 1 ? "lg:order-2 lg:justify-self-end" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold tracking-[0.12em] text-[#8fb9f2]">
                      0{index + 1}
                    </span>
                    <span className="h-px w-20 bg-gradient-to-r from-[#69a7ff]/60 to-transparent" />
                  </div>

                  <h3 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-[#e9f2ff] sm:text-4xl">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-[#a5bad8] sm:text-lg lg:text-[22px] lg:leading-[1.55]">
                    {item.description}
                  </p>

                  <ul className="mt-7 space-y-3 text-sm text-[#cbdaef] sm:text-base">
                    {item.bullets.map((point) => (
                      <li key={point} className="flex items-start gap-3 transition group-hover:translate-x-[2px]">
                        <span className="mt-[9px] inline-block h-[6px] w-[6px] rounded-full bg-[#58a0ff]" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={`relative flex items-center justify-center ${index % 2 === 1 ? "lg:order-1" : ""}`}>
                  <div className="absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(88,152,255,0.34),transparent_72%)] blur-[50px]" />
                  <div className="pointer-events-none absolute inset-x-8 bottom-5 h-px bg-gradient-to-r from-transparent via-[#7fb3ff]/55 to-transparent opacity-65" />
                  <Image
                    src={item.image}
                    width={310}
                    height={1280}
                    quality={100}
                    alt={item.title}
                    className="relative z-10 h-auto w-[230px] drop-shadow-[0_28px_58px_rgba(9,15,31,0.9)] sm:w-[300px]"
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing_section" className="relative isolate overflow-hidden bg-[#00030a] py-16 sm:py-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_74%,rgba(24,88,214,0.34),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,20,45,0.15)_0%,rgba(1,5,14,0)_22%,rgba(1,5,14,0)_74%,rgba(7,20,45,0.2)_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-[54%] h-[340px] w-[min(88vw,640px)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(17,73,178,0.42),transparent_72%)] blur-3xl" />

        <div className="mx-auto flex min-h-[620px] w-full max-w-[1080px] flex-col items-center px-5 text-center sm:min-h-[700px] sm:px-8">
          <p className="text-[clamp(15px,1.1vw,24px)] leading-none text-[#e7edf8]">But there is one more thing...</p>
          <span className="mt-5 h-[160px] w-px border-l border-dashed border-[#90accc]/80 sm:h-[200px]" />

          <h2 className="mt-7 bg-gradient-to-b from-[#f5f8ff] to-[#a9b8cb] bg-clip-text text-[clamp(62px,6.1vw,124px)] font-semibold leading-none tracking-[-0.045em] text-transparent [text-shadow:0_14px_34px_rgba(53,118,233,0.24)]">
            It&apos;s Free
          </h2>
          <p className="mt-3 text-[clamp(21px,1.95vw,38px)] leading-none text-[#b3c3da]">with TCI Mentorship</p>

          <div className="relative mt-9">
            <div className="pointer-events-none absolute inset-[-28px] rounded-[46px] bg-[radial-gradient(circle,rgba(17,86,204,0.5),transparent_72%)] blur-3xl" />
            <div className="relative flex h-[94px] w-[94px] items-center justify-center rounded-[24px] border border-[#8db0db]/45 bg-[linear-gradient(180deg,rgba(16,44,89,0.52)_0%,rgba(6,23,53,0.5)_100%)] shadow-[inset_0_1px_0_rgba(190,220,255,0.22),0_12px_28px_rgba(4,14,34,0.6)] backdrop-blur-xl sm:h-[112px] sm:w-[112px]">
              <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-[#9bbbe0]/45 bg-[rgba(3,16,43,0.7)] sm:h-[62px] sm:w-[62px]">
                <Image
                  src="/assets/images/logo/WHITE.svg"
                  width={42}
                  height={42}
                  alt="Tradestrom"
                  className="h-10 w-10 sm:h-11 sm:w-11"
                />
              </div>
            </div>
          </div>

          <a
            href="https://www.academy-tci.com/courses/Trading-Mastery--Beginner-To-Pro-685956edce84047583883b44"
            target="_blank"
            rel="noreferrer"
            className="relative mt-8 inline-flex h-[48px] w-[min(88vw,500px)] items-center justify-center overflow-hidden rounded-full border border-[#8fc2ff]/38 bg-[linear-gradient(180deg,rgba(108,177,255,0.96)_0%,rgba(45,112,201,0.96)_100%)] px-8 text-[clamp(15px,1vw,18px)] font-medium text-[#eff6ff] shadow-[inset_0_1px_0_rgba(220,238,255,0.38),0_16px_34px_rgba(22,94,210,0.44)] transition duration-300 hover:translate-y-[-1px] hover:brightness-110 sm:h-[58px]"
          >
            <span className="pointer-events-none absolute inset-x-8 top-0 h-[52%] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.26),rgba(255,255,255,0))]" />
            Take me to Mentorshipship Page
          </a>
        </div>
      </section>

      <SiteFooter logoHref="#loginpage_section1" />
      <BackToTopButton />
    </main>
  );
}
