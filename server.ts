import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables in development
dotenv.config();

const app = express();
const PORT = 3000;

// Configure body parser with high limit for images, audios, and zip data
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy initializer for GoogleGenAI as recommended by guidelines to avoid crash if variable is missing on boot
let aiInstance: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not defined. Please configure it in your Secrets/Settings panel.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// Basic health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Chat / Multimodal analysis endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history, file } = req.body;
    const ai = getAIClient();

    // Map history to the format expected by the chat API if history is provided
    // Each history item is: { role: "user" | "model", message: string }
    // Or we can use straightforward model generateContent which is extremely robust.
    
    const parts: any[] = [];

    // System instruction for a warm, capable, and human-like persona
    const systemInstruction = 
      "You are Inconnu AI, an intelligent, empathetic, clear, and highly capable assistant. " +
      "You help users analyze source code repositories (transmitted via ZIP), interpret images/diagrams, and transcribe audio notes. " +
      "Your tone is polite, professional, warm, and highly clear. Speak like a helpful and talented colleague rather than a robotic machine. " +
      "Avoid computer-generated clichés, and explain concepts simply and beautifully. " +
      "LANGUAGE PROTOCOL: Automatically detect the language of the user's input and reply in that exact language. " +
      "If the user writes in French, always respond in natural and elegant French.";

    // If there is an inline file (image / audio / other attachment)
    if (file && file.data && file.mimeType) {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data, // base64 string
        },
      });
    }

    // Add current user prompt
    parts.push({ text: message || "Hello" });

    // Handle history by constructing appropriate content structures
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      history.forEach((h: any) => {
        contents.push({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.message }],
        });
      });
    }
    
    // Add the current interaction to the contents
    contents.push({
      role: "user",
      parts: parts,
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({
      success: true,
      text: response.text,
    });
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    let errorMessage = error.message || "An error occurred with Inconnu Dark AI.";
    
    // Check if the error is related to a leaked or blocked API key
    if (errorMessage.toLowerCase().includes("leaked") || errorMessage.toLowerCase().includes("api key") || (error.status && error.status === 403)) {
      errorMessage = "⚠️ **CLÉ API GEMINI SIGNALÉE COMME COMPROMISE (403 Forbidden)**\n\n" +
        "La clé `GEMINI_API_KEY` configurée dans votre espace de travail a été signalée comme compromise/divulguée par Google et a été révoquée par sécurité.\n\n" +
        "**Comment résoudre cela immédiatement :**\n" +
        "1. Rendez-vous au panneau **Secrets** (l'icône de clé 🔑 ou de paramètres en haut / sur le côté d'AI Studio).\n" +
        "2. Cliquez sur votre secret `GEMINI_API_KEY` et remplacez sa valeur par une **nouvelle clé API saine** générée depuis votre console de développement de Google AI Studio (https://aistudio.google.com/).\n" +
        "3. Enregistrez les modifications. L'application chargera automatiquement votre clé valide sans redémarrage nécessaire.";
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Audio Transcriber and Structurer endpoint
app.post("/api/transcribe", async (req, res) => {
  try {
    const { audioData, mimeType, instruction } = req.body;
    if (!audioData) {
      return res.status(400).json({ success: false, error: "Missing audio data." });
    }

    const ai = getAIClient();

    const audioPart = {
      inlineData: {
        mimeType: mimeType || "audio/webm",
        data: audioData, // base64 string
      },
    };

    const structureInstruction = 
      "You are the transcription assistant of Inconnu AI. " +
      "Your role is to transcribe the attached audio recording with high precision. " +
      "Structure your output in clear, readable Markdown with a natural, human touch. " +
      "Detect the language spoken in the audio and transcribe in that language, formatting headings based on that language. " +
      "Structure your response exactly as follows:\n\n" +
      "# 🎙️ Compte-rendu d'enregistrement\n" +
      "--- \n" +
      "### 🔍 Informations générales\n" +
      "- **Langue détectée :** [Identify the language with flag, e.g., Français 🇫🇷 or English 🇬🇧]\n" +
      "- **Niveau de clarté de l'audio :** [High, Medium, or Low with brief explanation]\n" +
      "- **Sujet principal :** [One sentence summary]\n" +
      "\n" +
      "### 📝 Transcription intégrale\n" +
      "> [Insert the complete, literal transcription here with paragraph breaks if needed.]\n" +
      "\n" +
      "### ⚡ Points clés à retenir\n" +
      "1. [First key takeaway]\n" +
      "2. [Second key takeaway]\n" +
      "\n" +
      "### 🎯 Actions à mener\n" +
      "- [ ] [Action item, or state 'Aucune action immédiate requise']\n" +
      "\n" +
      "Additional user instruction context (if any): " + (instruction || "None in particular");

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          audioPart,
          { text: structureInstruction }
        ]
      },
    });

    res.json({
      success: true,
      text: response.text,
    });
  } catch (error: any) {
    console.error("Gemini Transcription Error:", error);
    let errorMessage = error.message || "Could not complete the recording transcription.";

    // Check if the error is related to a leaked or blocked API key
    if (errorMessage.toLowerCase().includes("leaked") || errorMessage.toLowerCase().includes("api key") || (error.status && error.status === 403)) {
      errorMessage = "⚠️ **CLÉ API GEMINI SIGNALÉE COMME COMPROMISE (403 Forbidden)**\n\n" +
        "La clé `GEMINI_API_KEY` configurée dans votre espace de travail a été signalée comme compromise/divulguée par Google et a été révoquée par sécurité.\n\n" +
        "**Comment résoudre cela immédiatement :**\n" +
        "1. Rendez-vous au panneau **Secrets** (l'icône de clé 🔑 ou de paramètres en haut / sur le côté d'AI Studio).\n" +
        "2. Cliquez sur votre secret `GEMINI_API_KEY` et remplacez sa valeur par une **nouvelle clé API saine** générée depuis votre console de développement de Google AI Studio (https://aistudio.google.com/).\n" +
        "3. Enregistrez les modifications. L'application chargera automatiquement votre clé valide sans redémarrage nécessaire.";
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});


// -------------------------------------------------------------
// VITE OR STATIC SERVING MIDDLEWARES
// -------------------------------------------------------------
async function initializeServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Inconnu Dark AI] Server is online on http://localhost:${PORT}`);
  });
}

initializeServer().catch((err) => {
  console.error("Critical error starting Inconnu Dark AI Server:", err);
});
