import { GoogleGenAI, Type, ThinkingLevel, Modality, GenerateContentResponse, VideoGenerationReferenceType } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY!;
const ai = new GoogleGenAI({ apiKey });

export const MODELS = {
  FLASH: "gemini-3-flash-preview",
  PRO: "gemini-3.1-pro-preview",
  LITE: "gemini-3.1-flash-lite-preview",
  IMAGE: "gemini-2.5-flash-image",
  TTS: "gemini-2.5-flash-preview-tts",
  VEO: "veo-3.1-lite-generate-preview",
};

export async function generateChatResponse(
  model: string,
  contents: any[],
  systemInstruction?: string,
  tools?: any[],
  thinkingLevel?: ThinkingLevel
) {
  const config: any = {
    systemInstruction,
    tools,
  };

  if (thinkingLevel) {
    config.thinkingConfig = { thinkingLevel };
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  return response;
}

export async function generateVideo(prompt: string, imageBase64?: string, aspectRatio: "16:9" | "9:16" = "16:9") {
  const config: any = {
    numberOfVideos: 1,
    resolution: '1080p',
    aspectRatio
  };

  const payload: any = {
    model: MODELS.VEO,
    prompt,
    config
  };

  if (imageBase64) {
    payload.image = {
      imageBytes: imageBase64,
      mimeType: 'image/png',
    };
  }

  let operation = await ai.models.generateVideos(payload);

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const response = await fetch(downloadLink!, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  });

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function textToSpeech(text: string, voice: string = 'Kore') {
  const response = await ai.models.generateContent({
    model: MODELS.TTS,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }
  return null;
}
