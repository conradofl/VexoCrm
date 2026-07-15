import { useSearchParams, useNavigate } from "react-router-dom";
import { PresentationViewer } from "@/components/presentation/PresentationViewer";

// Rota de PREVIEW temporária da Apresentação Comercial (só para testar layout e
// copy no localhost). Não persiste nada e não toca ProposalConfig.
//
// Params opcionais na URL:
//   ?empresa=Mestre dos Jogos&segmento=luderia&logo=https://...
// Sem params, cai no roteiro-padrão da Luderia (entretenimento_local).
export default function PresentationPreview() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const companyName = params.get("empresa") || "Mestre dos Jogos";
  const segmentId = params.get("segmento") || "luderia";
  const logoUrl = params.get("logo") || null;
  // ?proposta=/proposta/<id> — no preview cai numa demo se não informado.
  const proposalHref = params.get("proposta") || "/proposta/11b927f0-72ef-4708-a38d-0e1187c71564";

  return (
    <PresentationViewer
      companyName={companyName}
      segmentId={segmentId}
      logoUrl={logoUrl}
      proposalHref={proposalHref}
      onClose={() => navigate(-1)}
    />
  );
}
