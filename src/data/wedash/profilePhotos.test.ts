import { describe, expect, it } from "vitest";
import { matchProfilePhoto, type ProfilePhotoRef } from "./profilePhotos";

const photos: ProfilePhotoRef[] = [
  {
    membershipId: "mem-ana",
    storeId: "loja-1",
    employeeId: 386,
    generatorId: 9001,
    nameKeys: ["ANA PAULA"],
    avatarUrl: "https://cdn.example/ana.jpg",
  },
  {
    membershipId: "mem-gestor",
    storeId: null,
    employeeId: null,
    generatorId: null,
    nameKeys: [],
    avatarUrl: "https://cdn.example/gestor.jpg",
  },
];

describe("matchProfilePhoto", () => {
  it("acha pelo vínculo, código, gerador ou nome", () => {
    expect(matchProfilePhoto(photos, { membershipId: "mem-gestor" })).toBe("https://cdn.example/gestor.jpg");
    expect(matchProfilePhoto(photos, { employeeId: 386 })).toBe("https://cdn.example/ana.jpg");
    expect(matchProfilePhoto(photos, { employeeId: "e:00386" })).toBe("https://cdn.example/ana.jpg");
    expect(matchProfilePhoto(photos, { employeeId: "00386" })).toBe("https://cdn.example/ana.jpg");
    expect(matchProfilePhoto(photos, { generatorId: 9001 })).toBe("https://cdn.example/ana.jpg");
    expect(matchProfilePhoto(photos, { employeeId: "n:ANA PAULA" })).toBe("https://cdn.example/ana.jpg");
    expect(matchProfilePhoto(photos, { name: "Ana Paula", storeId: "loja-1" })).toBe("https://cdn.example/ana.jpg");
  });

  it("sem correspondência fica sem URL", () => {
    expect(matchProfilePhoto(photos, { employeeId: "n:DORA", name: "Dora" })).toBeUndefined();
    expect(matchProfilePhoto(photos, { name: "Marcos Lima" })).toBeUndefined();
    expect(matchProfilePhoto([], { employeeId: 386 })).toBeUndefined();
  });
});
