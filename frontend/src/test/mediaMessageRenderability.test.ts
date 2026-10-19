import { describe, it, expect } from "vitest";
import { isDirectlyRenderableMediaUrl } from "@/components/MediaMessage";

describe("isDirectlyRenderableMediaUrl", () => {
  it("rejeita URLs vazias, nulas ou indefinidas", () => {
    expect(isDirectlyRenderableMediaUrl(null)).toBe(false);
    expect(isDirectlyRenderableMediaUrl(undefined)).toBe(false);
    expect(isDirectlyRenderableMediaUrl("")).toBe(false);
  });

  it("rejeita URLs criptografadas do WhatsApp (mmg.whatsapp.net)", () => {
    expect(
      isDirectlyRenderableMediaUrl(
        "https://mmg.whatsapp.net/v/t62.7118-24/12345678_encrypted_image.enc?ccb=11-4"
      )
    ).toBe(false);
    expect(isDirectlyRenderableMediaUrl("https://pps.whatsapp.net/v/t61/...")).toBe(false);
    expect(isDirectlyRenderableMediaUrl("http://media.whatsapp.net/sample")).toBe(false);
  });

  it("aceita data URLs (data:image/...)", () => {
    expect(isDirectlyRenderableMediaUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
    expect(isDirectlyRenderableMediaUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isDirectlyRenderableMediaUrl("data:image/webp;base64,UklGR=")).toBe(true);
  });

  it("aceita URLs HTTP/HTTPS públicas comuns (não-WhatsApp)", () => {
    expect(isDirectlyRenderableMediaUrl("https://storage.vexo.com/images/campanha.jpg")).toBe(true);
    expect(isDirectlyRenderableMediaUrl("http://cdn.exemplo.com/banner.png")).toBe(true);
  });

  it("aceita URLs relativas da API e blob URLs", () => {
    expect(isDirectlyRenderableMediaUrl("/api/whatsapp/media/123")).toBe(true);
    expect(isDirectlyRenderableMediaUrl("blob:http://localhost:5173/uuid-media")).toBe(true);
  });
});
