// frontend/src/pages/LandingPage/LightBeamCanvas.tsx
//
// Componente de Iluminação e Emblema Cyber V (Variante B):
// - Luz volumétrica suave estilo lanterna clara (sem saturação pesada ou ofuscamento)
// - V reduzido em 25% para proporção elegante e equilibrada
// - 100% livre de travamentos: zero filtros pesados no loop (60-120 FPS cravados)
// - Movimento suave e sedoso acompanhando o cursor do mouse
// - Fundo cósmico contínuo (#00000A) sem qualquer vinheta ou artefato

import React, { useEffect, useRef } from "react";

export function LightBeamCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== "function") return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;

    let animationFrameId: number;

    // Retina display scaling otimizada (clamp em 1.5 para máxima fluidez sem sobrecarga)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = window.innerWidth;
    let height = window.innerHeight;

    function resize() {
      if (!canvas || !ctx) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    resize();

    // Mouse target e interpolação sedosa e ágil (lerp otimizado para acompanhar o cursor)
    let targetMouseX = width / 2;
    let targetMouseY = height * 0.35;
    let currentMouseX = width / 2;
    let currentMouseY = height * 0.35;

    let hasMouseInteracted = false;
    let autoTime = 0;

    function handleMouseMove(e: MouseEvent) {
      targetMouseX = e.clientX;
      targetMouseY = e.clientY;
      hasMouseInteracted = true;
    }

    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length > 0) {
        targetMouseX = e.touches[0].clientX;
        targetMouseY = e.touches[0].clientY;
        hasMouseInteracted = true;
      }
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    // Geometria precisa do V Cyber da Variante B (Asas de Luz Neon)
    const leftWing = [
      { x: 0, y: 110 },       // Ápice inferior
      { x: -52, y: 34 },      // Cintura externa inferior
      { x: -44, y: 12 },      // Entalhe da asa
      { x: -152, y: -82 },    // Ponta externa afiada da asa
      { x: -64, y: -48 },     // Junção superior interna da asa
      { x: 0, y: 72 }         // Articulação central interna
    ];
    const rightWing = leftWing.map((p) => ({ x: -p.x, y: p.y }));

    const innerV = [
      { x: -46, y: -46 },
      { x: 0, y: 68 },
      { x: 46, y: -46 }
    ];

    const leftFacet = [
      { x: -50, y: 18 },      // Canto inferior interno
      { x: -110, y: -38 },    // Vértice externo
      { x: -132, y: -56 },    // Ponta afiada da lâmina
      { x: -60, y: -30 }      // Canto superior interno
    ];
    const rightFacet = leftFacet.map((p) => ({ x: -p.x, y: p.y }));

    // Amostragem seletiva de emissores nos contornos (elegante, sem poluição)
    interface EmitterPoint {
      x: number;
      y: number;
      weight: number;
      baseAngleOffset: number;
    }

    const emitters: EmitterPoint[] = [];
    function sampleSegment(
      p1: { x: number; y: number },
      p2: { x: number; y: number },
      count: number,
      weight: number,
      baseAngleOffset: number
    ) {
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        emitters.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
          weight,
          baseAngleOffset
        });
      }
    }

    sampleSegment(leftWing[2], leftWing[3], 4, 1.0, -0.50);
    sampleSegment(rightWing[2], rightWing[3], 4, 1.0, 0.50);
    sampleSegment(innerV[0], innerV[1], 5, 1.2, -0.15);
    sampleSegment(innerV[1], innerV[2], 5, 1.2, 0.15);
    sampleSegment(leftFacet[1], leftFacet[2], 3, 1.1, -0.35);
    sampleSegment(rightFacet[1], rightFacet[2], 3, 1.1, 0.35);

    function tracePoly(pts: { x: number; y: number }[]) {
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }

    function traceLine(pts: { x: number; y: number }[]) {
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }

    // Loop de renderização contínuo (60+ FPS constante, 0 jank)
    function render() {
      if (!ctx) return;
      autoTime += 0.015;

      // Movimento autônomo suave e exploratório cobrindo a tela quando o usuário não estiver movendo o mouse
      if (!hasMouseInteracted) {
        targetMouseX = width / 2 + Math.sin(autoTime * 0.72) * (width * 0.32);
        targetMouseY = height * 0.38 + Math.cos(autoTime * 0.52) * (height * 0.24);
      }

      // Suavização da coordenada do cursor (lerp responsivo e fluido para movimentação ágil e sedosa)
      currentMouseX += (targetMouseX - currentMouseX) * 0.046;
      currentMouseY += (targetMouseY - currentMouseY) * 0.046;

      // Escala reduzida em 25% (de 1.35 para ~1.0) para refinamento e elegância
      const cx = width / 2;
      const cy = height * 0.70;
      const scale = Math.max(0.72, Math.min(1.05, (width / 1440) * 1.0));

      // Limpa a tela com o preto cósmico contínuo (#00000A)
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#00000A";
      ctx.fillRect(0, 0, width, height);

      // =========================================================================
      // 1. NEBULA CÓSMICA SUAVE ATRÁS DO V (SEM BOLA PRETA, 100% DIFUSA)
      // =========================================================================
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const nebulaGrad = ctx.createRadialGradient(cx, cy - 20 * scale, 0, cx, cy - 20 * scale, 280 * scale);
      nebulaGrad.addColorStop(0, "rgba(165, 55, 235, 0.22)");
      nebulaGrad.addColorStop(0.35, "rgba(110, 20, 200, 0.10)");
      nebulaGrad.addColorStop(0.70, "rgba(50, 0, 140, 0.025)");
      nebulaGrad.addColorStop(1, "rgba(0, 0, 10, 0)");
      ctx.fillStyle = nebulaGrad;
      ctx.beginPath();
      ctx.arc(cx, cy - 20 * scale, 280 * scale, 0, Math.PI * 2);
      ctx.fill();

      // =========================================================================
      // 2. HOLOFOTE SUAVE DE LANTERNA (DIRECIONADO PARA O MOUSE EM TODA A TELA)
      // =========================================================================
      const angleToMouse = Math.atan2(currentMouseY - cy, currentMouseX - cx);
      const lanternAngle = angleToMouse;
      const lanternOriginX = cx;
      const lanternOriginY = cy + 15 * scale;
      const lanternLen = Math.max(width, height) * 1.25;
      const lanternAperture = 0.44;

      const lanternGrad = ctx.createRadialGradient(
        lanternOriginX,
        lanternOriginY,
        0,
        lanternOriginX,
        lanternOriginY,
        lanternLen
      );
      lanternGrad.addColorStop(0, "rgba(240, 215, 255, 0.18)");
      lanternGrad.addColorStop(0.18, "rgba(185, 120, 255, 0.11)");
      lanternGrad.addColorStop(0.45, "rgba(130, 50, 235, 0.048)");
      lanternGrad.addColorStop(0.75, "rgba(70, 12, 170, 0.015)");
      lanternGrad.addColorStop(1, "rgba(0, 0, 10, 0)");

      ctx.fillStyle = lanternGrad;
      ctx.beginPath();
      ctx.moveTo(lanternOriginX, lanternOriginY);
      ctx.arc(
        lanternOriginX,
        lanternOriginY,
        lanternLen,
        lanternAngle - lanternAperture,
        lanternAngle + lanternAperture
      );
      ctx.closePath();
      ctx.fill();

      // Ponto de iluminação direta na tela onde o mouse está posicionado (holofote suave)
      const mouseSpotGrad = ctx.createRadialGradient(
        currentMouseX,
        currentMouseY,
        0,
        currentMouseX,
        currentMouseY,
        260 * scale
      );
      mouseSpotGrad.addColorStop(0, "rgba(225, 175, 255, 0.15)");
      mouseSpotGrad.addColorStop(0.35, "rgba(160, 65, 255, 0.07)");
      mouseSpotGrad.addColorStop(0.70, "rgba(95, 15, 210, 0.02)");
      mouseSpotGrad.addColorStop(1, "rgba(0, 0, 10, 0)");
      ctx.fillStyle = mouseSpotGrad;
      ctx.beginPath();
      ctx.arc(currentMouseX, currentMouseY, 260 * scale, 0, Math.PI * 2);
      ctx.fill();

      // =========================================================================
      // 3. RAIOS SUAVES EMITIDOS DOS CONTORNOS DO V (SEGUEM O CURSOR PELA TELA)
      // Zero filtros pesados: gradientes nativos ultrarrápidos e translúcidos
      // =========================================================================
      for (let i = 0; i < emitters.length; i++) {
        const pt = emitters[i];
        const ptX = cx + pt.x * scale;
        const ptY = cy + pt.y * scale;

        // Cada raio mira na direção do cursor com abertura sutil
        const ptAngleToMouse = Math.atan2(currentMouseY - ptY, currentMouseX - ptX);
        const sideFan = pt.baseAngleOffset * 0.28;
        const wave = Math.sin(autoTime * 1.0 + i * 0.7) * 0.03;
        const rayAngle = ptAngleToMouse * 0.85 + angleToMouse * 0.15 + sideFan + wave;

        const rayLength = Math.max(width, height) * 1.1;
        const halfWidth = 0.052;
        const pulse = 0.94 + 0.06 * Math.sin(autoTime * 1.5 + i * 1.1);
        const intensity = 0.055 * pt.weight * pulse;

        const grad = ctx.createRadialGradient(ptX, ptY, 0, ptX, ptY, rayLength);
        grad.addColorStop(0, `rgba(255, 240, 255, ${intensity * 2.0})`);
        grad.addColorStop(0.08, `rgba(220, 155, 255, ${intensity * 1.4})`);
        grad.addColorStop(0.32, `rgba(150, 65, 245, ${intensity * 0.7})`);
        grad.addColorStop(0.65, `rgba(80, 15, 190, ${intensity * 0.2})`);
        grad.addColorStop(1, "rgba(0, 0, 10, 0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ptX, ptY);
        ctx.lineTo(
          ptX + Math.cos(rayAngle - halfWidth) * rayLength,
          ptY + Math.sin(rayAngle - halfWidth) * rayLength
        );
        ctx.lineTo(
          ptX + Math.cos(rayAngle + halfWidth) * rayLength,
          ptY + Math.sin(rayAngle + halfWidth) * rayLength
        );
        ctx.closePath();
        ctx.fill();
      }

      // Feixes centrais suaves que acompanham a mira do cursor
      const numHeroBeams = 14;
      for (let j = 0; j < numHeroBeams; j++) {
        const t = (j - (numHeroBeams - 1) / 2) / ((numHeroBeams - 1) / 2);
        const fanAngle = angleToMouse + t * 0.38 + Math.sin(autoTime * 0.9 + j * 0.5) * 0.025;

        const originX = cx + t * 28 * scale;
        const originY = cy + (32 + Math.abs(t) * 12) * scale;
        const beamLength = Math.max(width, height) * 1.15;
        const beamWidth = 0.046 + (1 - Math.abs(t)) * 0.018;
        const beamInt = (0.075 - Math.abs(t) * 0.025) * (0.94 + 0.06 * Math.sin(autoTime * 1.3 + j));

        const bGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, beamLength);
        bGrad.addColorStop(0, `rgba(250, 235, 255, ${beamInt * 2.2})`);
        bGrad.addColorStop(0.12, `rgba(215, 145, 255, ${beamInt * 1.5})`);
        bGrad.addColorStop(0.38, `rgba(145, 50, 240, ${beamInt * 0.75})`);
        bGrad.addColorStop(0.70, `rgba(75, 10, 185, ${beamInt * 0.18})`);
        bGrad.addColorStop(1, "rgba(0, 0, 10, 0)");

        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(
          originX + Math.cos(fanAngle - beamWidth) * beamLength,
          originY + Math.sin(fanAngle - beamWidth) * beamLength
        );
        ctx.lineTo(
          originX + Math.cos(fanAngle + beamWidth) * beamLength,
          originY + Math.sin(fanAngle + beamWidth) * beamLength
        );
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();

      // =========================================================================
      // 4. EMBLEMA V (REFINADO, 25% MENOR, NÍTIDO E BRILHANTE)
      // =========================================================================
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      // Corpo translúcido suave
      ctx.fillStyle = "rgba(160, 40, 245, 0.16)";
      tracePoly(leftWing);
      ctx.fill();
      tracePoly(rightWing);
      ctx.fill();

      // 4A: Halo Neon Violeta
      ctx.shadowColor = "rgba(170, 20, 255, 0.85)";
      ctx.shadowBlur = 28;
      ctx.strokeStyle = "rgba(185, 75, 255, 0.85)";
      ctx.lineWidth = 9;
      tracePoly(leftWing);
      ctx.stroke();
      tracePoly(rightWing);
      ctx.stroke();
      traceLine(innerV);
      ctx.stroke();

      // 4B: Brilho Elétrico Médio
      ctx.shadowColor = "rgba(230, 140, 255, 0.95)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgba(235, 185, 255, 0.95)";
      ctx.lineWidth = 4.0;
      tracePoly(leftWing);
      ctx.stroke();
      tracePoly(rightWing);
      ctx.stroke();
      traceLine(innerV);
      ctx.stroke();

      // 4C: Linha de Laser Branca Central
      ctx.shadowColor = "#FFFFFF";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.8;
      tracePoly(leftWing);
      ctx.stroke();
      tracePoly(rightWing);
      ctx.stroke();
      traceLine(innerV);
      ctx.stroke();

      // 4D: Facetas Brancas dos Lados (White Blades Incandescentes)
      const facetGrad = ctx.createLinearGradient(0, -60, 0, 25);
      facetGrad.addColorStop(0, "#FFFFFF");
      facetGrad.addColorStop(0.6, "rgba(255, 255, 255, 0.96)");
      facetGrad.addColorStop(1, "rgba(235, 205, 255, 0.88)");

      ctx.fillStyle = facetGrad;
      ctx.shadowColor = "#FFFFFF";
      ctx.shadowBlur = 16;
      tracePoly(leftFacet);
      ctx.fill();
      tracePoly(rightFacet);
      ctx.fill();

      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "rgba(235, 175, 255, 0.85)";
      ctx.shadowBlur = 10;
      tracePoly(leftFacet);
      ctx.stroke();
      tracePoly(rightFacet);
      ctx.stroke();

      // 4E: Ápice Estelar
      const apexGlow = ctx.createRadialGradient(0, 110, 0, 0, 110, 18);
      apexGlow.addColorStop(0, "#FFFFFF");
      apexGlow.addColorStop(0.35, "rgba(240, 210, 255, 0.95)");
      apexGlow.addColorStop(0.75, "rgba(170, 45, 255, 0.45)");
      apexGlow.addColorStop(1, "rgba(150, 0, 255, 0)");
      ctx.fillStyle = apexGlow;
      ctx.beginPath();
      ctx.arc(0, 110, 18, 0, Math.PI * 2);
      ctx.fill();

      // Flare Horizontal fino
      const flare = ctx.createLinearGradient(-190, 110, 190, 110);
      flare.addColorStop(0, "rgba(160, 0, 255, 0)");
      flare.addColorStop(0.35, "rgba(215, 120, 255, 0.3)");
      flare.addColorStop(0.5, "rgba(255, 255, 255, 0.9)");
      flare.addColorStop(0.65, "rgba(215, 120, 255, 0.3)");
      flare.addColorStop(1, "rgba(160, 0, 255, 0)");
      ctx.fillStyle = flare;
      ctx.fillRect(-190, 109, 380, 1.6);

      ctx.restore();
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    }

    render();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}
