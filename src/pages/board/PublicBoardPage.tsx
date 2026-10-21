import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { BoardSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProfilePhotosProvider } from "@/components/wedash/PersonAvatar";
import { calendarTodayIso } from "@/data/wedash/clock";
import { readBoardShare, type PublicBoardPack } from "@/data/wedash/boardShare";
import { effectiveWeekHours, parseWeekHours } from "@/data/wedash/storeHours";
import { AccessHeroBackdrop } from "@/pages/access/AccessHeroBackdrop";
import { cn } from "@/lib/cn";
import { BoardView } from "./BoardView";
import { useBoardTheme, type BoardTheme } from "./boardTheme";

const POLL_MS = 60 * 1000;

function BoardFrame({ theme, children }: { theme: BoardTheme; children: ReactNode }) {
  const dark = theme === "dark";
  return (
    <div data-board-theme={theme} className={cn("tela-cheia relative overflow-hidden text-t0", dark ? "access-hero-scope" : "bg-bg-0")}>
      {dark ? <AccessHeroBackdrop /> : null}
      {children}
    </div>
  );
}

export function PublicBoardPage() {
  const { token } = useParams();
  const [boardTheme] = useBoardTheme();
  const [pack, setPack] = useState<PublicBoardPack | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!token) {
      setStatus("missing");
      return;
    }
    let cancel = false;
    const load = async () => {
      const next = await readBoardShare(token, calendarTodayIso());
      if (cancel) return;
      if (!next) {
        setStatus((current) => (current === "ready" ? "ready" : "missing"));
        return;
      }
      setPack(next);
      setStatus("ready");
    };
    void load();
    const tick = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(tick);
    };
  }, [token]);

  if (status === "loading") {
    return (
      <BoardFrame theme={boardTheme}>
        <div className="relative z-10 h-full overflow-y-auto">
          <BoardSkeleton header className="min-h-full p-4 sm:p-6" />
        </div>
      </BoardFrame>
    );
  }

  if (status === "missing" || !pack) {
    return (
      <BoardFrame theme={boardTheme}>
        <p className="relative z-10 flex h-full items-center justify-center p-6 text-center text-sm text-t2">Este placar não está disponível.</p>
      </BoardFrame>
    );
  }

  const watermark = pack.watermark ? new Date(pack.watermark) : null;
  return (
    <BoardFrame theme={boardTheme}>
      <div className="relative z-10 h-full overflow-y-auto">
      <ProfilePhotosProvider photos={pack.photos}>
        <BoardView
          stores={[
            {
              id: pack.store.id,
              tradeName: pack.store.tradeName,
              hours: effectiveWeekHours(parseWeekHours(pack.store.hours)),
            },
          ]}
          team={pack.team}
          goalsData={{
            goals: pack.goals,
            dayAggs: pack.goalDays,
            sellerAggs: pack.goalSellers,
            namedAggs: pack.namedSellers,
            team: pack.goalTeam,
          }}
          challengesData={{ challenges: pack.challenges, aggs: pack.challengeAggs }}
          watermark={Number.isNaN(watermark?.getTime() ?? 0) ? null : watermark}
          loading={false}
          packKey={pack.store.id}
          controls="public"
        />
      </ProfilePhotosProvider>
      </div>
    </BoardFrame>
  );
}
