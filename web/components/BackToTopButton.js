"use client";

import { useEffect, useState } from "react";

export default function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const heroSection = document.getElementById("loginpage_section1");
      const threshold = heroSection
        ? Math.max(heroSection.offsetHeight - 140, 260)
        : window.innerHeight;

      setVisible(window.scrollY > threshold);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed right-5 bottom-5 z-[9000] inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#66a6ff]/45 bg-[linear-gradient(140deg,rgba(30,64,120,0.82),rgba(20,47,94,0.75))] text-[#e6efff] shadow-[0_14px_30px_rgba(8,17,35,0.65)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-[#8bc0ff] hover:text-white ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
        <path d="M12 7.75 5.25 14.5l1.5 1.5L12 10.76 17.25 16l1.5-1.5L12 7.75Z" />
      </svg>
    </button>
  );
}
