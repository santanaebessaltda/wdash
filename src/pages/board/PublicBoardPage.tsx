import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BoardSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProfilePhotosProvider } from "@/components/wedash/PersonAvatar";
import { calendarTodayIso } from "@/data/wedash/clock";
import { readBoardShare, type PublicBoardPack } from "@/data/wedash/boardShare";
import { effectiveWeekHours, parseWeekHours } from "@/data/wedash/storeHours";
import { BoardView } from "./BoardView";

const POLL_MS = 60 * 1000;

export function PublicBoardPage() {
  const { token } = useParams();
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
      <div className="board-backdrop tela-cheia overflow-y-auto">
        <BoardSkeleton header className="min-h-full p-4 sm:p-6" />
      </div>
    );
  }

  if (status === "missing" || !pack) {
    return (
      <div className="board-backdrop tela-cheia flex items-center justify-center overflow-y-auto p-6 text-center">
        <p className="text-sm text-t2">Este placar não está disponível.</p>
      </div>
    );
  }

  const watermark = pack.watermark ? new Date(pack.watermark) : null;
  return (
    <div className="board-backdrop tela-cheia overflow-y-auto text-t0">
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
  );
}
