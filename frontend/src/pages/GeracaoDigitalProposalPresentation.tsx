import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PresentationViewer } from "@/components/presentation/PresentationViewer";

// Apresentação da proposta — ABRE DIRETO.
//
// Fase 3 da refatoração: apresentação e proposta são a MESMA coisa. Antes era
// preciso ir para /crm/apresentacao-gd?proposalId=..., esperar a tela de setup
// carregar e ainda clicar em "Iniciar Apresentação (Tela Cheia)". Agora a rota
// carrega a proposta (nome + segmento + logo, que já vivem em gd_proposals) e
// renderiza o viewer imediatamente, sem passo intermediário.
//
// O roteiro é resolvido pelo NOME do segmento (resolveSegmentGroup casa por
// palavra-chave), então traduzimos o segment_id (UUID) para o nome.
export default function GeracaoDigitalProposalPresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  const [companyName, setCompanyName] = useState<string>("");
  const [segmentName, setSegmentName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
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

        setCompanyName(prop?.prospect_name || "Sua Empresa");
        setLogoUrl(prop?.prospect_logo || null);

        // segment_id -> nome do segmento (o roteiro é resolvido por nome).
        let nome: string | null = null;
        if (segRes.ok) {
          const segJson = await segRes.json();
          const list = Array.isArray(segJson?.data) ? segJson.data : [];
          nome = list.find((s: any) => s.id === prop?.segment_id)?.nome ?? null;
        }
        // Fallback: se o segment_id já for texto (base antiga), usa direto.
        if (!nome && typeof prop?.segment_id === "string" && !/^[0-9a-f-]{36}$/i.test(prop.segment_id)) {
          nome = prop.segment_id;
        }
        if (!cancelled) setSegmentName(nome);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Erro ao abrir a apresentação.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, isAuthenticated, clientId, getIdToken]);

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
          onClick={() => navigate("/crm/propostas-gd")}
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
      proposalHref={id ? `/proposta/${id}` : null}
      onClose={() => navigate("/crm/propostas-gd")}
    />
  );
}
