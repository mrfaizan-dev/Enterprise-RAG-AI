'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { marked } from 'marked';
import {
  FiUploadCloud,
  FiSend,
  FiFileText,
  FiCheckCircle,
  FiAlertCircle,
  FiClock,
  FiZap,
  FiRefreshCw,
  FiUser,
  FiCpu,
  FiShield,
  FiBookmark,
  FiServer
} from 'react-icons/fi';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8800';

export default function Home() {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'ai',
      text: 'Welcome to RAGI Enterprise AI. Please upload your document (.pdf, .txt, .csv) to begin intelligent document Q&A with exact page citations and hybrid retrieval.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      citations: []
    },
  ]);
  const [question, setQuestion] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  
  const [isUploading, setIsUploading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  
  const [useCelery, setUseCelery] = useState(false);
  const [taskState, setTaskState] = useState('');

  const chatContainerRef = useRef(null);
  const canvasRef = useRef(null);

  // Load Session ID & Initialize Spiderweb Canvas Animation
  useEffect(() => {
    const savedSession = localStorage.getItem('ragi_session_id');
    if (savedSession) {
      setSessionId(savedSession);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const mouse = { x: width / 2, y: height / 2, radius: 180 };
    const handleMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Create particles for spiderweb net effect (Enhanced count & visibility)
    const particleCount = Math.min(Math.floor((width * height) / 10000), 110);
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1.4,
        vy: (Math.random() - 0.5) * 1.4,
        radius: Math.random() * 2.2 + 1.2,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Update and draw particles & web connections
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        // Enhanced visibility with brighter cyan & neon glow
        ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(6, 182, 212, 0.8)';
        ctx.fill();
        ctx.shadowBlur = 0; // reset shadow

        // Connect particles to each other (Spiderweb net effect)
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 140) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(34, 211, 238, ${0.32 * (1 - dist / 140)})`;
            ctx.lineWidth = 1.1;
            ctx.stroke();
          }
        }

        // Connect particles to mouse position (Interactive web pull)
        const mdx = p.x - mouse.x;
        const mdy = p.y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

        if (mdist < mouse.radius) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(192, 132, 252, ${0.5 * (1 - mdist / mouse.radius)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isThinking]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadStatus(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus({ type: 'error', message: 'Please select a document file first.' });
      return;
    }

    setIsUploading(true);
    setUploadStatus({ type: 'info', message: '⏳ Processing document and generating vector embeddings...' });

    const formData = new FormData();
    formData.append('file', selectedFile);

    let url = `${API_BASE}/upload_document`;
    if (sessionId) {
      url += `?my_session_id=${encodeURIComponent(sessionId)}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        const newSession = data.session_id;
        setSessionId(newSession);
        localStorage.setItem('ragi_session_id', newSession);
        
        setUploadStatus({
          type: 'success',
          message: `✅ ${data.message} (${data.total_chunks} Chunks, ${data.processing_time_seconds}s)`,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            sender: 'ai',
            text: `✅ Document successfully indexed! You can now ask any detailed questions regarding this file.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            citations: []
          },
        ]);
        setSelectedFile(null);
      } else {
        setUploadStatus({
          type: 'error',
          message: data.detail || 'Document upload failed.',
        });
      }
    } catch (err) {
      console.error(err);
      setUploadStatus({
        type: 'error',
        message: 'Could not connect to backend server on port 8800.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const pollTaskStatus = async (taskId) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/task_status/${taskId}`);
        const data = await res.json();

        if (data.Status && data.Status.includes('Completed')) {
          clearInterval(interval);
          setTaskState('');
          setIsThinking(false);

          const aiAnswer = data.Result?.result || 'Task completed successfully.';
          const citations = data.Result?.citations || [];
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              sender: 'ai',
              text: aiAnswer,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              citations: citations
            },
          ]);
        } else if (data.Status === 'Failed') {
          clearInterval(interval);
          setTaskState('');
          setIsThinking(false);

          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              sender: 'ai',
              text: `❌ Background Task Failed: ${data.Error || 'Unknown Error'}`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              citations: []
            },
          ]);
        } else {
          setTaskState(`Queue Status: ${data.Status}`);
        }
      } catch (error) {
        console.error('Polling Error:', error);
      }
    }, 2000);
  };

  const handleSendQuestion = async (e) => {
    e?.preventDefault();
    if (!question.trim()) return;

    if (!sessionId) {
      alert('Please upload a document first to generate a valid session ID!');
      return;
    }

    const userText = question.trim();
    const newMsgId = Date.now().toString();

    setMessages((prev) => [
      ...prev,
      {
        id: newMsgId,
        sender: 'user',
        text: userText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citations: []
      },
    ]);

    setQuestion('');
    setIsThinking(true);

    try {
      if (useCelery) {
        const url = `${API_BASE}/ai_res_background?question=${encodeURIComponent(userText)}&my_session_id=${encodeURIComponent(sessionId)}`;
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.Task_ID) {
          setTaskState('Dispatched to Celery Queue...');
          pollTaskStatus(data.Task_ID);
        } else {
          setIsThinking(false);
          alert(data.detail || 'Failed to dispatch background task.');
        }
      } else {
        const url = `${API_BASE}/ai_res?question=${encodeURIComponent(userText)}&my_session_id=${encodeURIComponent(sessionId)}`;
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();

        setIsThinking(false);
        if (res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              sender: 'ai',
              text: data.answer || 'No response generated.',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              citations: data.citations || []
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              sender: 'ai',
              text: `❌ Error: ${data.detail || 'Backend processing error'}`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              citations: []
            },
          ]);
        }
      }
    } catch (err) {
      console.error(err);
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          sender: 'ai',
          text: '❌ Server disconnected. Please ensure the backend server is running on port 8800.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citations: []
        },
      ]);
    }
  };

  const handleNewSession = () => {
    localStorage.removeItem('ragi_session_id');
    setSessionId('');
    setMessages([
      {
        id: 'welcome',
        sender: 'ai',
        text: 'New session started. Please upload a document to begin.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citations: []
      },
    ]);
    setUploadStatus(null);
  };

  return (
    <div className="relative min-h-screen w-full bg-[#010409] text-slate-100 font-sans overflow-x-hidden flex flex-col justify-between selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Interactive Spiderweb Canvas Background (Fixed z-0 and glowing color) */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-0 opacity-80"
      />

      {/* Expanded Container Size & Enhanced Glassmorphism styling */}
      <div className="relative z-10 max-w-[92vw] w-full mx-auto my-6 md:my-8 flex-1 flex flex-col rounded-3xl border border-cyan-500/40 bg-slate-950/75 backdrop-blur-xl shadow-[0_0_80px_rgba(6,182,212,0.15)] overflow-hidden min-h-[88vh]">
        
        {/* Header */}
        <header className="px-6 py-5 border-b border-slate-800/80 bg-slate-950/90 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 w-full md:w-auto">
            <motion.div
              whileHover={{ scale: 1.08, rotate: 6 }}
              className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-400 via-indigo-500 to-purple-600 p-[1px] shadow-lg shadow-cyan-500/30"
            >
              <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center text-cyan-400">
                <FiShield className="w-6 h-6 animate-pulse" />
              </div>
            </motion.div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-300 via-indigo-200 to-purple-300 bg-clip-text text-transparent tracking-wide">
                  RAGI Enterprise AI
                </h1>
                <span className="px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-sm">
                  Pro Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 font-medium">
                <span>Active Session:</span>
                <code className="text-cyan-300 font-mono bg-slate-900/90 px-2 py-0.5 rounded text-[11px] border border-slate-800">
                  {sessionId ? `${sessionId.slice(0, 10)}...` : 'Not Initialized'}
                </code>
                {sessionId && (
                  <button
                    onClick={handleNewSession}
                    title="Reset Session"
                    className="text-slate-400 hover:text-rose-400 transition"
                  >
                    <FiRefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 w-full md:w-auto">
            <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setUseCelery(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  !useCelery
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FiZap className="w-3.5 h-3.5" /> Fast Sync
              </button>
              <button
                onClick={() => setUseCelery(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  useCelery
                    ? 'bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FiServer className="w-3.5 h-3.5" /> Queue Worker
              </button>
            </div>

            <div className="flex items-center gap-2 bg-slate-900/95 border border-slate-800 rounded-xl p-1.5 pl-3 shadow-inner">
              <label className="cursor-pointer flex items-center gap-2 text-xs text-slate-300 hover:text-cyan-300 transition">
                <FiFileText className="text-cyan-400 w-4 h-4" />
                <span className="max-w-[140px] truncate font-medium">
                  {selectedFile ? selectedFile.name : 'Upload Document (.pdf, .txt, .csv)'}
                </span>
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.txt,.csv"
                  className="hidden"
                />
              </label>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleUpload}
                disabled={isUploading || !selectedFile}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/20 disabled:opacity-50 transition"
              >
                {isUploading ? (
                  <>
                    <FiRefreshCw className="animate-spin w-3.5 h-3.5" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <FiUploadCloud className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </header>

        {/* Status Alert Banner */}
        <AnimatePresence>
          {uploadStatus && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className={`px-6 py-2.5 text-xs font-medium flex items-center gap-2 border-b ${
                uploadStatus.type === 'error'
                  ? 'bg-rose-950/50 border-rose-800/50 text-rose-300'
                  : uploadStatus.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-800/50 text-emerald-300'
                  : 'bg-cyan-950/50 border-cyan-800/50 text-cyan-300'
              }`}
            >
              {uploadStatus.type === 'error' && <FiAlertCircle className="w-4 h-4 shrink-0" />}
              {uploadStatus.type === 'success' && <FiCheckCircle className="w-4 h-4 shrink-0" />}
              {uploadStatus.type === 'info' && <FiClock className="animate-spin w-4 h-4 shrink-0" />}
              <span>{uploadStatus.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Stream Area */}
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 min-h-[50vh]"
        >
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex items-start gap-3.5 max-w-5xl ${
                msg.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto w-full'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border shadow-md ${
                  msg.sender === 'user'
                    ? 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300'
                    : 'bg-cyan-600/20 border-cyan-500/30 text-cyan-300'
                }`}
              >
                {msg.sender === 'user' ? <FiUser className="w-5 h-5" /> : <FiCpu className="w-5 h-5" />}
              </div>

              <div className="flex flex-col gap-2.5 max-w-[88%]">
                <div
                  className={`px-5 py-4 rounded-2xl text-sm leading-relaxed font-normal shadow-md ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-none shadow-indigo-500/10'
                      : 'bg-slate-900/90 border border-slate-800 text-slate-100 rounded-tl-none shadow-black/40'
                  }`}
                >
                  {msg.sender === 'ai' ? (
                    <div 
                      className="markdown-body tracking-wide font-sans prose prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: marked.parse(msg.text || '') }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap tracking-wide font-sans">{msg.text}</div>
                  )}
                  <div
                    className={`text-[11px] mt-2 opacity-70 text-right font-medium ${
                      msg.sender === 'user' ? 'text-indigo-200' : 'text-slate-400'
                    }`}
                  >
                    {msg.time}
                  </div>
                </div>

                {/* Citations & Source Cards */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-1 space-y-2">
                    <div className="text-[11px] font-semibold text-cyan-400 flex items-center gap-1.5 px-1 tracking-wider uppercase">
                      <FiBookmark className="w-3.5 h-3.5" />
                      <span>Verified Document Citations & Sources:</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {msg.citations.map((cite, i) => (
                        <div
                          key={i}
                          className="bg-slate-900/95 border border-slate-800 hover:border-cyan-500/50 p-3 rounded-xl text-xs transition shadow-sm"
                        >
                          <div className="flex items-center justify-between font-semibold text-slate-300 mb-1.5">
                            <span className="truncate text-cyan-300">📄 {cite.file}</span>
                            <span className="bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded text-[10px] border border-cyan-500/20">
                              Page: {cite.page_number}
                            </span>
                          </div>
                          {cite.relevance_score && (
                            <div className="text-[10px] text-emerald-400 mb-1 font-medium">
                              Relevance Score: {cite.relevance_score}
                            </div>
                          )}
                          <p className="text-[11px] text-slate-400 line-clamp-2 italic leading-relaxed">
                            "{cite.snippet}"
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}

          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3.5 mr-auto max-w-xl"
            >
              <div className="w-10 h-10 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 flex items-center justify-center shrink-0">
                <FiCpu className="animate-bounce w-5 h-5" />
              </div>

              <div className="bg-slate-900/90 border border-slate-800 text-slate-300 px-5 py-3.5 rounded-2xl rounded-tl-none text-xs flex items-center gap-3.5 shadow-md">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping delay-150" />
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping delay-300" />
                </div>
                <span className="font-medium">
                  {useCelery
                    ? taskState || 'Processing query via background queue...'
                    : 'Searching hybrid vector index, reranking with Cohere & formatting answer...'}
                </span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Input Form Footer */}
        <div className="p-5 md:p-6 border-t border-slate-800/80 bg-slate-950/95">
          <form onSubmit={handleSendQuestion} className="flex items-center gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={sessionId ? 'Type your question about the uploaded document...' : 'Please upload a document first...'}
              disabled={!sessionId || isThinking}
              className="flex-1 bg-slate-900 border border-slate-800 focus:border-cyan-500/70 rounded-2xl px-5 py-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition disabled:opacity-50 shadow-inner"
            />

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={!question.trim() || !sessionId || isThinking}
              className="px-7 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-cyan-500/25 disabled:opacity-50 transition"
            >
              <span>Send</span>
              <FiSend className="w-4 h-4" />
            </motion.button>
          </form>

          <div className="flex items-center justify-between mt-3 text-[11px] text-slate-400 px-1 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
              RAGI Enterprise Neural Engine Online
            </span>
            <span>Execution Mode: {useCelery ? 'Celery + Redis Background Queue' : 'FastAPI Sync Engine'}</span>
          </div>
        </div>

      </div>

      <footer className="relative z-10 py-3 text-center text-xs text-slate-500 border-t border-slate-800/40 bg-slate-950/70 backdrop-blur-md">
        <p className="flex items-center justify-center gap-1.5 font-medium">
          <span>Designed & Developed by</span>
          <span className="font-semibold text-cyan-400">Mr Faizan</span>
          <span>| RAGI Enterprise AI</span>
        </p>
      </footer>

    </div>
  );
}