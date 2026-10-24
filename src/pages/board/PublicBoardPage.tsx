import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { BoardSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProfilePhotosProvider } from "@/components/wedash/PersonAvatar";
import { calendarTodayIso } from "@/data/wedash/clock";
import { readBoardShare, type PublicBoardPack } from "@/data/wedash/boardShare";
import { effectiveWeekHours, parseWeekHours } from "@/data/wedash/storeHours";
import { BoardView } from "./BoardView";
import { useBoardTheme, type BoardTheme } from "./boardTheme";

const POLL_MS = 60 * 1000;

function BoardFrame({ theme, children }: { theme: BoardTheme; children: ReactNode }) {
  return (
    <div data-board-theme={theme} className="tela-cheia relative overflow-hidden bg-bg-0 text-t0">
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
        <div className="relative z-10 h-full overflow-hidden">
          <BoardSkeleton header className="h-full overflow-hidden p-3 sm:p-4" />
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
      <div className="relative z-10 h-full min-h-0 overflow-hidden">
      <ProfilePhotosProvider photos={pack.photos}>
        <BoardView
          stores={[
            {
              id: pack.store.id,
              tradeName: pack.store.tradeName,
              hours: effectiveWeekHours(parseWeekHours(pack.store.hours)),
              timeZone: pack.store.timezone,
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
        />
      </ProfilePhotosProvider>
      </div>
    </BoardFrame>
  );
}
