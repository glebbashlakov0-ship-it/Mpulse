import { X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

const steps = [
  {
    image: "/how-it-works-pick.png",
    title: "1. Pick a Pulse Market",
    body:
      "Choose a market and decide whether the outcome is likely to happen. Prices update in real time as traders move the odds.",
  },
  {
    image: "/how-it-works-trade.png",
    title: "2. Place a Trade",
    body:
      "Pick Yes or No, choose an amount, and see the potential payout before you commit.",
  },
  {
    image: "/how-it-works-redeem.png",
    title: "3. Cash Out",
    body:
      "Sell your position before the market ends or hold it through resolution to redeem winning shares.",
  },
];

export function HowItWorksModal({
  onClose,
  onGetStarted,
}: {
  onClose: () => void;
  onGetStarted: () => void;
}) {
  const [stepIndex, setStepIndex] = React.useState(0);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function handlePrimaryAction() {
    if (isLastStep) {
      onGetStarted();
      return;
    }

    setStepIndex((current) => current + 1);
  }

  return createPortal(
    <div
      aria-modal="true"
      className="app-modal-overlay fixed inset-0 z-[90] grid place-items-center bg-black/72 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="app-modal-panel relative max-h-[calc(100vh-48px)] w-full max-w-[450px] overflow-hidden rounded-3xl border border-[#242b32] bg-[#181d21] shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="home-soft-button absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-[#15191d]/80 text-[#7b8996] backdrop-blur transition hover:text-[#dee3e7]"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>

        <div className="bg-[#181d21]">
          <img
            alt=""
            className="h-[260px] w-full object-cover"
            draggable={false}
            src={step.image}
          />
        </div>

        <div className="space-y-5 p-5">
          <div>
            <h2 className="text-xl font-bold tracking-normal text-[#dee3e7]">{step.title}</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-[#9aa5b3]">{step.body}</p>
          </div>

          <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
            {steps.map((item, index) => (
              <span
                className={`h-1.5 rounded-full transition ${
                  item.title === step.title ? "w-7 bg-[#0093fd]" : "w-1.5 bg-[#3a4654]"
                }`}
                key={item.title}
              />
            ))}
          </div>

          <button
            className="home-soft-button h-12 w-full rounded-xl bg-[#0093fd] text-sm font-bold text-white shadow-[0_4px_0_rgba(0,0,0,0.28)] transition hover:bg-[#26a3fd]"
            onClick={handlePrimaryAction}
            type="button"
          >
            {isLastStep ? "Get Started" : "Next"}
          </button>

          {isLastStep ? (
            <p className="text-center text-xs font-medium text-[#7f8b99]">
              Trading is subject to eligibility requirements and market risk.
            </p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
