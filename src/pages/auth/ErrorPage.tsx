import { useNavigate, useParams } from "react-router-dom";
import { paths } from "@/router/paths";

const ERRORS: Record<string, { title: string; desc: string; cta: string }> = {
  "403": { title: "Access forbidden", desc: "You don't have permission to view this page. Contact your administrator if you think this is a mistake.", cta: "Back to dashboard" },
  "500": { title: "Internal server error", desc: "Something went wrong on our end. Our team has been notified and is looking into it.", cta: "Try again" },
  "503": { title: "Service unavailable", desc: "The service is temporarily overloaded or under maintenance. Please try again shortly.", cta: "Retry" },
};

/** Parametrized error page (403/500/503/...) driven by the :code route param. */
export function ErrorPage() {
  const { code = "500" } = useParams();
  const navigate = useNavigate();
  const e = ERRORS[code] ?? { title: "Something went wrong", desc: "An unexpected error occurred. Please try again or contact support.", cta: "Back to dashboard" };
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-bg-0 p-10 text-center">
      <p
        className="text-[120px] font-black leading-none tracking-tight"
        style={{
          background: "linear-gradient(135deg,var(--warn),var(--bad))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {code}
      </p>
      <h2 className="mb-2.5 mt-4 text-[26px] font-extrabold text-t0">{e.title}</h2>
      <p className="mb-7 max-w-[400px] text-[15px] leading-relaxed text-t2">{e.desc}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => navigate(paths.dashboards.analytics)}
          className="h-[46px] rounded-xl bg-acc px-6 text-sm font-bold text-white transition-colors hover:bg-acc-2"
          style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}
        >
          {e.cta}
        </button>
        <button className="h-[46px] rounded-xl border border-line bg-bg-2 px-6 text-sm font-semibold text-t0 transition-colors hover:bg-bg-3">
          Contact support
        </button>
      </div>
    </div>
  );
}
