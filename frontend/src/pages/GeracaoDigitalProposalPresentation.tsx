import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PresentationViewer } from "@/components/presentation/PresentationViewer";
import { buildPitch } from "@/lib/presentation/pitchContent";
import { isVexoProposal } from "./GeracaoDigitalPublicProposal";

export function extractScopeFromProposal(prop: any): { gdItems: string[]; vexoItems: string[] } {
  const allItems = Array.isArray(prop?.itens) ? prop.itens : [];

  const gdItems: string[] = [];
  const vexoItems: string[] = [];

  // Se houver item de pacote GD no topo, inclui primeiro
  const pkgGdItem = allItems.find((it: any) => {
    const desc = String(it.descricao || it.nome || "").trim();
    return desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo");
  });
  if (pkgGdItem) {
    gdItems.push(pkgGdItem.descricao || pkgGdItem.nome);
  } else if (prop?.pacote_nome) {
    gdItems.push(`Pacote: ${prop.pacote_nome}`);
  }

  allItems.forEach((it: any) => {
    const desc = String(it.descricao || it.nome || "").trim();
    const cat = String(it.categoria || "").toLowerCase();
    if (!desc) return;

    // Ignora o cabeçalho do pacote já adicionado
    if (desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo")) return;

    const isVexo =
      cat === "vexo" ||
      desc.toLowerCase().includes("plano") ||
      desc.toLowerCase().includes("vexo") ||
      desc.toLowerCase().includes("chatbot");

    if (isVexo) {
      if (!vexoItems.includes(desc)) {
        vexoItems.push(desc);
      }
    } else {
      if (!gdItems.includes(desc)) {
        gdItems.push(desc);
      }
    }
  });

  if (vexoItems.length === 0) {
    vexoItems.push("Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up");
  }

  return { gdItems, vexoItems };
}

// Apresentação da proposta — ABRE DIRETO.
export default function GeracaoDigitalProposalPresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  const [proposal, setProposal] = useState<any>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [segmentName, setSegmentName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [customSlides, setCustomSlides] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;

    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const token = await getIdToken();
        const headers: HeadersInit = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const [propRes, segRes] = await Promise.all([
          fetchApi(`/api/gd/proposals/${id}?client_id=${clientId || ""}`, { headers }),
          fetchApi(`/api/gd/segments?client_id=${clientId || ""}`, { headers }),
        ]);

        if (!propRes.ok) throw new Error("Não foi possível carregar a proposta.");
        const propJson = await propRes.json();
        const prop = propJson?.data || propJson;
        if (cancelled) return;

        // segment_id -> nome do segmento (o roteiro é resolvido por nome).
        let nome: string | null = null;
        if (segRes.ok) {
          const segJson = await segRes.json();
          const list = Array.isArray(segJson?.data) ? segJson.data : [];
          nome = list.find((s: any) => s.id === prop?.segment_id)?.nome ?? null;
        }
        // Fallback: se o segment_id já for texto (base antiga ou customizada), usa direto.
        if (!nome && typeof prop?.segment_id === "string" && !/^[0-9a-f-]{36}$/i.test(prop.segment_id)) {
          nome = prop.segment_id;
        }
        if (!nome && prop?.custom_segment_name) {
          nome = prop.custom_segment_name;
        }
        if (prop?.segment_id === "cafeteria") {
          nome = "Cafeterias, Bistrôs & Cafés Especiais";
        } else if (prop?.segment_id === "turismo") {
          nome = "Agências de Turismo & Viagens";
        }

        const { gdItems, vexoItems } = extractScopeFromProposal(prop);

        let slidesToUse: any[] | null = Array.isArray(prop?.presentation_slides) && prop.presentation_slides.length > 0
          ? JSON.parse(JSON.stringify(prop.presentation_slides))
          : null;

        if (!slidesToUse) {
          const { slides: defaultSlides } = buildPitch({
            companyName: prop?.prospect_name || "Sua Empresa",
            segmentId: nome,
          });
          slidesToUse = JSON.parse(JSON.stringify(defaultSlides));
        }

        if (Array.isArray(slidesToUse) && slidesToUse.length > 0) {
          slidesToUse = slidesToUse.map((s: any) => {
            let updated = { ...s };
            if (s.kind === "partnership" || s.id === 5) {
              updated = {
                ...updated,
                fronts: [
                  {
                    label: "Geração Digital",
                    tag: "Atração & Posicionamento",
                    items: gdItems.length > 0 ? gdItems : (s.fronts?.[0]?.items || ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"]),
                  },
                  {
                    label: "Vexo Atendimento",
                    tag: "IA & Automação Comercial",
                    items: vexoItems.length > 0 ? vexoItems : (s.fronts?.[1]?.items || ["Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up"]),
                  },
                ],
              };
            }
            if (prop?.esconder_valores === true) {
              if (
                updated.metric &&
                typeof updated.metric.value === "string" &&
                (updated.metric.value.includes("R$") || updated.kind === "close" || updated.kind === "pricing")
              ) {
                updated.metric = {
                  ...updated.metric,
                  value: "Sob Consulta",
                  caption: updated.metric.caption || "Condições especiais personalizadas",
                };
              }
            }
            return updated;
          });
        }

        setProposal(prop);
        setCompanyName(prop?.prospect_name || "Sua Empresa");
        setLogoUrl(prop?.prospect_logo || null);
        setCustomSlides(slidesToUse);
        if (!cancelled) setSegmentName(nome);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Erro ao abrir a apresentação.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, isAuthenticated, clientId, getIdToken]);

  const handleClosePresentation = () => {
    const isVexo = proposal?.owner_company === "vexo" || Boolean(proposal?.package_vexo_id);
    const targetUrl = isVexo
      ? `/crm/comercial-vexo?tab=propostas&proposta=${proposal?.id || id || ""}`
      : `/crm/propostas-gd?proposta=${proposal?.id || id || ""}`;
    navigate(targetUrl);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-300 text-sm">
        Abrindo apresentação…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={handleClosePresentation}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
        >
          Voltar às propostas
        </button>
      </div>
    );
  }

  return (
    <PresentationViewer
      companyName={companyName}
      segmentId={segmentName}
      logoUrl={logoUrl}
      customSlides={customSlides}
      proposalHref={id ? `/proposta/${id}` : null}
      onClose={handleClosePresentation}
    />
  );
}
