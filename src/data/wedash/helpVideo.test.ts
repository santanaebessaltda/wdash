import { describe, expect, it } from "vitest";
import {
  audienceOf,
  canManageHelp,
  filterHelpVideos,
  formatHelpDuration,
  formatWatchedLabel,
  hasHelpDraftError,
  helpDraftErrors,
  helpObjectPaths,
  helpVideoExtension,
  helpVideoFileError,
  helpWatchCount,
  helpWatchCountLabel,
  helpWatchLines,
  type HelpPerson,
  type HelpVideo,
  type HelpView,
} from "./helpVideo";

function video(partial: Partial<HelpVideo> = {}): HelpVideo {
  return {
    id: "v1",
    title: "Como ler a meta",
    description: "Passo a passo da barra",
    audiences: ["SELLER"],
    visible: true,
    storagePath: "t/v1/video",
    posterPath: null,
    durationSec: 195,
    mimeType: "video/mp4",
    createdAt: "2026-10-23T12:00:00.000Z",
    ...partial,
  };
}

describe("help video draft", () => {
  it("asks for a title, an audience and a file", () => {
    const errors = helpDraftErrors({ title: "  ", description: "", audiences: [], file: null, fileRequired: true });
    expect(errors.title).toBe("Informe o título.");
    expect(errors.audiences).toBe("Escolha quem pode ver o vídeo.");
    expect(errors.file).toBe("Escolha o vídeo.");
    expect(hasHelpDraftError(errors)).toBe(true);
  });

  it("accepts mp4, webm and mov up to 200 MB", () => {
    expect(helpVideoFileError({ name: "aula.mp4", type: "", size: 10 })).toBeNull();
    expect(helpVideoFileError({ name: "aula.mov", type: "video/quicktime", size: 10 })).toBeNull();
    expect(helpVideoFileError({ name: "aula.webm", type: "video/webm", size: 10 })).toBeNull();
    expect(helpVideoFileError({ name: "aula.pdf", type: "application/pdf", size: 10 })).toBe("Use um vídeo MP4, WEBM ou MOV.");
    expect(helpVideoFileError({ name: "aula.mp4", type: "video/mp4", size: 201 * 1024 * 1024 })).toBe("O vídeo passa de 200 MB.");
  });

  it("accepts a complete draft", () => {
    const errors = helpDraftErrors({
      title: "Fechamento",
      description: "",
      audiences: ["MANAGER"],
      file: { name: "caixa.mp4", type: "video/mp4", size: 1000 },
      fileRequired: true,
    });
    expect(hasHelpDraftError(errors)).toBe(false);
  });
});

describe("help library", () => {
  const rows = [
    video(),
    video({ id: "v2", title: "Royalties", description: "Percentual da marca", visible: false, audiences: ["OWNER"] }),
  ];

  it("lets only the gestor manage the library", () => {
    expect(canManageHelp("OWNER")).toBe(true);
    expect(canManageHelp("ADMIN_GLOBAL")).toBe(true);
    expect(canManageHelp("MANAGER")).toBe(false);
    expect(canManageHelp("SELLER")).toBe(false);
  });

  it("filters by visibility and by title or description", () => {
    expect(filterHelpVideos(rows, { query: "", filter: "hidden" }).map((item) => item.id)).toEqual(["v2"]);
    expect(filterHelpVideos(rows, { query: "barra", filter: "all" }).map((item) => item.id)).toEqual(["v1"]);
    expect(filterHelpVideos(rows, { query: "ROYALTIES", filter: "all" }).map((item) => item.id)).toEqual(["v2"]);
  });

  it("formats the duration like a player", () => {
    expect(formatHelpDuration(195)).toBe("3:15");
    expect(formatHelpDuration(810)).toBe("13:30");
    expect(formatHelpDuration(3723)).toBe("1:02:03");
    expect(formatHelpDuration(null)).toBeNull();
  });

  it("keeps the file under the tenant and the video id", () => {
    expect(helpObjectPaths("tenant", "video")).toEqual({
      video: "tenant/video/video.mp4",
      poster: "tenant/video/poster.jpg",
    });
    expect(helpVideoExtension("video/webm")).toBe("webm");
    expect(helpObjectPaths("tenant", "video", "video/quicktime").video).toBe("tenant/video/video.mov");
  });
});

describe("help watch list", () => {
  const people: HelpPerson[] = [
    { identityId: "a", name: "Ana", role: "SELLER" },
    { identityId: "b", name: "Bruno", role: "SELLER" },
    { identityId: "c", name: "Carla", role: "MANAGER" },
    { identityId: "d", name: "Davi", role: "ADMIN_GLOBAL" },
  ];
  const views: HelpView[] = [{ videoId: "v1", identityId: "b", watchedAt: "2026-10-23T18:00:00.000Z" }];

  it("counts only people in the video audience", () => {
    const lines = helpWatchLines(people, views, video({ audiences: ["SELLER"] }));
    expect(lines.map((line) => line.name)).toEqual(["Ana", "Bruno"]);
    expect(lines.find((line) => line.name === "Ana")?.watchedAt).toBeNull();
    expect(helpWatchCountLabel(helpWatchCount(lines))).toBe("1 de 2 viram");
  });

  it("treats the platform admin as a gestor", () => {
    expect(audienceOf("ADMIN_GLOBAL")).toBe("OWNER");
    const lines = helpWatchLines(people, [], video({ audiences: ["OWNER"] }));
    expect(lines.map((line) => line.name)).toEqual(["Davi"]);
    expect(helpWatchCountLabel(helpWatchCount(lines))).toBe("Ninguém viu");
  });

  it("says everyone watched when the audience is complete", () => {
    const lines = helpWatchLines(people, views, video({ id: "v1", audiences: ["SELLER"] })).map((line) =>
      line.identityId === "a" ? { ...line, watchedAt: "2026-10-23T18:01:00.000Z" } : line,
    );
    expect(helpWatchCountLabel(helpWatchCount(lines))).toBe("Todos viram");
  });

  it("uses the clock when the view was today and the date otherwise", () => {
    const now = new Date("2026-10-23T15:00:00.000Z");
    expect(formatWatchedLabel(new Date("2026-10-23T17:35:00.000Z"), now)).toBe("hoje às 14:35");
    expect(formatWatchedLabel(new Date("2026-10-22T21:40:00.000Z"), now)).toBe("em 22/10 às 18:40");
  });
});
