import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Terminal, 
  FileArchive, 
  Image as ImageIcon, 
  Mic, 
  MicOff, 
  Send, 
  Trash2, 
  Sparkles, 
  Paperclip, 
  FileText, 
  ChevronRight, 
  Folder, 
  Code, 
  AlertTriangle, 
  Cpu, 
  Globe, 
  CheckCheck, 
  ChevronDown, 
  ListRestart,
  Activity,
  FileCode,
  Languages,
  Plus,
  X,
  RotateCcw
} from "lucide-react";
import JSZip from "jszip";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { ChatMessage, ZipFileEntry, ActiveTool, TranscribeMode } from "./types";

export default function App() {
  // General State
  const [activeTool, setActiveTool] = useState<ActiveTool>("chat");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Translation / Language Preferences
  const [targetReplyLang, setTargetReplyLang] = useState<string>("auto");

  // 1. Multimodal Attachment State (for Images)
  const [attachedImage, setAttachedImage] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 2. ZIP Archive Parsing State
  const [zipFiles, setZipFiles] = useState<ZipFileEntry[]>([]);
  const [zipName, setZipName] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<{ name: string; content: string } | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // 3. Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>("audio/webm");
  const [transcribeMode, setTranscribeMode] = useState<string>("report");
  const [recordingDuration, setRecordingDuration] = useState(0);

  // Audio Context & Nodes for Real-time Visualization
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<any | null>(null);

  // Audio Upload Ref
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // Chat container scroll anchor
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Audio transcribe presets
  const transcribeModes: TranscribeMode[] = [
    { id: "report", name: "Rapport Structuré", description: "Transcription intégrale, résumé analytique, points clés et matrice d'actions.", icon: "FileText" },
    { id: "summary", name: "Résumé Sommaire", description: "Vue condensée et synthèse de haut niveau.", icon: "Terminal" },
    { id: "code", name: "Notes de Code / Technique", description: "Extraction spécialisée de concepts, snippets ou revues techniques.", icon: "Code" }
  ];

  // Auto-scroll message feed
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isAiLoading]);

  // Audio recording timer counter
  useEffect(() => {
    if (isRecording) {
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setRecordingDuration(0);
    }
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [isRecording]);

  // Handle Drag & Drop Events generically across root
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      await processUploadedFile(file);
    }
  };

  // Dispatch processing based on detected MIME
  const processUploadedFile = async (file: File) => {
    setErrorMessage(null);
    const mime = file.type.toLowerCase();
    const name = file.name.toLowerCase();

    // 1. Image Drop
    if (mime.startsWith("image/")) {
      setActiveTool("image");
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(",");
        setAttachedImage({
          name: file.name,
          base64: result.substring(commaIdx + 1),
          mimeType: file.type || "image/png"
        });
      };
      reader.readAsDataURL(file);
    } 
    // 2. ZIP Archive Drop
    else if (name.endsWith(".zip") || mime === "application/zip" || mime === "application/x-zip-compressed") {
      setActiveTool("zip");
      await parseZipArchive(file);
    }
    // 3. Audio File Drop
    else if (mime.startsWith("audio/") || name.endsWith(".mp3") || name.endsWith(".wav") || name.endsWith(".m4a") || name.endsWith(".webm") || name.endsWith(".ogg")) {
      setActiveTool("audio");
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(",");
        setAudioBase64(result.substring(commaIdx + 1));
        setAudioMimeType(file.type || "audio/webm");
        setAudioBlob(file);
      };
      reader.readAsDataURL(file);
    } 
    // Fallback error
    else {
      setErrorMessage(`Le format du fichier "${file.name}" n'est pas directement pris en charge. Veuillez fournir une image (.png, .jpg), un package ZIP ou un fichier audio.`);
    }
  };

  // Convert files inside Browser via JSZip
  const parseZipArchive = async (file: File) => {
    setZipLoading(true);
    setZipName(file.name);
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const entries: ZipFileEntry[] = [];

      for (const [relativePath, zipEntry] of Object.entries(content.files)) {
        if (zipEntry.dir) {
          entries.push({
            name: zipEntry.name,
            path: relativePath,
            content: null,
            size: 0,
            isFolder: true,
            selectedForPrompt: false
          });
        } else {
          // Read readable text formats, skip binary media formats
          const isText = /\.(txt|md|js|ts|tsx|json|html|css|py|java|c|cpp|h|sh|yml|yaml|svg|xml)$/i.test(zipEntry.name);
          let fileData = "";
          if (isText) {
            fileData = await zipEntry.async("string");
          } else {
            fileData = `[Fichier binaire ou média - Non-visualisable directement : ${zipEntry.name}]`;
          }

          entries.push({
            name: zipEntry.name.split("/").pop() || zipEntry.name,
            path: relativePath,
            content: fileData,
            size: (zipEntry as any)._data?.uncompressedSize || 0,
            isFolder: false,
            selectedForPrompt: isText && fileData.length < 35000 // auto-select smaller text files for helpful model lookup
          });
        }
      }

      setZipFiles(entries);
      // Automatically select the first readable file to show in the code reader panel
      const firstReadable = entries.find(e => !e.isFolder && !e.content?.startsWith("[Fichier binaire"));
      if (firstReadable) {
        setSelectedFileContent({ name: firstReadable.path, content: firstReadable.content || "" });
      } else if (entries.length > 0) {
        // Just show the list
        setSelectedFileContent(null);
      }
    } catch (err: any) {
      setErrorMessage(`Erreur lors du dézippage de l'archive: ${err.message}`);
    } finally {
      setZipLoading(false);
    }
  };

  // Trigger Local Mic Capture
  const startRecording = async () => {
    setErrorMessage(null);
    setAudioBlob(null);
    setAudioBase64(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setIsRecording(true);

      // Web Audio API setup for visualizing actual wave oscillations!
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // Start drawing real frequency curves
      drawLiveWaveform();

      // Configure media recorder (supports native webm or wav)
      let options = { mimeType: "audio/webm" };
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        options = { mimeType: "audio/ogg" };
      }
      
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        setAudioMimeType(mime);
        const compiledBlob = new Blob(chunks, { type: mime });
        setAudioBlob(compiledBlob);

        // Convert recording to base64 for API transmission
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          const commaIdx = base64String.indexOf(",");
          setAudioBase64(base64String.substring(commaIdx + 1));
        };
        reader.readAsDataURL(compiledBlob);
      };

      recorder.start();
    } catch (err: any) {
      setErrorMessage(`Impossible d'accéder au microphone: ${err.message}. Veuillez vérifier les permissions d'AI Studio.`);
      setIsRecording(false);
    }
  };

  // Stop Capture & Tear down Web Audio
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);

    // Stop streams
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Stop canvas render
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  // Draw hardware visualizer wave to Canvas
  const drawLiveWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) return;
      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Clear dark blue/black background
      ctx.fillStyle = "#0c111d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw aesthetic futuristic spectrum bars
      const barWidth = (canvas.width / bufferLength) * 1.8;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const percent = dataArray[i] / 255;
        const height = percent * canvas.height * 0.95;

        // Custom neon cyan-blue visual scale
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - height);
        gradient.addColorStop(0, "#2563eb"); // deep blue
        gradient.addColorStop(0.5, "#3b82f6"); // neon blue
        gradient.addColorStop(1, "#60a5fa"); // light cyan blue

        ctx.fillStyle = gradient;
        // Center-aligned bar style
        ctx.fillRect(x, canvas.height - height, barWidth - 1, height);

        x += barWidth;
      }

      // Center visual audio line
      ctx.strokeStyle = "rgba(59, 130, 246, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
  };

  // Trigger Automatic Transcription API
  const handleTranscribeTranscription = async () => {
    if (!audioBase64) {
      setErrorMessage("Veuillez d'abord enregistrer un audio ou téléverser un fichier sonore.");
      return;
    }

    setIsAiLoading(true);
    setErrorMessage(null);

    // Create a user placeholder message
    const userMsgId = Date.now().toString();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      text: `[Audio Transcrit - Format : ${transcribeMode === "report" ? "Report" : transcribeMode === "summary" ? "Summary" : "Code notes"}]`,
      timestamp: new Date().toLocaleTimeString(),
      attachmentType: "audio",
      attachmentName: zipName || "Enregistrement direct"
    };

    setChatHistory((prev) => [...prev, userMsg]);

    try {
      const modeInstruction = 
        transcribeMode === "report" 
          ? "Rédige un rapport cyberpunk ultra-complet de l'enregistrement de manière hautement structurée." 
          : transcribeMode === "summary"
          ? "Procure une synthèse extrêmement rapide en quelques lignes de code/text."
          : "Fouille pour des aspects informatiques, techniques ou code et compile des notes de dev détaillées.";

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioData: audioBase64,
          mimeType: audioMimeType,
          instruction: `${modeInstruction} Langue préférée: ${targetReplyLang}`
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Une erreur est survenue lors de la communication serveur.");
      }

      // Post AI response with Markdown structured content
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "model",
        text: data.text || "Aucune transcription générée.",
        timestamp: new Date().toLocaleTimeString()
      };

      setChatHistory((prev) => [...prev, aiMsg]);
      // Clear current attachment states if parsed
      setAudioBlob(null);
      setAudioBase64(null);
    } catch (err: any) {
      setErrorMessage(err.message);
      // Post error state inside conversation
      setChatHistory((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "model",
          text: `🚨 **Inconnu Dark AI Error:** Impossible de transcrire cette piste audio. Référence technique : ${err.message}.`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Dispatch standard AI Prompt Question with selected ZIP files or visual base64
  const handleSendPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && !attachedImage && !getSelectedZipContextContent()) return;

    const userText = inputText;
    setInputText("");
    setIsAiLoading(true);
    setErrorMessage(null);

    // Collect attachments
    let fileToSend: { data: string; mimeType: string } | undefined = undefined;
    let attachmentType: "image" | "zip" | undefined = undefined;
    let attachmentName = "";

    // 1. Gather Image Attachment
    if (attachedImage) {
      fileToSend = {
        data: attachedImage.base64,
        mimeType: attachedImage.mimeType
      };
      attachmentType = "image";
      attachmentName = attachedImage.name;
    }

    // Prepare contextual message content (incorporating ZIP context if any is checked)
    const zipContext = getSelectedZipContextContent();
    let computedUserMessage = userText;
    
    if (zipContext) {
      computedUserMessage = 
        `[CONTEXT REPERTOIRE ZIP SUIVANT]:\n${zipContext}\n\n` + 
        `[QUESTION UTILISATEUR]: ${userText || "Analyse la structure des fichiers de cette archive ZIP et donne-moi une vue d'ensemble complète de son contenu."}`;
      attachmentType = "zip";
      attachmentName = zipName || "archive.zip";
    }

    // Append to Chat thread UI
    const userMsgId = Date.now().toString();
    const newUserMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      text: userText || "Analyse de fichiers archives transmise...",
      timestamp: new Date().toLocaleTimeString(),
      attachmentType,
      attachmentName
    };

    // Save previous chat context (excluding heavy attachment text to save model context limits)
    const trimmedHistory = chatHistory.slice(-10).map((h) => ({
      role: h.role,
      message: h.text.substring(0, 3000) // truncate context logically
    }));

    setChatHistory((prev) => [...prev, newUserMsg]);

    // Clear staging inputs
    setAttachedImage(null);

    try {
      const payload: any = {
        message: computedUserMessage,
        history: trimmedHistory
      };

      if (fileToSend) {
        payload.file = fileToSend;
      }

      // Inject custom user target language preferences (e.g. reply in French or English)
      if (targetReplyLang !== "auto") {
        payload.message += `\n\n(IMPORTANT: Please reply exclusively in the following language: ${targetReplyLang})`;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Une erreur est survenue avec le service d'Inconnu Dark AI.");
      }

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "model",
        text: data.text,
        timestamp: new Date().toLocaleTimeString()
      };

      setChatHistory((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      setErrorMessage(err.message);
      setChatHistory((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "model",
          text: `🚨 **Inconnu Dark AI Error:** Impossible de générer la réponse. Erreur ou clé invalide dans l'environnement. (${err.message})`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Compile selected files inside zip to inject directly as visual reference
  const getSelectedZipContextContent = (): string => {
    const selected = zipFiles.filter(z => z.selectedForPrompt && !z.isFolder && z.content);
    if (selected.length === 0) return "";

    return selected.map(file => {
      return `### FICHIER: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
    }).join("\n\n");
  };

  // Toggle zip source file inclusion in prompt
  const toggleZipFileSelection = (path: string) => {
    setZipFiles(prev => prev.map(f => {
      if (f.path === path) {
        return { ...f, selectedForPrompt: !f.selectedForPrompt };
      }
      return f;
    }));
  };

  // Reset entire conversation
  const handleClearHistory = () => {
    setChatHistory([]);
    setErrorMessage(null);
  };

  // Setup sample workspace data if empty on start
  useEffect(() => {
    setChatHistory([
      {
        id: "start-welcome",
        role: "model",
        text: "👋 **Bienvenue sur Inconnu AI**\n\nJe suis votre assistant pour vous aider à analyser vos fichiers, décoder vos archives ZIP, explorer du code et transcrire vos enregistrements de vive voix ou audio en toute simplicité.\n\n*   **Explorateur ZIP :** Déposez ou importez une archive pour inspecter ses documents et poser des questions dessus.\n*   **Analyse d'image :** Importez une capture d'écran, un croquis ou une illustration pour obtenir des explications claires.\n*   **Enregistrement & Dictaphone :** Enregistrez votre parole ou importez un extrait audio pour générer une transcription soignée.\n\nQuelle est votre demande aujourd'hui ?",
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  }, []);

  return (
    <div 
      className={`h-[100dvh] max-h-[100dvh] overflow-hidden text-[#e5e7eb] flex flex-col relative transition-all duration-300 ${isDraggingFile ? "bg-[#0b1329]" : "bg-[#030712]"}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Background Matrix/Cyber Ambient Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.06),transparent_45%)] pointer-events-none z-0" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.15)_50%)] pointer-events-none z-10 bg-[length:100%_4px]" />

      {/* DRAG AND DROP OVERLAY SCREEN */}
      <AnimatePresence>
        {isDraggingFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 bg-opacity-95 z-50 flex flex-col items-center justify-center border-4 border-dashed border-blue-500 m-4 rounded-xl"
          >
            <div className="text-center p-8 space-y-4">
              <div className="w-20 h-20 bg-blue-500/10 border border-blue-500/50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                <FileArchive className="w-10 h-10 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold font-sans text-blue-300">GLISSEZ-DÉPOSEZ VOTRE FICHIER ICI</h2>
              <p className="text-gray-400 font-sans max-w-md">
                Inconnu AI va automatiquement traiter votre archive ZIP, image numérique ou fichier audio.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CORE CYBER SYSTEM HEADER */}
      <header className="shrink-0 border-b border-gray-800/10 bg-[#080d16]/95 backdrop-blur-md px-5 py-3.5 z-30 flex flex-nowrap items-center justify-between">
        <h1 className="text-sm font-sans font-extrabold uppercase tracking-widest text-[#f3f4f6]">
          INCONNU DARK AI
        </h1>

        <button 
          type="button"
          onClick={handleClearHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-800/80 bg-gray-900/85 hover:bg-gray-850 text-gray-400 hover:text-white text-[11px] font-sans font-medium transition-colors"
          title="Nouvelle discussion"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Effacer</span>
        </button>
      </header>

      {/* DASTARDLY GLOBAL ERROR TOAST PANEL */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-red-950/80 border border-red-900/60 text-red-200 px-4 py-3 mx-4 mt-3 rounded-xl flex items-start gap-3 z-40 relative"
          >
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm font-sans">
              <span className="font-sans font-bold">Erreur : </span>
              {errorMessage}
            </div>
            <button 
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white font-sans text-xs cursor-pointer px-2"
            >
              Fermer
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CORE FRAME LAYOUT */}
      <div className="flex-1 w-full max-w-3xl mx-auto flex flex-col overflow-hidden min-h-0 relative px-4 md:px-6">
        
        {/* CHAT MESSAGES PANEL */}
        <div className="flex-1 overflow-y-auto pt-6 space-y-6 pr-1">
          <AnimatePresence initial={false}>
            {chatHistory.map((msg) => (
              <motion.div 
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                {/* Speaker Label */}
                <span className="text-[10px] font-sans text-gray-500 mb-1 px-1">
                  {msg.role === "user" ? `Vous • ${msg.timestamp}` : `Assistant • ${msg.timestamp}`}
                </span>

                {/* Message Bubble */}
                <div className={`p-3.5 sm:p-4 rounded-2xl text-sm select-text leading-relaxed shadow-sm ${msg.role === "user" ? "bg-blue-600 text-white rounded-tr-none" : "bg-[#182135] text-gray-200 rounded-tl-none border border-gray-800/40"}`}>
                  
                  {/* Render attachment bubble summary if any is parsed */}
                  {msg.attachmentType && (
                    <div className="flex items-center gap-2 p-2 mb-2 bg-black/40 rounded-xl border border-gray-800/50 font-sans text-[11px] text-blue-300">
                      {msg.attachmentType === "image" && <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      {msg.attachmentType === "zip" && <FileArchive className="w-3.5 h-3.5 text-amber-550 shrink-0" />}
                      {msg.attachmentType === "audio" && <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                      <span className="truncate">Donnée associée : {msg.attachmentName}</span>
                    </div>
                  )}

                  <div className="markdown-body">
                    <Markdown>{msg.text}</Markdown>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* AI THINKING STATUS PULSE */}
          {isAiLoading && (
            <div className="flex flex-col items-start max-w-[85%] mr-auto">
              <span className="text-[10px] font-sans text-gray-500 mb-1 px-1">L'assistant formule sa réponse...</span>
              <div className="bg-[#182135] border border-gray-800/40 p-3.5 rounded-2xl rounded-tl-none flex items-center gap-3">
                <div className="flex space-x-1.5">
                  <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce delay-100" />
                  <div className="w-2.5 h-2.5 bg-blue-400 rounded-full animate-bounce delay-200" />
                  <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce delay-300" />
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ACTIVE QUICK ATTACHMENTS STATE VIEWER */}
        <AnimatePresence>
          {(attachedImage || zipFiles.some(f => f.selectedForPrompt) || audioBase64) && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-[#182135] border border-gray-800/60 rounded-2xl p-2.5 mb-3 flex items-center justify-between gap-3 text-xs shrink-0"
            >
              <div className="flex items-center gap-2.5 truncate">
                {attachedImage && (
                  <div className="flex items-center gap-1.5 bg-emerald-950/40 text-emerald-300 border border-emerald-900/30 px-2 py-0.5 rounded-lg">
                    <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate text-[10px]">{attachedImage.name}</span>
                  </div>
                )}

                {zipFiles.some(f => f.selectedForPrompt) && (
                  <div className="flex items-center gap-1.5 bg-amber-950/40 text-amber-300 border border-amber-900/30 px-2 py-0.5 rounded-lg">
                    <FileArchive className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[10px]">
                      {zipFiles.filter(f => f.selectedForPrompt).length} fichiers ZIP cochés
                    </span>
                  </div>
                )}

                {audioBase64 && (
                  <div className="flex items-center gap-1.5 bg-cyan-950/40 text-cyan-300 border border-cyan-900/30 px-2 py-0.5 rounded-lg">
                    <Mic className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[10px]">Enregistrement inclus</span>
                  </div>
                )}
              </div>

              <button 
                onClick={() => {
                  setAttachedImage(null);
                  setAudioBase64(null);
                  setAudioBlob(null);
                  setZipFiles(prev => prev.map(f => ({ ...f, selectedForPrompt: false })));
                }}
                className="text-red-400 hover:text-red-300 text-[11px] font-sans font-semibold shrink-0 px-1"
              >
                Tout retirer
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* WORKBENCH DRAWERS (Sliding Sheets for ZIP Explorer, Vision, Audio Station) */}
        <AnimatePresence>
          {activeTool !== "chat" && (
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="mb-3 p-4 bg-[#0e1626] border border-gray-800 rounded-2xl max-h-[300px] overflow-y-auto flex flex-col shrink-0 shadow-xl"
            >
              {/* Tool Header with Close Action */}
              <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3 shrink-0">
                <span className="text-xs font-sans font-bold uppercase text-gray-400 tracking-wide">
                  {activeTool === "zip" && "📂 Explorateur de fichiers ZIP"}
                  {activeTool === "image" && "🖼️ Analyseur d'images"}
                  {activeTool === "audio" && "🎤 Dictaphone & Enregistrement"}
                </span>
                <button 
                  onClick={() => setActiveTool("chat")}
                  className="bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white px-2.5 py-1 rounded-lg text-[10px] font-sans font-semibold border border-gray-800 transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Masquer le volet
                </button>
              </div>

              {/* 1. ZIP REPOSITORY WORKSPACE */}
              {activeTool === "zip" && (
                <div className="flex flex-col h-full overflow-hidden">
                  {zipLoading ? (
                    <div className="py-8 flex flex-col items-center justify-center space-y-2">
                      <div className="w-6 h-6 rounded-full border-2 border-dashed border-blue-500 animate-spin" />
                      <p className="text-[10px] font-sans text-gray-400">Analyse de l'archive ZIP en cours...</p>
                    </div>
                  ) : zipFiles.length === 0 ? (
                    <div className="p-4 text-center border border-dashed border-gray-800 rounded-xl bg-gray-950/60 hover:bg-gray-900/60 transition-all flex flex-col items-center justify-center">
                      <input 
                        type="file" 
                        ref={zipInputRef} 
                        accept=".zip" 
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            parseZipArchive(e.target.files[0]);
                          }
                        }}
                        className="hidden" 
                      />
                      <FileArchive className="w-8 h-8 text-gray-600 mb-1" />
                      <p className="text-[11px] font-sans text-gray-300 font-bold mb-0.5">SÉLECTIONNER UNE ARCHIVE ZIP</p>
                      <p className="text-[10px] text-gray-500 mb-3">Pour en interroger les documents de code</p>
                      <button 
                        type="button"
                        onClick={() => zipInputRef.current?.click()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-sans rounded-lg font-bold"
                      >
                        Parcourir ZIP
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col space-y-2">
                      <div className="bg-[#0b101c] p-1.5 rounded-lg border border-gray-850 flex justify-between items-center text-[10px] shrink-0">
                        <span className="font-sans text-gray-300 truncate max-w-[180px]">📂 {zipName}</span>
                        <span className="font-sans text-gray-400">{zipFiles.filter(z => !z.isFolder).length} Fichiers</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[160px] overflow-hidden">
                        {/* Files list */}
                        <div className="border border-gray-850 bg-[#05080e] rounded-lg p-1.5 overflow-y-auto max-h-[140px] space-y-1">
                          {zipFiles.map((file) => (
                            <div 
                              key={file.path}
                              onClick={() => {
                                if (!file.isFolder && file.content) {
                                  setSelectedFileContent({ name: file.path, content: file.content });
                                }
                              }}
                              className={`group flex items-center justify-between p-1 rounded-lg text-[11px] font-sans cursor-pointer transition-colors ${file.isFolder ? "text-gray-500 pointer-events-none" : "hover:bg-gray-800"} ${selectedFileContent?.name === file.path ? "bg-blue-900/45 text-blue-200" : "text-gray-300"}`}
                            >
                              <span className="flex items-center gap-1 truncate max-w-[70%]">
                                {file.isFolder ? <Folder className="w-3 h-3 text-blue-500 shrink-0" /> : <FileText className="w-3 h-3 text-gray-500 shrink-0" />}
                                <span className="truncate">{file.name}</span>
                              </span>
                              {!file.isFolder && (
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleZipFileSelection(file.path);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[9px] border font-sans transition-colors ${file.selectedForPrompt ? "bg-blue-650/40 text-blue-300 border-blue-600/30" : "bg-transparent text-gray-500 border-gray-800 hover:text-gray-305"}`}
                                >
                                  {file.selectedForPrompt ? "Inclus" : "Exclure"}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Code preview window */}
                        <div className="border border-gray-850 bg-[#05080e] rounded-lg overflow-y-auto max-h-[140px] p-2 text-[10px] font-mono leading-relaxed text-gray-300">
                          {selectedFileContent ? (
                            <pre className="whitespace-pre-wrap select-text">{selectedFileContent.content}</pre>
                          ) : (
                            <div className="h-full flex items-center justify-center text-gray-500 text-[10px] text-center font-sans">
                              Sélectionnez un document à gauche pour en afficher l'aperçu.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 2. VISION SCAN OVERLAY */}
              {activeTool === "image" && (
                <div className="flex flex-col h-full">
                  {attachedImage ? (
                    <div className="space-y-2">
                      <div className="border border-gray-800 bg-black/40 rounded-xl p-2.5 flex items-center justify-center relative overflow-hidden group max-h-[120px]">
                        <img 
                          src={`data:${attachedImage.mimeType};base64,${attachedImage.base64}`} 
                          alt="Visualisation" 
                          referrerPolicy="no-referrer"
                          className="max-h-[100px] object-contain rounded-lg"
                        />
                      </div>
                      <div className="p-2 bg-[#0b101c] rounded-lg border border-gray-800 text-[11px] text-gray-300 font-sans text-center">
                        <span className="text-blue-400 font-semibold">Image prête. </span> Posez votre question ci-dessous pour formuler l'analyse.
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center border border-dashed border-gray-800 rounded-xl bg-gray-950/60 hover:bg-gray-900/60 transition-all flex flex-col items-center justify-center">
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        accept="image/*" 
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            processUploadedFile(e.target.files[0]);
                          }
                        }}
                        className="hidden" 
                      />
                      <ImageIcon className="w-8 h-8 text-gray-600 mb-1" />
                      <p className="text-[11px] font-sans text-gray-300 font-bold mb-0.5">ANALYSER UNE CAPTURE</p>
                      <p className="text-[10px] text-gray-500 mb-3">Glissez-déposez ou importez un document de croquis</p>
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-sans rounded-lg font-bold"
                      >
                        Parcourir les images
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 3. AUDIO TRANSCRIBER */}
              {activeTool === "audio" && (
                <div className="flex flex-col space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 shrink-0 animate-fadeIn">
                    {/* Wave visualizer graph */}
                    <div className="border border-gray-800 bg-[#070b14] rounded-xl p-2 flex flex-col justify-between h-[100px]">
                      <canvas ref={canvasRef} width={280} height={50} className="w-full h-[50px] rounded bg-black/10" />
                      <div className="flex items-center justify-between text-[10px] font-sans pt-1">
                        <span className="flex items-center gap-1">
                          {isRecording ? (
                            <>
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                              <span className="text-red-400 font-semibold text-[9px]">ENREGISTREMENT EN COURS</span>
                            </>
                          ) : audioBase64 ? (
                            <span className="text-emerald-400 font-semibold text-[9px]">AUDIO INTÉGRÉ</span>
                          ) : (
                            <span className="text-gray-500 text-[9px]">MICROPHONE PRÊT</span>
                          )}
                        </span>
                        <span className="text-gray-400 font-mono text-[9px]">{isRecording ? `${recordingDuration}s` : "00:00"}</span>
                      </div>
                    </div>

                    {/* Structuration preset choices */}
                    <div className="flex flex-col space-y-1 justify-center">
                      <span className="text-[9px] font-sans text-gray-400 uppercase font-semibold">Option de rendu</span>
                      <div className="grid grid-cols-1 gap-1">
                        {transcribeModes.map((mode) => (
                          <button 
                            key={mode.id}
                            type="button"
                            onClick={() => setTranscribeMode(mode.id)}
                            className={`p-1 rounded-lg text-left border font-sans text-[10px] transition-colors leading-none ${transcribeMode === mode.id ? "bg-emerald-950/20 border-emerald-500/80 text-emerald-250" : "bg-[#090d16] border-gray-800 text-gray-400 hover:border-gray-700"}`}
                          >
                            <span className="font-bold">{mode.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Mic toggles */}
                  <div className="flex gap-2 shrink-0">
                    {isRecording ? (
                      <button 
                        type="button"
                        onClick={stopRecording}
                        className="flex-1 py-1.5 bg-[#ef4444] hover:bg-red-600 text-white font-sans font-bold rounded-lg text-[11px] flex items-center justify-center gap-1"
                      >
                        <MicOff className="w-3.5 h-3.5" /> Arrêter
                      </button>
                    ) : (
                      <button 
                        type="button"
                        onClick={startRecording}
                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-bold rounded-lg text-[11px] flex items-center justify-center gap-1"
                      >
                        <Mic className="w-3.5 h-3.5" /> Déposer un mémo vocal
                      </button>
                    )}

                    <input 
                      type="file" 
                      ref={audioFileInputRef} 
                      accept="audio/*" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          processUploadedFile(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                    />

                    <button 
                      type="button"
                      onClick={() => audioFileInputRef.current?.click()}
                      className="px-3 bg-gray-900 border border-gray-800 hover:bg-gray-800 text-gray-300 rounded-lg font-sans text-[11px]"
                      title="Importer un fichier audio local"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Generate rapport action trigger */}
                  {audioBase64 && (
                    <button 
                      type="button"
                      onClick={handleTranscribeTranscription}
                      disabled={isAiLoading}
                      className="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-800 disabled:to-gray-900 text-white font-sans font-bold rounded-xl flex items-center justify-center gap-1.5 text-[11px] shrink-0"
                    >
                      {isAiLoading ? (
                        <>
                          <div className="w-3 h-3 border-2 border-dashed border-white rounded-full animate-spin" />
                          Analyse en cours...
                        </>
                      ) : (
                        <>
                          <Activity className="w-3.5 h-3.5" />
                          Transcrire l'audio et générer
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* INPUT FIXED AT THE BOTTOM WITH TRANSITIONS */}
        <div className="mt-auto shrink-0 pb-6 pt-2 bg-transparent z-20 relative">
          
          {/* MINI FLOATING MENU POPOVER */}
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 15, scale: 0.95 }}
                className="absolute bottom-20 left-1 bg-[#1e293b] border border-gray-800 rounded-2xl p-2 shadow-2xl flex flex-col space-y-1 z-50 w-52"
              >
                <p className="text-[10px] font-sans text-gray-400 font-semibold uppercase tracking-wider px-3 py-1 border-b border-gray-800/40 mb-1">
                  Ajouter un document
                </p>
                
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool("image");
                    setIsMenuOpen(false);
                    setTimeout(() => fileInputRef.current?.click(), 100);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 hover:text-white rounded-xl transition"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Analyse image</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTool("audio");
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 hover:text-white rounded-xl transition"
                >
                  <Mic className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Dictaphone</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTool("zip");
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 hover:text-white rounded-xl transition"
                >
                  <FileArchive className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>ZIP Finder</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSendPrompt} className="relative flex items-center gap-2">
            {/* THE "+" BUTTON TOGGLE */}
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className={`flex items-center justify-center w-11 h-11 rounded-full transition-all shrink-0 ${isMenuOpen ? "bg-red-500/10 text-red-500" : "bg-gray-900 border border-gray-805 text-gray-30 w-11 h-11 hover:bg-gray-800 hover:text-white"}`}
              title="Autres options d'intelligence"
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            </button>

            <div className="flex-1 relative rounded-2xl border border-gray-800 bg-gray-900 focus-within:border-blue-500/80 focus-within:bg-black/10 transition-all overflow-hidden flex items-center pr-2">
              
              {/* Active elements state indicator */}
              {(attachedImage || zipFiles.some(f => f.selectedForPrompt) || audioBase64) && (
                <div className="pl-3 py-1 cursor-pointer select-none flex gap-1 items-center shrink-0">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse animate-duration-1000" />
                </div>
              )}

              <input 
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  attachedImage 
                    ? "Demandez une analyse de cette image..." 
                    : zipFiles.some(f => f.selectedForPrompt)
                    ? "Posez une question sur les fichiers ZIP sélectionnés..."
                    : "Écrivez votre message..."
                }
                disabled={isAiLoading}
                className="flex-1 bg-transparent border-0 px-3.5 py-3 text-sm focus:ring-0 focus:outline-none focus:border-0 text-white placeholder-gray-500"
              />

              <button 
                type="submit"
                disabled={isAiLoading || (!inputText.trim() && !attachedImage && !zipFiles.some(f => f.selectedForPrompt))}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white p-2 ml-1 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 w-8 h-8"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

      </div>

      <footer className="shrink-0 border-t border-gray-900 bg-[#04060b]/95 py-2.5 text-center px-4 text-[10px] text-gray-500 flex flex-nowrap justify-between items-center z-10 gap-2 font-sans font-sans">
        <p>Inconnu AI • Votre assistant intelligent</p>
        <p className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
          Opérationnel
        </p>
      </footer>
    </div>
  );
}
