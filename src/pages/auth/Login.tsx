import { Link, useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { BrandMark } from "./authKit";

/** Split-screen login: marketing panel + sign-in form. Panel hides below lg. */
export function Login() {
  const navigate = useNavigate();
  const go = () => navigate(paths.dashboards.analytics);
  return (
    <div className="flex min-h-screen w-full bg-bg-0">
      {/* Marketing panel */}
      <div
        className="relative hidden flex-[1.05] flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(165deg,#1b1640,#0c0e15 70%)" }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-[340px] w-[340px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(124,92,255,.35),transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-10 h-[300px] w-[300px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(86,168,255,.22),transparent 70%)" }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <span className="text-[19px] font-extrabold tracking-tight text-white">
            Vela<span className="text-acc-2">.</span>
          </span>
        </div>
        <div className="relative max-w-[440px]">
          <h2 className="text-[38px] font-extrabold leading-[1.1] tracking-tight text-white">
            The analytics platform teams actually love.
          </h2>
          <p className="mt-[18px] text-[15px] leading-relaxed text-white/60">
            Track revenue, users and growth in one beautifully crafted workspace. Make decisions
            backed by data, not guesswork.
          </p>
        </div>
        <div
          className="relative max-w-[440px] rounded-2xl border border-white/10 p-5 backdrop-blur"
          style={{ background: "rgba(255,255,255,.05)" }}
        >
          <p className="mb-3.5 text-[14.5px] leading-relaxed text-white/85">
            "Vela replaced four separate tools for us. Our team finally has one source of truth —
            it's gorgeous and genuinely fast."
          </p>
          <div className="flex items-center gap-3">
            <span
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full text-[13px] font-bold text-white"
              style={{ background: "linear-gradient(135deg,#33d493,#56a8ff)" }}
            >
              AR
            </span>
            <div>
              <p className="text-[13px] font-bold text-white">Amara Reyes</p>
              <p className="text-[11.5px] text-white/55">VP Growth, Northwind</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[26px] font-extrabold tracking-tight text-t0">Welcome back</h1>
          <p className="mb-6 mt-2 text-sm text-t1">Sign in to continue to your workspace.</p>
          <div className="mb-5 flex gap-3">
            {["Google", "GitHub"].map((p) => (
              <button
                key={p}
                className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-xl border border-line bg-bg-2 text-[13px] font-semibold text-t0 transition-colors hover:bg-bg-3"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mb-5 flex items-center gap-3.5">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] font-semibold text-t2">OR</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <label className="mb-1.5 block text-xs font-semibold text-t1">Email address</label>
          <input
            type="email"
            defaultValue="dana@vela.io"
            className="mb-4 h-11 w-full rounded-xl border border-line bg-bg-inset px-3.5 text-[13.5px] text-t0 outline-none focus:border-acc"
          />
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-t1">Password</label>
            <Link to={paths.auth.forgotPassword} className="text-xs font-semibold text-acc">
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            defaultValue="password"
            className="mb-[18px] h-11 w-full rounded-xl border border-line bg-bg-inset px-3.5 text-[13.5px] text-t0 outline-none focus:border-acc"
          />
          <label className="mb-[22px] flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" defaultChecked />
            <span className="text-[13px] text-t1">Keep me signed in</span>
          </label>
          <button
            onClick={go}
            className="h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2"
            style={{ boxShadow: "0 10px 24px -10px var(--acc)" }}
          >
            Sign in
          </button>
          <p className="mt-[22px] text-center text-[13px] text-t1">
            Don't have an account?{" "}
            <Link to={paths.auth.register} className="font-bold text-acc">
              Sign up free
            </Link>
          </p>
          <p className="mt-[18px] text-center">
            <Link to={paths.dashboards.analytics} className="text-[12.5px] text-t2">
              ← Back to dashboard
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
