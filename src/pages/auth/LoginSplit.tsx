import { Link, useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { BrandMark } from "./authKit";

/** Alternate split-screen login (gradient hero left, compact form right). */
export function LoginSplit() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-screen w-full bg-bg-0 lg:grid-cols-2">
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(150deg,#14103a,#1b1650 45%,#0f2d54)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 75% 15%,rgba(124,92,255,.4),transparent 60%)" }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark size={38} />
          <span className="text-[17px] font-extrabold text-white">Vela</span>
        </div>
        <div className="relative">
          <h2 className="mb-3.5 text-[30px] font-extrabold leading-[1.25] tracking-tight text-white">
            Analytics that move
            <br />
            your business forward.
          </h2>
          <p className="max-w-[400px] text-[15px] leading-relaxed text-white/70">
            Join 12,000+ teams using Vela to track revenue, customers and growth in real time.
          </p>
        </div>
        <div className="relative flex gap-2">
          <span className="h-1 w-8 rounded-sm bg-white" />
          <span className="h-1 w-2.5 rounded-sm bg-white/40" />
          <span className="h-1 w-2.5 rounded-sm bg-white/40" />
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-6 py-12 sm:px-14">
        <div className="w-full max-w-[380px]">
          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-t0">Welcome back</h1>
          <p className="mb-7 text-sm text-t2">Sign in to your Vela account to continue.</p>
          <div className="flex flex-col gap-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-t0">Email</span>
              <input
                defaultValue="elena@stripe.com"
                className="h-[46px] w-full rounded-xl border border-line bg-bg-inset px-[15px] text-sm text-t0 outline-none focus:border-acc"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-t0">Password</span>
              <input
                type="password"
                defaultValue="password123"
                className="h-[46px] w-full rounded-xl border border-line bg-bg-inset px-[15px] text-sm text-t0 outline-none focus:border-acc"
              />
            </label>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-t1">
                <input type="checkbox" defaultChecked />
                Remember me
              </label>
              <Link to={paths.auth.forgotPassword} className="text-[12.5px] font-bold text-acc">
                Forgot password?
              </Link>
            </div>
            <button
              onClick={() => navigate(paths.dashboards.analytics)}
              className="mt-1 h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2"
              style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}
            >
              Sign in
            </button>
            <div className="my-1.5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11.5px] text-t2">OR</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <button className="flex h-[46px] w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-bg-2 text-[13.5px] font-semibold text-t0 transition-colors hover:bg-bg-3">
              <span className="h-[18px] w-[18px] rounded-full" style={{ background: "linear-gradient(135deg,#ea4335,#fbbc05)" }} />
              Continue with Google
            </button>
          </div>
          <p className="mt-[22px] text-center text-[13px] text-t2">
            Don't have an account?{" "}
            <Link to={paths.auth.register} className="font-bold text-acc">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
