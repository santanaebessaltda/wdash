import { useContext, useEffect, useState, createContext, type ReactNode } from "react";
import { Avatar, AvatarGroup, type AvatarProps } from "@/components/ui";
import {
  fetchProfilePhotos,
  matchProfilePhoto,
  type PersonPhotoQuery,
  type ProfilePhotoRef,
} from "@/data/wedash/profilePhotos";
import { useSession } from "@/session/SessionProvider";

const ProfilePhotosContext = createContext<ProfilePhotoRef[]>([]);

/** Carrega as fotos da empresa uma vez. As telas leem daqui. `photos` trava a lista (placar público, sem sessão). */
export function ProfilePhotosProvider({ children, photos: fixed }: { children: ReactNode; photos?: ProfilePhotoRef[] }) {
  const { session } = useSession();
  const [loaded, setLoaded] = useState<ProfilePhotoRef[]>([]);
  const locked = fixed != null;
  useEffect(() => {
    if (locked) return;
    const tenantId = session?.tenantId;
    if (!tenantId) {
      setLoaded([]);
      return;
    }
    let cancel = false;
    void fetchProfilePhotos(tenantId).then((rows) => {
      if (!cancel) setLoaded(rows);
    });
    return () => {
      cancel = true;
    };
  }, [locked, session?.tenantId, session?.avatarUrl]);
  return <ProfilePhotosContext.Provider value={fixed ?? loaded}>{children}</ProfilePhotosContext.Provider>;
}

export function useProfilePhotos(): ProfilePhotoRef[] {
  return useContext(ProfilePhotosContext);
}

type PersonAvatarProps = Omit<AvatarProps, "src"> &
  PersonPhotoQuery & {
    /** Foto já conhecida (ex.: a lista de usuários). Sem ela, busca pelo cadastro. */
    src?: string | null;
  };

/** Avatar redondo: foto da conta WDash, ou as iniciais quando não há. */
export function PersonAvatar({
  name,
  src,
  size,
  status,
  className,
  ring,
  membershipId,
  employeeId,
  generatorId,
  storeId,
}: PersonAvatarProps) {
  const photos = useProfilePhotos();
  const looked = matchProfilePhoto(photos, { membershipId, employeeId, generatorId, storeId, name });
  return <Avatar name={name} src={src ?? looked} size={size} status={status} className={className} ring={ring} />;
}

/** Vários avatares, cada um com a própria foto. */
export function PersonAvatarGroup({
  people,
  max = 4,
}: {
  people: (PersonPhotoQuery & { name: string; src?: string | null })[];
  max?: number;
}) {
  const photos = useProfilePhotos();
  return (
    <AvatarGroup
      max={max}
      people={people.map((p) => ({
        name: p.name,
        src: p.src ?? matchProfilePhoto(photos, p),
      }))}
    />
  );
}
