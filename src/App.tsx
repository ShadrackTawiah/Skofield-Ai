import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, OperationType, handleFirestoreError } from './lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, setDoc, deleteDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { MODELS, generateChatResponse, generateVideo, textToSpeech } from './lib/gemini';
import { ThinkingLevel } from '@google/genai';
import { ErrorBoundary } from './components/ErrorBoundary';
import { 
  Send, 
  Plus, 
  MessageSquare, 
  LogOut, 
  Search, 
  MapPin, 
  Video, 
  Volume2, 
  Brain, 
  User as UserIcon, 
  Bot, 
  Loader2, 
  Trash2, 
  ChevronRight, 
  Menu, 
  X,
  Image as ImageIcon,
  Check,
  MoreVertical
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { ChatThread, ChatMessage, UserProfile } from './lib/types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS.FLASH);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [searchGrounding, setSearchGrounding] = useState(false);
  const [mapsGrounding, setMapsGrounding] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoImage, setVideoImage] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPhotoURL, setNewPhotoURL] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        setNewDisplayName(user.displayName || '');
        setNewPhotoURL(user.photoURL || '');
        const userRef = doc(db, 'users', user.uid);
        try {
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: serverTimestamp(),
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const chatsQuery = query(
      collection(db, `users/${user.uid}/chats`),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(chatsQuery, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatThread));
      setChats(chatList);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/chats`));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !activeChatId) {
      setMessages([]);
      return;
    }
    const messagesQuery = query(
      collection(db, `users/${user.uid}/chats/${activeChatId}/messages`),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const messageList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      setMessages(messageList);
      scrollToBottom();
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/chats/${activeChatId}/messages`));
    return () => unsubscribe();
  }, [user, activeChatId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const createNewChat = async () => {
    if (!user) return;
    try {
      const chatRef = await addDoc(collection(db, `users/${user.uid}/chats`), {
        userId: user.uid,
        title: 'New Conversation',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        model: selectedModel,
      });
      setActiveChatId(chatRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/chats`);
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/chats`, chatId));
      if (activeChatId === chatId) setActiveChatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/chats/${chatId}`);
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || !user || isGenerating) return;

    let chatId = activeChatId;
    if (!chatId) {
      const chatRef = await addDoc(collection(db, `users/${user.uid}/chats`), {
        userId: user.uid,
        title: input.slice(0, 30) + '...',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        model: selectedModel,
      });
      chatId = chatRef.id;
      setActiveChatId(chatId);
    }

    const userMessage: Partial<ChatMessage> = {
      chatId: chatId!,
      role: 'user',
      content: input,
      type: 'text',
      createdAt: Timestamp.now() as any,
    };

    setInput('');
    setIsGenerating(true);

    try {
      await addDoc(collection(db, `users/${user.uid}/chats/${chatId}/messages`), {
        ...userMessage,
        createdAt: serverTimestamp(),
      });

      const history = messages.map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      history.push({ role: 'user', parts: [{ text: input }] });

      const tools = [];
      if (searchGrounding) tools.push({ googleSearch: {} });
      if (mapsGrounding) tools.push({ googleMaps: {} });

      const response = await generateChatResponse(
        thinkingMode ? MODELS.PRO : selectedModel,
        history,
        "You are MR SKOFILED, an advanced AI assistant. Provide helpful, accurate, and structured responses.",
        tools.length > 0 ? tools : undefined,
        thinkingMode ? ThinkingLevel.HIGH : undefined
      );

      const modelMessage: Partial<ChatMessage> = {
        chatId: chatId!,
        role: 'model',
        content: response.text || 'No response generated.',
        type: 'text',
        createdAt: Timestamp.now() as any,
        metadata: {
          groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks,
        }
      };

      await addDoc(collection(db, `users/${user.uid}/chats/${chatId}/messages`), {
        ...modelMessage,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, `users/${user.uid}/chats`, chatId!), {
        updatedAt: serverTimestamp(),
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/chats/${chatId}/messages`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim() || !user || !activeChatId) return;
    setIsGeneratingVideo(true);
    try {
      const videoUrl = await generateVideo(videoPrompt, videoImage || undefined);
      
      await addDoc(collection(db, `users/${user.uid}/chats/${activeChatId}/messages`), {
        chatId: activeChatId,
        role: 'model',
        content: `Generated video for: ${videoPrompt}`,
        type: 'video',
        createdAt: serverTimestamp(),
        metadata: { videoUrl }
      });
      setShowVideoModal(false);
      setVideoPrompt('');
      setVideoImage(null);
    } catch (error) {
      console.error('Video generation error:', error);
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleTTS = async (text: string) => {
    try {
      const audioUrl = await textToSpeech(text);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.play();
      }
    } catch (error) {
      console.error('TTS error:', error);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsUpdatingProfile(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: newDisplayName,
        photoURL: newPhotoURL,
      });
      setShowProfileModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleProfileImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewPhotoURL(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setVideoImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
        <Loader2 className="w-8 h-8 text-black dark:text-white animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-black dark:bg-white rounded-3xl flex items-center justify-center shadow-2xl overflow-hidden relative">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
              <Bot size={48} className="text-white dark:text-black absolute" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">MR SKOFILED</h1>
            <p className="text-gray-500 dark:text-gray-400 text-lg">Your advanced multi-modal AI companion.</p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-4 px-6 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-2xl flex items-center justify-center gap-3 hover:opacity-90 transition-all active:scale-[0.98] border border-black dark:border-white"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-white dark:bg-black text-black dark:text-white overflow-hidden font-sans transition-colors duration-300">
        {/* Sidebar */}
        <AnimatePresence mode="wait">
          {isSidebarOpen && (
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              className="w-72 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50 backdrop-blur-xl z-30"
            >
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xl text-black dark:text-white">
                  <div className="w-8 h-8 bg-black dark:bg-white rounded-lg flex items-center justify-center overflow-hidden relative">
                    <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    <Bot size={18} className="text-white dark:text-black absolute" />
                  </div>
                  MR SKOFILED
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              <div className="px-4 mb-4">
                <button
                  onClick={createNewChat}
                  className="w-full py-3 px-4 bg-black dark:bg-white text-white dark:text-black rounded-xl flex items-center justify-center gap-2 font-medium transition-all shadow-lg border border-black dark:border-white"
                >
                  <Plus size={18} />
                  New Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2 space-y-1">
                {chats.map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={cn(
                      "group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all",
                      activeChatId === chat.id ? "bg-black dark:bg-white text-white dark:text-black" : "hover:bg-gray-200 dark:hover:bg-gray-800/50 text-gray-600 dark:text-gray-400"
                    )}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <MessageSquare size={18} className={activeChatId === chat.id ? "text-white dark:text-black" : "text-gray-400"} />
                      <span className="truncate text-sm font-medium">{chat.title}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-4">
                <div 
                  onClick={() => setShowProfileModal(true)}
                  className="flex items-center gap-3 p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl cursor-pointer transition-all"
                >
                  <img src={newPhotoURL || user.photoURL || ''} className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-700 object-cover" alt={newDisplayName || user.displayName || ''} />
                  <div className="flex-1 truncate">
                    <p className="text-sm font-semibold text-black dark:text-white truncate">{newDisplayName || user.displayName}</p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  </div>
                  <MoreVertical size={16} className="text-gray-400" />
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative min-w-0 bg-white dark:bg-black">
          {/* Header */}
          <header className="h-16 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-white/50 dark:bg-black/50 backdrop-blur-md z-20">
            <div className="flex items-center gap-4">
              {!isSidebarOpen && (
                <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg">
                  <Menu size={20} />
                </button>
              )}
              <div className="flex items-center gap-2">
                <select 
                  value={selectedModel} 
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                >
                  <option value={MODELS.FLASH}>skofield flash</option>
                  <option value={MODELS.PRO}>skofield 1.5</option>
                  <option value={MODELS.LITE}>skofield 5.0</option>
                  <option value={MODELS.PRO}>skofield</option>
                </select>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setThinkingMode(!thinkingMode)}
                    className={cn(
                      "p-2 rounded-lg transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-wider border",
                      thinkingMode ? "bg-black dark:bg-white text-white dark:text-black border-black dark:border-white" : "bg-white dark:bg-gray-900 text-gray-500 border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    <Brain size={16} />
                    <span className="hidden sm:inline">Thinking</span>
                  </button>
                  <button 
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className="p-2 rounded-lg bg-white dark:bg-gray-900 text-gray-500 border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                  >
                    {theme === 'dark' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setShowVideoModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium transition-all"
            >
              <Video size={18} className="text-black dark:text-white" />
              <span className="hidden sm:inline">Generate Video</span>
            </button>
          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-2xl mx-auto">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-900 rounded-2xl flex items-center justify-center text-black dark:text-white overflow-hidden relative border border-gray-200 dark:border-gray-800">
                  <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  <Bot size={32} className="absolute" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-black dark:text-white">How can I help you today?</h2>
                  <p className="text-gray-500 dark:text-gray-400">MR SKOFILED can help you with coding, writing, research, and multi-modal tasks like video generation and speech synthesis.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  {[
                    "Explain quantum computing in simple terms",
                    "Write a Python script for data analysis",
                    "Plan a 3-day trip to Tokyo",
                    "Generate a video of a futuristic city"
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-2xl text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-700 dark:text-gray-300"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={cn("flex gap-4 max-w-4xl mx-auto", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center border",
                    msg.role === 'user' ? "bg-black dark:bg-white border-black dark:border-white text-white dark:text-black" : "bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-black dark:text-white"
                  )}>
                    {msg.role === 'user' ? <UserIcon size={20} /> : <Bot size={20} />}
                  </div>
                  <div className={cn(
                    "flex flex-col gap-2 max-w-[85%]",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                      msg.role === 'user' ? "bg-black dark:bg-white text-white dark:text-black rounded-tr-none" : "bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-tl-none"
                    )}>
                      {msg.type === 'video' ? (
                        <div className="space-y-3">
                          <video src={msg.metadata?.videoUrl} controls className="w-full rounded-xl shadow-lg" />
                          <p className="text-xs opacity-70">{msg.content}</p>
                        </div>
                      ) : (
                        <div className={cn("prose prose-sm max-w-none", theme === 'dark' ? "prose-invert" : "prose-slate")}>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 px-1">
                      <span className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">
                        {format(msg.createdAt instanceof Timestamp ? msg.createdAt.toDate() : new Date(), 'HH:mm')}
                      </span>
                      {msg.role === 'model' && msg.type === 'text' && (
                        <button 
                          onClick={() => handleTTS(msg.content)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-black dark:hover:text-white transition-all"
                        >
                          <Volume2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            {isGenerating && (
              <div className="flex gap-4 max-w-4xl mx-auto">
                <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-black dark:text-white flex items-center justify-center">
                  <Bot size={20} />
                </div>
                <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-black dark:bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-black dark:bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-black dark:bg-white rounded-full animate-bounce"></span>
                  </div>
                  <span className="text-xs text-gray-500 font-medium">Generating...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-gradient-to-t from-white dark:from-black via-white dark:via-black to-transparent">
            <form 
              onSubmit={sendMessage}
              className="max-w-4xl mx-auto relative group"
            >
              <div className="absolute inset-0 bg-black/5 dark:bg-white/5 rounded-2xl blur-xl group-focus-within:bg-black/10 dark:group-focus-within:bg-white/10 transition-all"></div>
              <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-2 flex items-end gap-2 shadow-2xl focus-within:border-black dark:focus-within:border-white transition-all">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask MR SKOFILED anything..."
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-4 resize-none max-h-40 min-h-[52px] text-black dark:text-white"
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isGenerating}
                  className={cn(
                    "p-3 rounded-xl transition-all active:scale-95",
                    input.trim() && !isGenerating ? "bg-black dark:bg-white text-white dark:text-black shadow-lg" : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
                  )}
                >
                  {isGenerating ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </form>
            <p className="text-center text-[10px] text-gray-500 mt-4 uppercase tracking-widest font-bold">
              MR SKOFILED can make mistakes. Verify important information.
            </p>
          </div>
        </main>

        {/* Video Modal */}
        <AnimatePresence>
          {showVideoModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isGeneratingVideo && setShowVideoModal(false)}
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-2xl p-6 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-black dark:text-white">
                      <Video size={20} />
                    </div>
                    <h3 className="text-xl font-bold text-black dark:text-white">Generate Video</h3>
                  </div>
                  <button 
                    onClick={() => setShowVideoModal(false)}
                    disabled={isGeneratingVideo}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Prompt</label>
                    <textarea
                      value={videoPrompt}
                      onChange={(e) => setVideoPrompt(e.target.value)}
                      placeholder="A neon hologram of a cat driving at top speed..."
                      className="w-full bg-gray-50 dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-sm focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent outline-none min-h-[100px] resize-none text-black dark:text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Reference Image (Optional)</label>
                    <div 
                      onClick={() => !isGeneratingVideo && fileInputRef.current?.click()}
                      className={cn(
                        "w-full h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all overflow-hidden relative",
                        videoImage ? "border-black dark:border-white" : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
                      )}
                    >
                      {videoImage ? (
                        <>
                          <img src={videoImage} className="w-full h-full object-cover" alt="Reference" />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-all">
                            <Plus className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <ImageIcon size={32} className="text-gray-300 dark:text-gray-700" />
                          <p className="text-xs text-gray-500">Click to upload image</p>
                        </>
                      )}
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </div>
                </div>

                <button
                  onClick={handleGenerateVideo}
                  disabled={!videoPrompt.trim() || isGeneratingVideo}
                  className="w-full py-4 bg-black dark:bg-white text-white dark:text-black font-bold rounded-2xl flex items-center justify-center gap-3 transition-all shadow-lg"
                >
                  {isGeneratingVideo ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Generating Video...
                    </>
                  ) : (
                    <>
                      <Video size={20} />
                      Generate Video
                    </>
                  )}
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Profile Modal */}
        <AnimatePresence>
          {showProfileModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isUpdatingProfile && setShowProfileModal(false)}
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-2xl p-6 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-black dark:text-white">Edit Profile</h3>
                  <button 
                    onClick={() => setShowProfileModal(false)}
                    disabled={isUpdatingProfile}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-6">
                  <div className="flex flex-col items-center gap-4">
                    <div 
                      onClick={() => profileImageInputRef.current?.click()}
                      className="w-24 h-24 rounded-full border-2 border-gray-200 dark:border-gray-800 overflow-hidden relative cursor-pointer group"
                    >
                      <img src={newPhotoURL || user.photoURL || ''} className="w-full h-full object-cover" alt="Profile" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                        <ImageIcon className="text-white" />
                      </div>
                    </div>
                    <input 
                      type="file" 
                      ref={profileImageInputRef} 
                      onChange={handleProfileImageUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    <p className="text-xs text-gray-500">Click to change photo</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Display Name</label>
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl p-3 text-sm focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent outline-none text-black dark:text-white"
                    />
                  </div>

                  <div className="pt-4 flex flex-col gap-3">
                    <button
                      type="submit"
                      disabled={isUpdatingProfile}
                      className="w-full py-3 bg-black dark:bg-white text-white dark:text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg"
                    >
                      {isUpdatingProfile ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-red-100 dark:hover:bg-red-900/40"
                    >
                      <LogOut size={18} />
                      Log Out
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
