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
        className="app-modal-panel relative max-h-[calc(100vh-48px)] w-full max-w-[450px] overflow-hidden rounded-3xl border border-[#293440] bg-[#11161c] shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="home-soft-button absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-[#0f1318]/80 text-[#8f9aa8] backdrop-blur transition hover:text-[#edf1f5]"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>

        <div className="bg-[#151b22]">
          <img
            alt=""
            className="h-[260px] w-full object-cover"
            draggable={false}
            src={step.image}
          />
        </div>

        <div className="space-y-5 p-5">
          <div>
            <h2 className="text-xl font-bold tracking-normal text-[#edf1f5]">{step.title}</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-[#9aa5b3]">{step.body}</p>
          </div>

          <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
            {steps.map((item, index) => (
              <span
                className={`h-1.5 rounded-full transition ${
                  item.title === step.title ? "w-7 bg-[#3b91f6]" : "w-1.5 bg-[#3a4654]"
                }`}
                key={item.title}
              />
            ))}
          </div>

          <button
            className="home-soft-button h-12 w-full rounded-xl bg-[#3b91f6] text-sm font-bold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none"
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
