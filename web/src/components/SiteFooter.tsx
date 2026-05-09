import {
  ChevronRight,
  Globe2,
  Instagram,
  Mail,
  Music2,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

const relatedTopics = [
  "Congress Expulsions",
  "IPOs",
  "Movies",
  "Commodities",
  "Indian Elections",
  "Midterms",
  "Fed",
  "Parlays",
  "Trump",
  "GPT-5.5",
  "AI",
  "Ukraine",
  "Crypto Prices",
  "Iran",
];

const supportLinks = [
  "Learn",
  "X (Twitter)",
  "Instagram",
  "Discord",
  "TikTok",
  "News",
  "Contact us",
  "Help Center",
];

const companyLinks = [
  "Rewards",
  "APIs",
  "Leaderboard",
  "Accuracy",
  "Brand",
  "Activity",
  "Careers",
  "Press",
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[#293440] bg-[#0f1318]">
      <div className="mx-auto max-w-[1500px] px-4 py-14 md:px-6 xl:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 place-items-center rounded-lg border-2 border-[#edf1f5] text-xs font-bold">
            MP
          </span>
          <div>
            <strong className="text-2xl font-semibold text-[#edf1f5]">Market Pulse</strong>
            <p className="mt-1 text-sm font-medium text-[#8f9aa8]">
              The professional prediction market interface™
            </p>
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_220px_180px]">
          <section>
            <h2 className="text-sm font-semibold text-[#8f9aa8]">
              Markets by category and topics
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {relatedTopics.map((topic) => (
                <a className="group block" href="#markets" key={topic}>
                  <span className="block text-sm font-semibold text-[#edf1f5] transition group-hover:text-white">
                    {topic}
                  </span>
                  <small className="text-sm font-medium text-slate-600">Predictions & odds</small>
                </a>
              ))}
            </div>
            <button className="mt-7 flex items-center gap-1 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]">
              View more
              <ChevronRight size={15} />
            </button>
          </section>

          <FooterColumn title="Support & Social">
            {supportLinks.map((link) => (
              <a href="#support" key={link}>
                {link}
              </a>
            ))}
          </FooterColumn>

          <FooterColumn title="Market Pulse">
            {companyLinks.map((link) => (
              <a href="#company" key={link}>
                {link}
              </a>
            ))}
          </FooterColumn>
        </div>

        <div className="mt-14 grid gap-8 border-t border-[#293440] pt-8 lg:grid-cols-[220px_1fr_160px] lg:items-center">
          <div className="flex items-center gap-4 text-[#edf1f5]" aria-label="Social links">
            <a className="transition hover:text-[#3b91f6]" href="#email" aria-label="Email">
              <Mail size={22} />
            </a>
            <a className="font-semibold transition hover:text-[#3b91f6]" href="#x" aria-label="X">
              X
            </a>
            <a className="transition hover:text-[#3b91f6]" href="#instagram" aria-label="Instagram">
              <Instagram size={22} />
            </a>
            <a className="transition hover:text-[#3b91f6]" href="#discord" aria-label="Discord">
              <UsersRound size={22} />
            </a>
            <a className="transition hover:text-[#3b91f6]" href="#tiktok" aria-label="TikTok">
              <Music2 size={22} />
            </a>
          </div>

          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-[#8f9aa8]" aria-label="Legal links">
            <span className="text-[#edf1f5]">Market Pulse Inc. © 2026</span>
            <a className="transition hover:text-[#edf1f5]" href="#privacy">Privacy</a>
            <a className="transition hover:text-[#edf1f5]" href="#terms">Terms of Use</a>
            <a className="transition hover:text-[#edf1f5]" href="#integrity">Market Integrity</a>
            <a className="transition hover:text-[#edf1f5]" href="#help">Help Center</a>
            <a className="transition hover:text-[#edf1f5]" href="#docs">Docs</a>
          </nav>

          <button className="flex items-center gap-2 justify-self-start rounded-lg px-3 py-2 text-sm font-semibold text-[#edf1f5] transition hover:bg-[#171d24] lg:justify-self-end">
            <Globe2 size={18} />
            English
            <ChevronRight size={15} />
          </button>
        </div>

        <p className="mt-8 max-w-6xl text-sm leading-6 text-slate-600">
          Trading prediction markets may involve substantial risk and can be subject to financial,
          gaming, and virtual asset regulation depending on jurisdiction. Market availability,
          account access, and payment features may vary by region and eligibility.
        </p>

        <button
          className="fixed bottom-5 left-1/2 z-30 hidden -translate-x-1/2 rounded-full bg-[#1d252e] px-4 py-2 text-sm font-semibold text-[#edf1f5] shadow-xl transition hover:bg-[#293440] md:flex"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          Back to top ↑
        </button>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-[#8f9aa8]">{title}</h2>
      <div className="mt-5 grid gap-4 text-sm font-semibold text-[#edf1f5] [&_a]:transition [&_a:hover]:text-[#3b91f6]">
        {children}
      </div>
    </section>
  );
}
