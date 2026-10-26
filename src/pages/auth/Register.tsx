import { Link, useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { BrandMark } from "./authKit";

const authFeatures = [
  { emoji: "📊", title: "Live dashboards", desc: "Real-time metrics, always fresh" },
  { emoji: "⚡", title: "Blazing fast", desc: "Sub-second query engine" },
  { emoji: "🔒", title: "SOC 2 secure", desc: "Enterprise-grade by default" },
  { emoji: "🤝", title: "Unlimited seats", desc: "Invite your whole team" },
];

/** Centered registration form with a feature/testimonial panel (hidden below lg). */
export function Register() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-screen w-full bg-bg-0 lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center px-6 py-12 sm:px-14">
        <div className="w-full max-w-[400px]">
          <div className="mb-9 flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="text-xl font-extrabold text-t0">Vela</span>
          </div>
          <h1 className="mb-2 text-[30px] font-extrabold tracking-tight text-t0">Create your account</h1>
          <p className="mb-7 text-[15px] text-t2">Start your 14-day free trial. No credit card required.</p>
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" placeholder="Marcus" />
              <Field label="Last name" placeholder="Liu" />
            </div>
            <Field label={<>Work email <span className="text-bad">*</span></>} placeholder="marcus@company.com" />
            <Field label={<>Password <span className="text-bad">*</span></>} type="password" placeholder="Min. 8 characters" />
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-0.5" />
              <span className="text-[13px] text-t2">
                I agree to the <a className="text-acc" href="#">Terms</a> and <a className="text-acc" href="#">Privacy Policy</a>
              </span>
            </label>
            <button
              onClick={() => navigate(paths.dashboards.analytics)}
              className="h-12 w-full rounded-[13px] bg-acc text-[15px] font-bold text-white transition-colors hover:bg-acc-2"
              style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}
            >
              Create account →
            </button>
            <p className="text-center text-[13px] text-t2">
              Already have an account?{" "}
              <Link to={paths.auth.login} className="font-bold text-acc">Sign in</Link>
            </p>
          </div>
        </div>
      </div>

      <div
        className="relative hidden flex-col items-center justify-center overflow-hidden p-14 lg:flex"
        style={{ background: "linear-gradient(135deg,#12103a,#1b2060 50%,#0d2a50)" }}
      >
        <div className="absolute inset-0" style={{ background: "radial-gradient(60% 60% at 70% 30%,rgba(124,92,255,.3),transparent 70%)" }} />
        <div className="relative max-w-[400px] text-center">
          <div className="mb-8 grid grid-cols-2 gap-3.5">
            {authFeatures.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 p-[18px] text-left" style={{ background: "rgba(255,255,255,.06)" }}>
                <div className="mb-2 text-[22px]">{f.emoji}</div>
                <p className="text-[13px] font-bold text-white">{f.title}</p>
                <p className="mt-1 text-[11.5px] text-white/50">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[18px] border border-white/10 p-[22px] text-left" style={{ background: "rgba(255,255,255,.06)" }}>
            <p className="mb-3.5 text-[13.5px] italic leading-relaxed text-white/75">
              "Vela transformed how our team tracks analytics. Productivity up 40% in the first month."
            </p>
            <div className="flex items-center gap-3">
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg,#33d493,#56a8ff)" }}>EP</span>
              <div>
                <p className="text-[13px] font-bold text-white">Elena Park</p>
                <p className="mt-px text-[11px] text-white/50">VP Sales · Stripe</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-t1">{label}</span>
      <input
        {...props}
        className="h-11 w-full rounded-[11px] border border-line bg-bg-2 px-[13px] text-[13.5px] text-t0 outline-none focus:border-acc"
      />
    </label>
  );
}
