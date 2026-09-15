import { describe, it, expect, vi } from "vitest";
import { describeStep, StepLike } from "@/lib/followup/describeStep";

describe("Followup Media and Overrides UI Helpers", () => {
  it("aceita campos de mídia em StepLike sem alterar a descrição de agendamento", () => {
    const stepWithMedia: StepLike = {
      trigger_type: "after_enrollment",
      trigger_value: 1,
      trigger_unit: "days",
      scheduled_time: "10:00",
      media_path: "followup-media/tenant-1/image-123.jpg",
      media_type: "image",
      media_mime: "image/jpeg",
      media_filename: "catalogo.jpg",
    };

    const desc = describeStep(stepWithMedia);
    expect(desc).toBe("1 dia depois da inscrição, às 10:00");
    expect(stepWithMedia.media_type).toBe("image");
    expect(stepWithMedia.media_filename).toBe("catalogo.jpg");
  });

  it("suporta tipos de mídia permitidos: image, document, audio, video", () => {
    const mediaTypes: Array<NonNullable<StepLike["media_type"]>> = [
      "image",
      "document",
      "audio",
      "video",
    ];

    mediaTypes.forEach((type) => {
      const step: StepLike = {
        trigger_type: "on_schedule",
        media_type: type,
        media_filename: `arquivo.${type === "document" ? "pdf" : type === "audio" ? "mp3" : type === "video" ? "mp4" : "png"}`,
      };
      expect(step.media_type).toBe(type);
    });
  });
});
