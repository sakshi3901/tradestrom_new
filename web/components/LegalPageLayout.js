import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export default function LegalPageLayout({ title, children }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(56,115,255,0.18)_0%,rgba(24,63,149,0.08)_24%,transparent_50%),linear-gradient(180deg,#000000_0%,#030915_58%,#071327_100%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(178,208,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(178,208,255,0.2)_1px,transparent_1px)] [background-size:122px_122px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-[#6f8fb8]/30 bg-black/55 backdrop-blur-xl">
        <div className="flex w-full items-center justify-between px-5 py-3 sm:px-8 lg:px-12 xl:px-16 2xl:px-20">
          <Link href="/" className="inline-flex items-center">
            <Image
              src="/assets/images/logo/logo_b.png"
              width={225}
              height={35}
              quality={100}
              alt="TradeStrom"
              className="h-auto w-[190px] sm:w-[225px]"
            />
          </Link>

          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#8fb2df]/60 bg-[#84b1ff] px-5 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Home
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <h1 className="text-center text-3xl font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-4xl">
          {title}
        </h1>
        <div className="mt-7 rounded-2xl border border-[#2c3f5f]/55 bg-[#0a1120]/45 p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
