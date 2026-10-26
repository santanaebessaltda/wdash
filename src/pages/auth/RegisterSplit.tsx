import { Link, useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";

const perks = [
  "Real-time analytics dashboards",
  "Unlimited team members",
  "Enterprise-grade security",
];

/** Alternate split-screen register (form left, perks hero right). */
export function RegisterSplit() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-screen w-full bg-bg-0 lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center px-6 py-12 sm:px-14">
        <div className="w-full max-w-[400px]">
          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-t0">Create your account</h1>
          <p className="mb-7 text-sm text-t2">Start your 14-day free trial. No credit card required.</p>
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <F label="First name" placeholder="Elena" />
              <F label="Last name" placeholder="Park" />
            </div>
            <F label="Work email" placeholder="you@company.com" />
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-t0">Password</span>
              <input type="password" placeholder="8+ characters" className="h-[46px] w-full rounded-xl border border-line bg-bg-inset px-[15px] text-sm text-t0 outline-none focus:border-acc" />
              <div className="mt-2 flex gap-1.5">
                <span className="h-1 flex-1 rounded-sm bg-ok" />
                <span className="h-1 flex-1 rounded-sm bg-ok" />
                <span className="h-1 flex-1 rounded-sm bg-warn" />
                <span className="h-1 flex-1 rounded-sm bg-bg-3" />
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-normal text-t1">
              <input type="checkbox" className="mt-0.5" />
              I agree to the <a href="#" className="font-semibold text-acc">Terms of Service</a> and{" "}
              <a href="#" className="font-semibold text-acc">Privacy Policy</a>
            </label>
            <button
              onClick={() => navigate(paths.dashboards.analytics)}
              className="h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2"
              style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}
            >
              Create account
            </button>
          </div>
          <p className="mt-[22px] text-center text-[13px] text-t2">
            Already have an account?{" "}
            <Link to={paths.auth.login} className="font-bold text-acc">Sign in</Link>
          </p>
        </div>
      </div>

      <div
        className="relative hidden flex-col justify-center overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(150deg,#0f2d54,#1b1650 55%,#14103a)" }}
      >
        <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 80%,rgba(86,168,255,.35),transparent 60%)" }} />
        <div className="relative">
          <h2 className="mb-6 text-[26px] font-extrabold leading-[1.3] tracking-tight text-white">
            Everything you need to
            <br />
            scale your business.
          </h2>
          <div className="flex flex-col gap-4">
            {perks.map((p) => (
              <div key={p} className="flex items-center gap-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px]" style={{ background: "rgba(255,255,255,.12)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                <span className="text-sm font-semibold text-white/90">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function F({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-bold text-t0">{label}</span>
      <input {...props} className="h-[46px] w-full rounded-xl border border-line bg-bg-inset px-[15px] text-sm text-t0 outline-none focus:border-acc" />
    </label>
  );
}
