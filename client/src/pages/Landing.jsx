import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import fintechChart from '../assets/fintech-chart.png';
import fintechCard from '../assets/fintech-card.png';
import fintechOrb from '../assets/fintech-orb.png';

// Landing-page-only redesign, modeled on a reference build (a separate
// Lovable/shadcn project, not part of this app) the same headline/subhead
// copy was already written for. Scoped to this one file deliberately —
// no new shared tokens, no changes to index.css — everything below,
// including the float-animation keyframes, is self-contained here.
//
// One deliberate departure from the reference: it used two glow hues
// (blue + violet). This app's established rule is one restrained accent
// color (cobalt), so both glows below are the same cobalt hue at different
// sizes/opacities instead of introducing a second decorative color.
export default function Landing() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-porcelain px-6 py-24">
      <style>{`
        @keyframes landing-float-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        .landing-float-a { animation: landing-float-slow 9s ease-in-out infinite; }
        .landing-float-b { animation: landing-float-slow 12s ease-in-out infinite; }
        .landing-float-c { animation: landing-float-slow 15s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .landing-float-a, .landing-float-b, .landing-float-c { animation: none; }
        }
      `}</style>

      {/* Soft radial glows — cobalt only, no second hue (see file comment). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 top-1/4 h-[34rem] w-[34rem] rounded-full bg-cobalt-600/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 bottom-1/4 h-[30rem] w-[30rem] rounded-full bg-cobalt-600/[0.06] blur-3xl"
      />

      {/* Floating artwork — masked to fade at the edges so the rectangular
          PNGs read as soft shapes, not pasted images. */}
      <img
        src={fintechChart}
        alt=""
        aria-hidden="true"
        width={1024}
        height={1024}
        className="landing-float-a pointer-events-none absolute -left-10 bottom-[8%] w-52 opacity-70 [mask-image:radial-gradient(closest-side,black_80%,transparent)] sm:left-[6%] sm:w-72 lg:w-80"
      />
      <img
        src={fintechCard}
        alt=""
        aria-hidden="true"
        width={1024}
        height={1024}
        className="landing-float-b pointer-events-none absolute -right-8 top-[10%] w-48 opacity-70 [mask-image:radial-gradient(closest-side,black_80%,transparent)] sm:right-[7%] sm:w-64 lg:w-72"
      />
      <img
        src={fintechOrb}
        alt=""
        aria-hidden="true"
        width={1024}
        height={1024}
        className="landing-float-c pointer-events-none absolute right-[10%] top-[2%] hidden w-40 opacity-60 [mask-image:radial-gradient(closest-side,black_75%,transparent)] md:block lg:w-52"
      />

      <div className="relative z-10 flex max-w-lg flex-col items-center text-center">
        <Logo size="lg" />

        <p className="mt-8 font-display text-2xl font-semibold leading-tight text-(--color-graphite) sm:text-3xl">
          AI-assisted chargeback recovery for Razorpay merchants
        </p>
        <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-graphite-muted">
          Revexa scores every dispute, drafts the evidence, and keeps a human in the loop before anything is
          submitted.
        </p>

        <Link
          to="/app"
          className="mt-10 inline-flex items-center justify-center rounded bg-cobalt-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_-12px_rgba(45,79,214,0.55)] transition-colors hover:bg-cobalt-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
}
