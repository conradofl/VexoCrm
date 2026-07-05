// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.
// getInitials estava duplicado (renderMemberNode + IIFE do Slide 1); unificado aqui.
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// ─── CHIME NOTIFICATION SOUND SIMULATION ──────────────────────────────────────
export function playChime(): void {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.12); // G5
      oscillator.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.24); // C6
      
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.45);
    } catch (e) {
      console.warn(e);
    }
}
