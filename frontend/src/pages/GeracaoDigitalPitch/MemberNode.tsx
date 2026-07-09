import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/geracaoDigital/helpers";
import type { TeamMember } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — antigo renderMemberNode, movimento puro.
interface MemberNodeProps {
  team: TeamMember[];
  memberId: string;
  size?: "sm" | "md" | "lg";
  onSelect: (member: TeamMember) => void;
}

export function MemberNode({ team, memberId, size = "md", onSelect }: MemberNodeProps) {
    const member = team.find((m) => m.id === memberId);
    if (!member) return null;

    const initials = getInitials(member.name);

    let cardSize = "";
    let avatarSize = "";
    let nameSize = "";
    let roleSize = "";
    let customBorder = "";

    if (size === "lg") {
      cardSize = "p-4 w-48 rounded-2xl shadow-lg";
      avatarSize = "h-9 w-9 text-xs";
      nameSize = "text-xs font-black mt-2";
      roleSize = "text-[9px]";
      customBorder = member.id === "caio"
        ? "border-violet-200 hover:border-violet-300 shadow-lg shadow-violet-500/5"
        : member.id === "aline"
        ? "border-indigo-200 hover:border-indigo-300 shadow-lg shadow-indigo-500/5"
        : "border-pink-200 hover:border-pink-300 shadow-lg shadow-pink-500/5";
    } else if (size === "md") {
      cardSize = "p-3 w-40 rounded-xl shadow-md";
      avatarSize = "h-8 w-8 text-xs";
      nameSize = "text-[10px] font-black mt-1.5";
      roleSize = "text-[8px]";
      customBorder = "border-slate-200 hover:border-indigo-200";
    } else {
      cardSize = "p-2 w-28 rounded-lg shadow-sm";
      avatarSize = "h-7 w-7 text-[9px]";
      nameSize = "text-[9px] font-bold mt-1";
      roleSize = "text-[7.5px]";
      customBorder = "border-slate-200 hover:border-indigo-200 bg-slate-50";
    }

    return (
      <div
        onClick={() => onSelect(member)}
        className={cn(
          "group cursor-pointer bg-white text-center transform hover:-translate-y-0.5 transition-all duration-300 relative z-10 border",
          customBorder,
          cardSize
        )}
      >
        <div className={cn(
          "rounded-full mx-auto bg-gradient-to-br flex items-center justify-center font-extrabold text-white shadow-sm",
          member.avatarColor,
          avatarSize
        )}>
          {initials}
        </div>
        <h4 className={cn("text-slate-800 transition-colors group-hover:text-indigo-600 truncate", nameSize)}>
          {member.name}
        </h4>
        <p className={cn("text-slate-500 uppercase font-mono tracking-wider font-semibold truncate", roleSize)}>
          {member.role}
        </p>
        {member.status && size === "lg" && member.id !== "aline" && member.id !== "raquel" && (
          <span className={cn(
            "inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full mt-1.5 font-semibold",
            member.status === "Online" && "bg-emerald-100 text-emerald-700",
            member.status === "Em Reunião" && "bg-amber-100 text-amber-700",
            member.status === "Focando em IA" && "bg-indigo-100 text-indigo-700",
            member.status === "Gravando" && "bg-rose-100 text-rose-700"
          )}>
            <span className={cn(
              "h-1 w-1 rounded-full",
              member.status === "Online" && "bg-emerald-500 animate-pulse",
              member.status === "Em Reunião" && "bg-amber-500 animate-ping",
              member.status === "Focando em IA" && "bg-indigo-500",
              member.status === "Gravando" && "bg-rose-500 animate-pulse"
            )} />
            {member.status}
          </span>
        )}
      </div>
    );
}
