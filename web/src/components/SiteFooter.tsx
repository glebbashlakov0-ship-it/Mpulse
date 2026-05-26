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
    <footer className="border-t border-[#242b32] bg-[#15191d]">
      <div className="mx-auto max-w-[1350px] px-4 py-14 lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <img
            className="h-12 w-24 object-contain"
            src="/site-logo.png"
            alt=""
            aria-hidden="true"
          />
          <div>
            <strong className="text-2xl font-semibold text-[#dee3e7]">Pulse Market</strong>
            <p className="mt-1 text-sm font-medium text-[#7b8996]">
              The professional prediction market interface™
            </p>
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_220px_180px]">
          <section id="markets">
            <h2 className="text-sm font-semibold text-[#7b8996]">
              Markets by category and topics
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {relatedTopics.map((topic) => (
                <a className="group block" href="#markets" key={topic}>
                  <span className="block text-sm font-semibold text-[#dee3e7] transition group-hover:text-white">
                    {topic}
                  </span>
                  <small className="text-sm font-medium text-[#7b8996]">Predictions & odds</small>
                </a>
              ))}
            </div>
            <button className="home-soft-button mt-7 flex items-center gap-1 text-sm font-semibold text-[#7b8996] transition hover:text-[#dee3e7]">
              View more
              <ChevronRight size={15} />
            </button>
          </section>

          <FooterColumn title="Support & Social" id="help">
            {supportLinks.map((link) => (
              <a href="#support" key={link}>
                {link}
              </a>
            ))}
          </FooterColumn>

          <FooterColumn title="Pulse Market" id="docs">
            {companyLinks.map((link) => (
              <a href="#company" key={link}>
                {link}
              </a>
            ))}
          </FooterColumn>
        </div>

        <div className="mt-14 grid gap-8 border-t border-[#242b32] pt-8 lg:grid-cols-[220px_1fr_160px] lg:items-center">
          <div className="flex items-center gap-4 text-[#dee3e7]" aria-label="Social links">
            <a className="transition hover:text-[#0093fd]" href="#email" aria-label="Email">
              <Mail size={22} />
            </a>
            <a className="font-semibold transition hover:text-[#0093fd]" href="#x" aria-label="X">
              X
            </a>
            <a className="transition hover:text-[#0093fd]" href="#instagram" aria-label="Instagram">
              <Instagram size={22} />
            </a>
            <a className="transition hover:text-[#0093fd]" href="#discord" aria-label="Discord">
              <UsersRound size={22} />
            </a>
            <a className="transition hover:text-[#0093fd]" href="#tiktok" aria-label="TikTok">
              <Music2 size={22} />
            </a>
          </div>

          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-[#7b8996]" aria-label="Legal links">
            <span className="text-[#dee3e7]">Pulse Market Inc. © 2026</span>
            <a className="transition hover:text-[#dee3e7]" href="#privacy">Privacy</a>
            <a className="transition hover:text-[#dee3e7]" href="#terms" id="terms">Terms of Use</a>
            <a className="transition hover:text-[#dee3e7]" href="#integrity">Market Integrity</a>
            <a className="transition hover:text-[#dee3e7]" href="#help">Help Center</a>
            <a className="transition hover:text-[#dee3e7]" href="#docs">Docs</a>
          </nav>

          <button className="home-soft-button flex items-center gap-2 justify-self-start rounded-2xl px-3 py-2 text-sm font-semibold text-[#dee3e7] transition hover:bg-[#1e2428] lg:justify-self-end">
            <Globe2 size={18} />
            English
            <ChevronRight size={15} />
          </button>
        </div>

        <p className="mt-8 max-w-6xl text-sm leading-6 text-[#7b8996]">
          Trading prediction markets may involve substantial risk and can be subject to financial,
          gaming, and virtual asset regulation depending on jurisdiction. Market availability,
          account access, and payment features may vary by region and eligibility.
        </p>

      </div>
    </footer>
  );
}

function FooterColumn({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id}>
      <h2 className="text-sm font-semibold text-[#7b8996]">{title}</h2>
      <div className="mt-5 grid gap-4 text-sm font-semibold text-[#dee3e7] [&_a]:transition [&_a:hover]:text-[#0093fd]">
        {children}
      </div>
    </section>
  );
}
