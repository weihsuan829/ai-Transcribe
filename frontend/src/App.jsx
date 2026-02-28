import React, { useState, useEffect, useRef } from 'react';
import {
  Instagram,
  Send,
  Loader2,
  CheckCircle2,
  Copy,
  FileText,
  Sparkles,
  AlertCircle,
  ExternalLink,
  Download,
  Library,
  Trash2,
  ChevronLeft,
  Search,
  BookMarked,
  FileUp,
  FileBox,
  Eye,
  X,
  Bot,
  Youtube,
  Clock,
  Upload,
  Music,
  Film,
  Mic,
  Coins
} from 'lucide-react';
import {
  transcribeUrl,
  transcribeLongUrl,
  transcribeFile,
  saveToLibrary,
  getHistory,
  deleteFromHistory,
  sendChatMessage,
  getThreads,
  getThreadMessages,
  deleteThread,
  getDocuments,
  uploadDocument,
  updateLibraryTag,
  updateDocumentTag,
  deleteDocument,
  getTags,
  createTag,
  deleteTag,
  processMeeting
} from './utils/api';

const BentoCard = ({ children, title, icon: Icon, className = "" }) => (
  <div className={`bento-card bg-white ${className}`}>
    <div className="flex items-center gap-2 mb-4">
      <div className="p-2 bg-primary/5 rounded-lg text-primary">
        <Icon size={20} />
      </div>
      <h3 className="font-semibold text-text">{title}</h3>
    </div>
    {children}
  </div>
);

const getSourceInfo = (url = "") => {
  if (url === '即時會議錄音') {
    return {
      label: '即時會議紀錄',
      icon: Mic,
      iconColor: 'text-indigo-500'
    };
  }
  if (url.startsWith('Local File: ')) {
    return {
      label: url.replace('Local File: ', ''),
      icon: FileBox,
      iconColor: 'text-slate-400'
    };
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return {
      label: url.includes('/shorts/') ? 'YouTube Shorts' : 'YouTube Video',
      icon: Youtube,
      iconColor: 'text-red-500'
    };
  }
  return {
    label: 'Instagram Reel',
    icon: Instagram,
    iconColor: 'text-slate-400'
  };
};

function App() {
  const [url, setUrl] = useState('');
  const [view, setView] = useState('home'); // 'home', 'library', 'chat', 'long-video', 'meeting', 'documents', 'tags'
  const [modelProvider, setModelProvider] = useState('openai'); // 'openai' | 'gemini'
  const [libraryData, setLibraryData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Document Center states
  const [documentList, setDocumentList] = useState([]);
  const [isDocLoading, setIsDocLoading] = useState(false);
  const [docUploadStatus, setDocUploadStatus] = useState(null);
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [selectedDocTagId, setSelectedDocTagId] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState(null);
  const [showDocDeleteConfirm, setShowDocDeleteConfirm] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);
  const [showLibDeleteConfirm, setShowLibDeleteConfirm] = useState(false);
  const [libItemToDelete, setLibItemToDelete] = useState(null);

  // Tag states
  const [tags, setTags] = useState([]);
  const [chatFilterTagId, setChatFilterTagId] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [isTagLoading, setIsTagLoading] = useState(false);

  // Meeting states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const timerRef = useRef(null);

  const fileInputRef = useRef(null);

  // State isolation per view
  const [tabStates, setTabStates] = useState({
    home: { result: null, isLoading: false, error: null, saveStatus: null, selectedTagId: '' },
    'long-video': { result: null, isLoading: false, error: null, saveStatus: null, selectedTagId: '' },
    meeting: { result: null, isLoading: false, error: null, saveStatus: null, selectedTagId: '' }
  });

  const updateTabState = (tab, updates) => {
    setTabStates(prev => ({
      ...prev,
      [tab]: { ...prev[tab], ...updates }
    }));
  };

  const currentTabState = tabStates[view] || { result: null, isLoading: false, error: null, saveStatus: null, selectedTagId: '' };

  useEffect(() => {
    fetchTags(); // Fetch tags on mount to have them ready
    if (view === 'library') {
      fetchHistory();
    } else if (view === 'chat') {
      fetchThreads();
    } else if (view === 'documents') {
      fetchDocuments();
    }
  }, [view]);

  const fetchHistory = async () => {
    try {
      const data = await getHistory();
      setLibraryData(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchThreads = async () => {
    try {
      const data = await getThreads();
      setThreads(data);
      // If no thread selected but we have threads, maybe don't auto-select to keep "New Chat" state
    } catch (err) {
      console.error(err);
    }
  };

  const loadThreadMessages = async (threadId) => {
    setIsChatLoading(true);
    setCurrentThreadId(threadId);
    try {
      const messages = await getThreadMessages(threadId);
      setChatMessages(messages);
    } catch (err) {
      console.error(err);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleThreadDelete = (e, threadId) => {
    e.stopPropagation();
    setThreadToDelete(threadId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteThread = async () => {
    if (!threadToDelete) return;
    try {
      await deleteThread(threadToDelete);
      fetchThreads();
      if (currentThreadId === threadToDelete) {
        setChatMessages([]);
        setCurrentThreadId(null);
      }
    } catch (err) {
      setErrorMessage('刪除失敗');
    } finally {
      setShowDeleteConfirm(false);
      setThreadToDelete(null);
    }
  };

  const createNewChat = () => {
    setCurrentThreadId(null);
    setChatMessages([]);
    setChatInput('');
  };

  // Document management functions
  const fetchDocuments = async () => {
    setIsDocLoading(true);
    try {
      const data = await getDocuments();
      setDocumentList(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDocLoading(false);
    }
  };

  const handleDocUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDocUploadStatus('uploading');
    try {
      await uploadDocument(file, selectedDocTagId || null);
      setDocUploadStatus('success');
      setSelectedDocTagId(''); // Reset after upload
      fetchDocuments();
      setTimeout(() => setDocUploadStatus(null), 3000);
    } catch (err) {
      setErrorMessage(err.message);
      setDocUploadStatus(null);
    }
  };

  const handleLibraryTagChange = async (itemId, tagId) => {
    try {
      await updateLibraryTag(itemId, tagId || null);
      fetchHistory();
    } catch (err) {
      console.error('Tag change error:', err);
      setErrorMessage('更新影片標籤失敗: ' + (err.message || '未知錯誤'));
    }
  };

  const handleDocTagChange = async (docId, tagId) => {
    try {
      await updateDocumentTag(docId, tagId || null);
      fetchDocuments();
    } catch (err) {
      console.error('Doc tag change error:', err);
      setErrorMessage('更新文件標籤失敗: ' + (err.message || '未知錯誤'));
    }
  };

  const handleDocDelete = (id) => {
    setDocToDelete(id);
    setShowDocDeleteConfirm(true);
  };

  const confirmDeleteDoc = async () => {
    if (!docToDelete) return;

    setDeletingIds(prev => new Set(prev).add(docToDelete));
    try {
      await deleteDocument(docToDelete);
      fetchDocuments();
    } catch (err) {
      setErrorMessage('刪除失敗：' + err.message);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(docToDelete);
        return next;
      });
      setShowDocDeleteConfirm(false);
      setDocToDelete(null);
    }
  };

  const fetchTags = async () => {
    try {
      const data = await getTags();
      setTags(data);
    } catch (err) {
      console.error(err);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        console.log('Recorder stopped, chunks count:', chunks.length);
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        console.log('Created blob size:', audioBlob.size);

        updateTabState('meeting', { isLoading: true, error: null, result: null });
        try {
          console.log('Sending audio to backend...');
          const data = await processMeeting(audioBlob, modelProvider);
          console.log('Backend response received:', data);
          updateTabState('meeting', { result: data });
        } catch (err) {
          console.error('Meeting processing error:', err);
          updateTabState('meeting', { error: err.message });
        } finally {
          updateTabState('meeting', { isLoading: false });
          // Stop all tracks in the stream
          stream.getTracks().forEach(track => track.stop());
        }
      };

      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setErrorMessage('無法取得麥克風權限：' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCreateTag = async (e) => {
    e.preventDefault();
    if (!newTagName.trim() || isTagLoading) return;
    setIsTagLoading(true);
    try {
      await createTag(newTagName);
      setNewTagName('');
      fetchTags();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsTagLoading(false);
    }
  };

  const handleDeleteTag = async (id) => {
    if (!window.confirm('確定要刪除此標籤嗎？相關影片的標籤將會被移除。')) return;
    try {
      await deleteTag(id);
      fetchTags();
    } catch (err) {
      setErrorMessage('刪除失敗');
    }
  };

  const handleChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    const messageToSend = chatInput;
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await sendChatMessage(messageToSend, currentThreadId, modelProvider, chatFilterTagId || null);
      const aiMsg = {
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
        cost: response.cost,
        usage: response.usage
      };
      setChatMessages(prev => [...prev, aiMsg]);

      // If it's a new thread, refresh threads list and set the current thread ID
      if (!currentThreadId) {
        setCurrentThreadId(response.thread_id);
        fetchThreads();
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: '抱歉，聊天功能的後端連線出了點問題。', isError: true }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    updateTabState('home', { isLoading: true, error: null, result: null, saveStatus: null });

    try {
      const data = await transcribeUrl(url, modelProvider);
      updateTabState('home', { result: { ...data, url } });
    } catch (err) {
      updateTabState('home', { error: err.message });
    } finally {
      updateTabState('home', { isLoading: false });
    }
  };

  const handleLongSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    updateTabState('long-video', { isLoading: true, error: null, result: null, saveStatus: null });

    try {
      const data = await transcribeLongUrl(url, modelProvider);
      updateTabState('long-video', { result: { ...data, url } });
    } catch (err) {
      updateTabState('long-video', { error: err.message });
    } finally {
      updateTabState('long-video', { isLoading: false });
    }
  };

  const handleFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetTab = view === 'long-video' ? 'long-video' : 'home';
    updateTabState(targetTab, { isLoading: true, error: null, result: null, saveStatus: null });
    setUrl(file.name); // Show filename as current context

    try {
      const data = await transcribeFile(file, modelProvider);
      updateTabState(targetTab, {
        result: {
          ...data,
          url: `Local File: ${file.name}` // Format for database saving
        }
      });
    } catch (err) {
      updateTabState(targetTab, { error: err.message });
    } finally {
      updateTabState(targetTab, { isLoading: false });
      // Reset file input for same file re-upload if needed
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const { result, selectedTagId } = currentTabState;
    if (!result) return;
    updateTabState(view, { saveStatus: 'saving' });
    try {
      await saveToLibrary({
        url: result.url,
        transcript: result.transcript,
        summary: result.summary,
        tag_id: selectedTagId || null,
        cost: result.cost || null
      });
      updateTabState(view, { saveStatus: 'saved', selectedTagId: '' });
    } catch (err) {
      updateTabState(view, { error: '儲存失敗', saveStatus: null });
    }
  };

  const handleLibDelete = (e, id) => {
    e.stopPropagation();
    setLibItemToDelete(id);
    setShowLibDeleteConfirm(true);
  };

  const confirmDeleteLib = async () => {
    if (!libItemToDelete) return;
    try {
      await deleteFromHistory(libItemToDelete);
      fetchHistory();
    } catch (err) {
      setErrorMessage('刪除失敗');
    } finally {
      setShowLibDeleteConfirm(false);
      setLibItemToDelete(null);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    // Simple toast notification could be added here
  };

  return (
    <div className="min-h-screen bg-background text-text p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Hidden File Input for Transcriptions */}
        <input
          type="file"
          id="transcribe-file-input"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="audio/*,video/*"
          className="hidden"
        />
        {/* Navigation / Header */}
        <nav className="flex justify-between items-center bg-white/50 backdrop-blur-md p-4 rounded-3xl border border-white/20 shadow-soft">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
              <Instagram size={22} />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-800 whitespace-nowrap">影音轉文字助手</span>
          </div>
          <div className="flex bg-slate-100 p-1.5 rounded-2xl">
            {/* Model Selector */}
            <div className="flex bg-white rounded-xl mr-2 p-1 border border-slate-200">
              <button
                onClick={() => setModelProvider('openai')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${modelProvider === 'openai' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                title="Use OpenAI GPT-4o-mini"
              >
                <Bot size={14} />
                OpenAI
              </button>
              <button
                onClick={() => setModelProvider('gemini')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${modelProvider === 'gemini' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                title="Use Google Gemini 1.5 Flash"
              >
                <Sparkles size={14} />
                Gemini
              </button>
            </div>

            <button
              onClick={() => setView('home')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'home' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="短影音"
            >
              <Instagram size={16} />
              {view === 'home' && <span>短影音</span>}
            </button>
            <button
              onClick={() => setView('long-video')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'long-video' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="長影音"
            >
              <Clock size={16} />
              {view === 'long-video' && <span>長影音</span>}
            </button>
            <button
              onClick={() => setView('meeting')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'meeting' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="即時會議"
            >
              <Mic size={16} />
              {view === 'meeting' && <span>即時會議</span>}
            </button>
            <button
              onClick={() => setView('library')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'library' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="資料庫"
            >
              <Library size={16} />
              {view === 'library' && <span>資料庫</span>}
            </button>
            <button
              onClick={() => setView('chat')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'chat' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="AI 問答"
            >
              <Sparkles size={16} />
              {view === 'chat' && <span>AI 問答</span>}
            </button>
            <button
              onClick={() => setView('documents')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'documents' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="文件庫"
            >
              <FileBox size={16} />
              {view === 'documents' && <span>文件庫</span>}
            </button>
            <button
              onClick={() => setView('tags')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${view === 'tags' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'}`}
              title="分類標籤"
            >
              <Search size={16} />
              {view === 'tags' && <span>分類標籤</span>}
            </button>
          </div>
        </nav>

        {view === 'home' ? (
          <div className="space-y-12">
            {/* Hero Section */}
            <header className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-semibold mb-2">
                <Sparkles size={16} />
                <span>AI-Powered Transcription</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
                AI 影音轉文字
              </h1>
              <p className="text-text-muted max-w-lg mx-auto text-lg leading-relaxed">
                貼上連結，讓我們為你提取 IG Reel 或 YouTube Shorts 音訊、辨識文字並整理重點。
              </p>
            </header>

            {/* Search Bar Section */}
            <section className="max-w-2xl mx-auto">
              <form onSubmit={handleSubmit} className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-text-light group-focus-within:text-primary transition-colors">
                  {url.includes('youtube.com/shorts') || url.includes('youtu.be') ? (
                    <Youtube size={24} className="text-red-500" />
                  ) : (
                    <Instagram size={24} />
                  )}
                </div>
                <input
                  type="text"
                  placeholder="貼上 Instagram Reel 或 YouTube Shorts 連結..."
                  className="input-field pl-16 pr-32"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={currentTabState.isLoading}
                />
                <button
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 btn-primary !py-2.5 !px-5 flex items-center gap-2"
                  disabled={currentTabState.isLoading || !url}
                >
                  {currentTabState.isLoading ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Send size={18} />
                  )}
                  <span>{currentTabState.isLoading ? '處理中...' : '轉換'}</span>
                </button>
              </form>

              {/* Local File Upload Support */}
              <div className="mt-6 flex flex-col items-center">
                <label
                  htmlFor="transcribe-file-input"
                  className={`group flex items-center gap-3 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:border-primary/30 hover:bg-slate-50 transition-all shadow-sm hover:shadow-md cursor-pointer ${currentTabState.isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                    <Upload size={20} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-slate-800">上傳錄音或影片檔</div>
                    <div className="text-xs text-slate-400">支援 MP3, M4A, WAV, MP4, MOV...</div>
                  </div>
                </label>
              </div>
              {currentTabState.error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle size={20} />
                  <p className="text-sm font-medium">{currentTabState.error}</p>
                </div>
              )}
            </section>

            {/* Results Section */}
            {currentTabState.result && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in zoom-in duration-500">
                <BentoCard title="AI 整理摘要" icon={Sparkles} className="md:col-span-1">
                  <div className="prose prose-sm text-text-muted leading-relaxed whitespace-pre-wrap">
                    {currentTabState.result.summary}
                  </div>
                  {currentTabState.result.usage && (
                    <div className="mt-4 flex justify-end">
                      <div className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md font-mono border border-slate-100 flex items-center gap-1">
                        <Coins size={10} className="text-amber-500" />
                        Usage: {currentTabState.result.usage.total_tokens || currentTabState.result.usage.totalTokenCount} tokens
                        {currentTabState.result.cost && ` ($${currentTabState.result.cost})`}
                      </div>
                    </div>
                  )}
                </BentoCard>
                {/* Transcript Card */}
                <BentoCard title="原始逐字稿" icon={FileText} className="md:col-span-2 relative">
                  <button
                    onClick={() => copyToClipboard(currentTabState.result.transcript)}
                    className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-lg text-text-muted transition-colors"
                    title="複製內容"
                  >
                    <Copy size={18} />
                  </button>
                  <div className="mt-2 text-text-muted leading-relaxed max-h-[400px] overflow-y-auto pr-4 scrollbar-thin">
                    {currentTabState.result.transcript}
                  </div>
                </BentoCard>

                {/* Quick Actions */}
                <div className="md:col-span-3 flex items-center justify-between p-6 bg-primary/5 border border-primary/10 rounded-3xl">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="text-primary" size={24} />
                    <div>
                      <p className="font-semibold">處理完成!</p>
                      <p className="text-sm text-text-muted">
                        轉錄結果已整理完畢。
                        {currentTabState.result.cost && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100 font-bold">
                            <Coins size={10} />
                            估計成本: ${currentTabState.result.cost}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => updateTabState('home', { result: null })}
                      className="px-6 py-2 rounded-xl border border-border bg-white hover:bg-slate-50 transition-colors font-medium cursor-pointer"
                    >
                      清除
                    </button>
                    {currentTabState.saveStatus === 'saved' ? (
                      <div className="bg-green-100 text-green-700 font-semibold px-6 py-2 rounded-xl flex items-center gap-2">
                        <CheckCircle2 size={18} />
                        已加入 library
                      </div>
                    ) : (
                      <div className="flex gap-4 items-center">
                        <select
                          className="bg-white border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary/40 shadow-sm"
                          value={currentTabState.selectedTagId}
                          onChange={(e) => updateTabState('home', { selectedTagId: e.target.value })}
                        >
                          <option value="">選擇分類標籤 (可不選)</option>
                          {tags.map(tag => (
                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleSave}
                          disabled={currentTabState.saveStatus === 'saving'}
                          className="btn-primary !py-2 flex items-center gap-2 bg-accent hover:bg-accent-light shadow-accent/20"
                        >
                          {currentTabState.saveStatus === 'saving' ? <Loader2 className="animate-spin" size={18} /> : <BookMarked size={18} />}
                          加入我的資料庫
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Features (Empty State) */}
            {!currentTabState.result && !currentTabState.isLoading && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 opacity-60">
                <BentoCard title="提取音訊" icon={Download}>
                  <p className="text-sm text-text-muted leading-relaxed">自動解析 IG 或 YT 連結並提取高品質音訊軌道。</p>
                </BentoCard>
                <BentoCard title="Whisper 辨識" icon={CheckCircle2}>
                  <p className="text-sm text-text-muted leading-relaxed">使用 OpenAI Whisper 模型進行多國語言高準度轉錄。</p>
                </BentoCard>
                <BentoCard title="GPT 優化" icon={Sparkles}>
                  <p className="text-sm text-text-muted leading-relaxed">自動產出結構化的重點摘要，節省你的閱讀時間。</p>
                </BentoCard>
              </div>
            )}
          </div>
        ) : view === 'library' ? (
          /* Library View */
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">我的影音資料庫</h1>
                <p className="text-text-muted mt-1">你儲存的所有轉錄紀錄與 AI 摘要。</p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light" size={18} />
                <input
                  type="text"
                  placeholder="搜尋紀錄..."
                  className="bg-white border border-border rounded-xl py-2 pl-10 pr-4 focus:outline-none focus:border-primary/40 transition-all text-sm w-64 shadow-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {libraryData.length === 0 ? (
              <div className="text-center py-24 bg-white/50 rounded-4xl border border-dashed border-border mt-12">
                <div className="bg-slate-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-text-light">
                  <Library size={32} />
                </div>
                <h3 className="text-xl font-semibold text-slate-800">還沒有紀錄</h3>
                <p className="text-text-muted max-w-xs mx-auto mt-2">
                  開始轉換 Instagram 或 YouTube 影音，並點擊「儲存」來存入你的第一筆資料。
                </p>
                <button
                  onClick={() => setView('home')}
                  className="mt-6 text-primary font-semibold hover:underline"
                >
                  前往轉換 →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {libraryData
                  .filter(item => {
                    const query = searchQuery.toLowerCase();
                    const sourceInfo = getSourceInfo(item.url);
                    const label = sourceInfo.label.toLowerCase();

                    return (
                      item.summary?.toLowerCase().includes(query) ||
                      item.transcript?.toLowerCase().includes(query) ||
                      item.url?.toLowerCase().includes(query) ||
                      label.includes(query)
                    );
                  })
                  .map((item) => {
                    const { label, icon: SourceIcon, iconColor } = getSourceInfo(item.url);
                    return (
                      <div key={item.id} className="bento-card bg-white group hover:border-primary/20">
                        <div className="flex justify-between items-start mb-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs text-text-muted font-medium uppercase tracking-wider">
                              <SourceIcon size={12} className={iconColor} />
                              <span>{label}</span>
                              <span>•</span>
                              <span>{new Date(item.created_at).toLocaleDateString()}</span>
                              <span>•</span>
                              <select
                                className="bg-primary/5 text-primary px-1 py-0.5 rounded-md border-none text-[10px] font-bold cursor-pointer hover:bg-primary/10 transition-colors focus:ring-1 focus:ring-primary/30"
                                value={item.tag_id || ''}
                                onChange={(e) => handleLibraryTagChange(item.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">未分類</option>
                                {tags.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary text-sm font-semibold truncate block max-w-[200px] hover:underline flex items-center gap-1"
                            >
                              查看原文 <ExternalLink size={12} />
                            </a>
                          </div>
                          <button
                            onClick={(e) => handleLibDelete(e, item.id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors bg-red-50/50"
                            title="刪除紀錄"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                              <Sparkles size={14} className="text-accent" />
                              摘要回顧
                            </h4>
                            <p className="text-sm text-text-muted line-clamp-3 leading-relaxed">
                              {item.summary}
                            </p>
                          </div>

                          <div className="pt-4 border-t border-slate-50 flex gap-3">
                            <button
                              onClick={() => {
                                updateTabState('home', { result: item });
                                setView('home');
                              }}
                              className="text-xs font-bold text-primary bg-primary/5 px-4 py-2 rounded-lg hover:bg-primary/10 transition-colors"
                            >
                              查看詳情
                            </button>
                            <button
                              onClick={() => copyToClipboard(item.transcript)}
                              className="text-xs font-bold text-text-muted bg-slate-50 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors"
                            >
                              複製逐字稿
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        ) : view === 'long-video' ? (
          /* Long Video View */
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-sm font-semibold mb-2 border border-indigo-100">
                <Clock size={16} />
                <span>Long Video Processing Engine</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
                長影音轉譯助手
              </h1>
              <p className="text-text-muted max-w-lg mx-auto text-lg leading-relaxed">
                支援長達 60 分鐘的 YouTube 影片。我們將自動分段處理、高精度轉錄並彙整重點。
              </p>
            </header>

            <section className="max-w-2xl mx-auto">
              <form onSubmit={handleLongSubmit} className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-indigo-400 group-focus-within:text-indigo-600 transition-colors">
                  <Youtube size={24} />
                </div>
                <input
                  type="text"
                  placeholder="貼上 YouTube 影片連結 (支援長影片)..."
                  className="input-field pl-16 pr-32 border-indigo-100 focus:border-indigo-300 focus:ring-indigo-100"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={currentTabState.isLoading}
                />
                <button
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-600 hover:bg-indigo-700 text-white !py-2.5 !px-5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                  disabled={currentTabState.isLoading || !url}
                >
                  {currentTabState.isLoading ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Send size={18} />
                  )}
                  <span>{currentTabState.isLoading ? '深層處理中...' : '開始轉譯'}</span>
                </button>
              </form>

              {/* Local File Upload Support - Long Video View */}
              <div className="mt-6 flex flex-col items-center">
                <label
                  htmlFor="transcribe-file-input"
                  className={`group flex items-center gap-3 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:border-primary/30 hover:bg-slate-50 transition-all shadow-sm hover:shadow-md cursor-pointer ${currentTabState.isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center text-indigo-500 transition-colors">
                    <Film size={20} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-slate-800">上傳長影音檔案</div>
                    <div className="text-xs text-slate-400">支援大於 25MB 的長時錄影或音訊</div>
                  </div>
                </label>
              </div>

              {currentTabState.isLoading && (
                <div className="mt-8 p-6 bg-indigo-50/50 border border-indigo-100 rounded-3xl text-center space-y-3 animate-pulse">
                  <div className="flex justify-center">
                    <Loader2 className="animate-spin text-indigo-600" size={32} />
                  </div>
                  <p className="text-indigo-900 font-semibold">正在處理長影音，這可能需要幾分鐘時間...</p>
                  <p className="text-sm text-indigo-600/70">我們正在提取音訊並進行智慧分段辨識，請勿關閉分頁。</p>
                </div>
              )}

              {currentTabState.error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle size={20} />
                  <p className="text-sm font-medium">{currentTabState.error}</p>
                </div>
              )}
            </section>

            {currentTabState.result && (
              <div className="grid grid-cols-1 gap-8 animate-in fade-in zoom-in duration-500">
                {/* Long Form Summary */}
                <BentoCard title="智慧結構化摘要" icon={Sparkles} className="border-indigo-50 shadow-indigo-50/50">
                  <div className="prose prose-sm max-w-none text-text-muted leading-relaxed whitespace-pre-wrap">
                    {currentTabState.result.summary}
                  </div>
                  {currentTabState.result.usage && (
                    <div className="mt-4 flex justify-end">
                      <div className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md font-mono border border-indigo-100 flex items-center gap-1">
                        <Coins size={10} className="text-amber-500" />
                        Usage: {currentTabState.result.usage.total_tokens || currentTabState.result.usage.totalTokenCount} tokens
                        {currentTabState.result.cost && ` ($${currentTabState.result.cost})`}
                      </div>
                    </div>
                  )}
                </BentoCard>

                {/* Full Scrollable Transcript */}
                <BentoCard title="完整逐字稿內容" icon={FileText} className="relative">
                  <button
                    onClick={() => copyToClipboard(currentTabState.result.transcript)}
                    className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-lg text-text-muted transition-colors flex items-center gap-2 text-xs font-bold"
                  >
                    <Copy size={16} />
                    複製全文
                  </button>
                  <div className="mt-4 p-6 bg-slate-50 rounded-2xl text-text-muted leading-relaxed max-h-[600px] overflow-y-auto pr-4 scrollbar-thin font-mono text-sm">
                    {currentTabState.result.transcript}
                  </div>
                </BentoCard>

                {/* Save Button for Long Video */}
                <div className="flex flex-col items-center gap-6">
                  {currentTabState.result.cost && (
                    <div className="flex items-center gap-2 text-sm text-text-muted bg-amber-50/50 px-4 py-2 rounded-xl border border-amber-100/50">
                      <Coins size={16} className="text-amber-500" />
                      <span>本次處理估計成本：<span className="font-mono font-bold">${currentTabState.result.cost}</span></span>
                    </div>
                  )}
                  {currentTabState.saveStatus === 'saved' ? (
                    <div className="bg-green-100 text-green-700 font-semibold px-12 py-4 rounded-2xl flex items-center justify-center gap-3 shadow-lg w-full max-w-md">
                      <CheckCircle2 size={24} />
                      <span className="text-lg">已儲存至資料庫</span>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row gap-4 items-center w-full max-w-2xl">
                      <select
                        className="w-full md:w-auto flex-1 bg-white border border-indigo-100 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-indigo-300 shadow-sm appearance-none"
                        value={currentTabState.selectedTagId}
                        onChange={(e) => updateTabState('long-video', { selectedTagId: e.target.value })}
                        style={{ background: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%236366f1\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E") no-repeat right 1.5rem center / 1.2rem' }}
                      >
                        <option value="">選擇分類標籤 (可不選)</option>
                        {tags.map(tag => (
                          <option key={tag.id} value={tag.id}>{tag.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleSave}
                        disabled={currentTabState.saveStatus === 'saving'}
                        className={`btn-primary !px-12 !py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50`}
                      >
                        {currentTabState.saveStatus === 'saving' ? <Loader2 className="animate-spin" /> : <BookMarked />}
                        <span className="text-lg">{currentTabState.saveStatus === 'saving' ? '正在儲存...' : '儲存轉譯結果'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : view === 'documents' ? (
          /* Document Center View */
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">知識文件庫</h1>
                <p className="text-text-muted mt-1">上傳 PDF、Word 或 TXT 文件，擴充 AI 的知識範圍。</p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-primary/40 shadow-sm min-w-40"
                  value={selectedDocTagId}
                  onChange={(e) => setSelectedDocTagId(e.target.value)}
                >
                  <option value="">選擇分類標籤</option>
                  {tags.map(tag => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
                <label htmlFor="doc-upload" className="cursor-pointer">
                  <div className={`btn-primary flex items-center gap-2 px-6 py-3 rounded-2xl ${docUploadStatus === 'uploading' ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {docUploadStatus === 'uploading' ? <Loader2 className="animate-spin" size={20} /> : <FileUp size={20} />}
                    <span>{docUploadStatus === 'uploading' ? '上傳中...' : (docUploadStatus === 'success' ? '完畢' : '上傳文件')}</span>
                  </div>
                </label>
                <input
                  id="doc-upload"
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt"
                  onChange={handleDocUpload}
                  onClick={(e) => { e.target.value = null; }}
                />
              </div>
            </div>

            {isDocLoading ? (
              <div className="flex flex-col items-center justify-center p-24 bg-white/50 rounded-4xl border border-slate-100">
                <Loader2 size={40} className="animate-spin text-primary" />
                <p className="text-slate-500 mt-4 font-medium italic">正在整理你的文件資料...</p>
              </div>
            ) : documentList.length === 0 ? (
              <div className="text-center py-24 bg-white/50 rounded-4xl border border-dashed border-border mt-12">
                <div className="bg-slate-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-text-light">
                  <FileBox size={32} />
                </div>
                <h3 className="text-xl font-semibold text-slate-800">知識庫尚無文件</h3>
                <p className="text-text-muted max-w-xs mx-auto mt-2 text-sm leading-relaxed">
                  上傳你的 PDF 手冊、營運計畫或任何 Word 文件。AI 將會學習其中的內容並整合到對話中。
                </p>
                <div className="mt-8 flex justify-center gap-3">
                  <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-400">PDF</div>
                  <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-400">WORD (DOCX)</div>
                  <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-400">TXT</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {documentList.map((doc) => (
                  <div key={doc.id} className="bento-card bg-white group hover:border-primary/20 transition-all hover:shadow-soft-xl">
                    <div className="flex justify-between items-start mb-6">
                      <div className="p-3 bg-slate-50 rounded-xl text-slate-400 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
                        <FileText size={28} />
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setPreviewDoc(doc)}
                          className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="預覽"
                        >
                          <Eye size={18} />
                        </button>
                        <a
                          href={`http://localhost:3001/uploads/${doc.filename}`}
                          download={doc.name}
                          className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="下載"
                        >
                          <Download size={18} />
                        </a>
                        <button
                          onClick={() => handleDocDelete(doc.id)}
                          disabled={deletingIds.has(doc.id)}
                          className={`p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all ${deletingIds.has(doc.id) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title="刪除"
                        >
                          {deletingIds.has(doc.id) ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <Trash2 size={18} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-800 truncate mb-1" title={doc.name}>
                        {doc.name}
                      </h3>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span>{doc.type.split('/')[1].toUpperCase()}</span>
                        <span>•</span>
                        <select
                          className="bg-slate-50 text-slate-500 px-1 py-0.5 rounded border-none text-[9px] font-bold cursor-pointer hover:bg-primary/5 hover:text-primary transition-colors focus:ring-1 focus:ring-primary/20"
                          value={doc.tag_id || ''}
                          onChange={(e) => handleDocTagChange(doc.id, e.target.value)}
                        >
                          <option value="">未分類</option>
                          {tags.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <span>•</span>
                        <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : view === 'tags' ? (
          /* Tag Management View */
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="text-left space-y-2">
              <h1 className="text-3xl font-bold text-slate-900">分類標籤管理</h1>
              <p className="text-text-muted mt-1">建立自定義標籤（如頻道名稱），以便在問答時進行精確過濾。</p>
            </header>

            <form onSubmit={handleCreateTag} className="flex gap-4 max-w-md">
              <input
                type="text"
                placeholder="輸入新標籤名稱 (例如: 老王不只三分鐘)..."
                className="w-full bg-white border border-slate-200 rounded-2xl py-3 px-6 focus:outline-none focus:border-primary/40 focus:bg-white transition-all shadow-sm text-slate-700"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                disabled={isTagLoading}
              />
              <button
                type="submit"
                className="btn-primary flex items-center gap-2 px-8 whitespace-nowrap"
                disabled={isTagLoading || !newTagName.trim()}
              >
                {isTagLoading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                <span>新增</span>
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tags.map(tag => (
                <div key={tag.id} className="bento-card bg-white flex items-center justify-between group p-6 rounded-3xl border border-slate-100 shadow-soft">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-50 text-slate-400 rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      <Search size={16} />
                    </div>
                    <span className="font-semibold text-slate-700">{tag.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {tags.length === 0 && (
                <div className="col-span-3 py-12 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                  <p className="text-slate-400 italic">尚未建立任何標籤</p>
                </div>
              )}
            </div>
          </div>
        ) : view === 'meeting' ? (
          /* Meeting Recorder View */
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full text-sm font-semibold mb-2 border border-red-100">
                <Mic size={16} />
                <span>Live Meeting Assistant</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
                即時錄音轉文字
              </h1>
              <p className="text-text-muted max-w-lg mx-auto text-lg leading-relaxed">
                將開會現場錄音即時轉化為結構化的會議紀要。
              </p>
            </header>

            <div className="max-w-xl mx-auto flex flex-col items-center gap-8">
              {/* Recorder Controls */}
              <div className="relative group p-12 bg-white rounded-5xl border border-slate-100 shadow-xl w-full flex flex-col items-center gap-6">

                {/* Visualizer Placeholder / Animation */}
                <div className="w-full h-32 flex items-center justify-center gap-1.5 overflow-hidden">
                  {[...Array(20)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 rounded-full transition-all duration-300 ${isRecording ? 'bg-primary' : 'bg-slate-200'}`}
                      style={{
                        height: isRecording ? `${Math.random() * 80 + 20}%` : '10%',
                        animation: isRecording ? `bounce 0.8s infinite ease-in-out ${i * 0.05}s` : 'none'
                      }}
                    />
                  ))}
                  <style>
                    {`
                      @keyframes bounce {
                        0%, 100% { transform: scaleY(1); }
                        50% { transform: scaleY(1.5); }
                      }
                    `}
                  </style>
                </div>

                <div className="text-4xl font-mono font-bold text-slate-700 tracking-wider">
                  {formatDuration(recordingDuration)}
                </div>

                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={currentTabState.isLoading}
                    className="w-24 h-24 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-2xl shadow-red-200 transition-all hover:scale-110 active:scale-95 group"
                  >
                    <div className="w-10 h-10 rounded-full bg-white group-hover:scale-90 transition-all"></div>
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="w-24 h-24 rounded-full bg-slate-800 hover:bg-slate-900 flex items-center justify-center text-white shadow-2xl shadow-slate-200 transition-all hover:scale-110 active:scale-95"
                  >
                    <div className="w-10 h-10 bg-white rounded-lg"></div>
                  </button>
                )}

                <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest">
                  {isRecording ? "正在收音中..." : "點擊按鈕開始錄音"}
                </div>
              </div>

              {currentTabState.isLoading && (
                <div className="p-6 bg-primary/5 rounded-3xl text-center space-y-3 w-full animate-pulse border border-primary/10">
                  <div className="flex justify-center">
                    <Loader2 className="animate-spin text-primary" size={32} />
                  </div>
                  <p className="text-primary font-bold">正在整理會議紀錄，請稍候...</p>
                  <p className="text-xs text-primary/60">我們正在將錄下音訊交由 AI 轉譯並摘要重點。</p>
                </div>
              )}
            </div>

            {currentTabState.result && !currentTabState.isLoading && (
              <div className="grid grid-cols-1 gap-8 animate-in fade-in zoom-in duration-500">
                {/* Meeting Minutes Summary */}
                <BentoCard title="會議紀要 (AI 摘要)" icon={Sparkles} className="border-indigo-50 shadow-indigo-50/50">
                  <div className="prose prose-sm max-w-none text-text-muted leading-relaxed whitespace-pre-wrap">
                    {currentTabState.result.summary}
                  </div>
                  {currentTabState.result.usage && (
                    <div className="mt-4 flex justify-end">
                      <div className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md font-mono border border-slate-100 flex items-center gap-1">
                        <Coins size={10} className="text-amber-500" />
                        Usage: {currentTabState.result.usage.total_tokens || currentTabState.result.usage.totalTokenCount} tokens
                        {currentTabState.result.cost && ` ($${currentTabState.result.cost})`}
                      </div>
                    </div>
                  )}
                </BentoCard>

                {/* Full Transcript */}
                <BentoCard title="會議完整逐字稿" icon={FileText}>
                  <div className="mt-4 p-6 bg-slate-50 rounded-2xl text-text-muted leading-relaxed max-h-96 overflow-y-auto font-mono text-sm">
                    {currentTabState.result.transcript}
                  </div>
                </BentoCard>

                {/* Save with Tag */}
                <div className="flex flex-col items-center gap-6">
                  {currentTabState.result.cost && (
                    <div className="flex items-center gap-2 text-sm text-text-muted bg-amber-50/50 px-4 py-2 rounded-xl border border-amber-100/50">
                      <Coins size={16} className="text-amber-500" />
                      <span>會議處理估計成本：<span className="font-mono font-bold">${currentTabState.result.cost}</span></span>
                    </div>
                  )}
                  <div className="flex gap-4 items-center">
                    <select
                      className="bg-white border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/40 shadow-sm min-w-48"
                      value={currentTabState.selectedTagId}
                      onChange={(e) => updateTabState('meeting', { selectedTagId: e.target.value })}
                    >
                      <option value="">選擇分類標籤 (如：會議紀錄)</option>
                      {tags.map(tag => (
                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleSave}
                      disabled={currentTabState.saveStatus === 'saving' || currentTabState.saveStatus === 'saved'}
                      className={`btn-primary !py-3 !px-8 flex items-center gap-2 shadow-xl ${currentTabState.saveStatus === 'saved' ? 'bg-green-500 hover:bg-green-500' : 'bg-primary'}`}
                    >
                      {currentTabState.saveStatus === 'saving' ? <Loader2 className="animate-spin" /> : <BookMarked />}
                      <span>{currentTabState.saveStatus === 'saved' ? '已儲存至知識庫' : '將會議內容正式存檔'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Chat View */
          <div className="flex bg-white rounded-4xl border border-border shadow-soft-xl overflow-hidden h-[700px] animate-in fade-in zoom-in duration-500">
            {/* Thread Sidebar */}
            <div className={`bg-slate-50 border-r border-slate-100 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'w-72' : 'w-0 opacity-0 overflow-hidden'}`}>
              <div className="p-4 border-b border-slate-200/50 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-sm">歷史對話</h3>
                <button
                  onClick={createNewChat}
                  className="p-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                  title="開啟新對話"
                >
                  <Sparkles size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {threads.map(thread => (
                  <div
                    key={thread.id}
                    onClick={() => loadThreadMessages(thread.id)}
                    className={`group p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all ${currentThreadId === thread.id ? 'bg-primary text-white shadow-md' : 'hover:bg-white text-slate-600'}`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText size={14} className={currentThreadId === thread.id ? 'text-white/70' : 'text-slate-400'} />
                      <span className="text-sm font-medium truncate">{thread.title}</span>
                    </div>
                    <button
                      onClick={(e) => handleThreadDelete(e, thread.id)}
                      className={`p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white rounded-lg transition-all relative z-10 ${currentThreadId === thread.id ? 'hover:bg-white/20' : ''}`}
                      title="刪除對話"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {threads.length === 0 && (
                  <p className="text-xs text-center text-slate-400 mt-8">尚無歷史對話</p>
                )}
              </div>
            </div>

            {/* Main Chat Interface */}
            <div className="flex-1 flex flex-col relative h-full min-w-0">
              {/* Sidebar Toggle */}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1.5 bg-white border border-border rounded-r-xl shadow-md transition-transform hover:scale-110 ${!isSidebarOpen ? 'rotate-180' : ''}`}
              >
                <ChevronLeft size={16} className="text-slate-400" />
              </button>

              {/* Chat Header */}
              <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-center gap-4 flex-1">
                  <div className="p-2.5 bg-primary rounded-xl text-white shadow-lg shadow-primary/20">
                    <Sparkles size={20} />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-900">
                      {currentThreadId
                        ? (threads.find(t => t.id === currentThreadId)?.title || '讀取中...')
                        : '新對話庫查詢'}
                    </h2>
                    <div className="flex items-center gap-2 text-[10px] text-text-muted font-medium uppercase tracking-wider mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                      <span>RAG 模式：已連接歷史資料庫</span>
                    </div>
                  </div>
                  {/* Tag Filter Dropdown */}
                  {!currentThreadId && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-bold">過濾來源:</span>
                      <select
                        className="bg-white border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary/40 shadow-sm"
                        value={chatFilterTagId}
                        onChange={(e) => setChatFilterTagId(e.target.value)}
                      >
                        <option value="">全部來源</option>
                        {tags.map(tag => (
                          <option key={tag.id} value={tag.id}>{tag.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 scrollbar-thin">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <div className="p-8 bg-slate-50 rounded-full border border-slate-100">
                      <Search size={48} className="text-slate-300" />
                    </div>
                    <div className="max-w-xs px-4">
                      <p className="font-bold text-xl text-slate-800">開始提問</p>
                      <p className="text-sm mt-2 leading-relaxed">AI 會根據你儲存過的影音逐字稿與過往對話脈絡來回答問題。</p>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`max-w-[85%] p-4 md:p-5 rounded-2xl ${msg.role === 'user'
                        ? 'bg-primary text-white shadow-lg shadow-primary/10 rounded-tr-none'
                        : 'bg-slate-50 border border-slate-100 text-slate-800 rounded-tl-none'
                        }`}>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>

                        {msg.role === 'assistant' && (msg.cost || msg.usage) && (
                          <div className="mt-2 flex justify-end gap-2">
                            {msg.usage && (
                              <span className="text-[9px] text-slate-400 bg-white/50 px-1.5 py-0.5 rounded border border-slate-100 font-mono">
                                Tokens: {msg.usage.total_tokens || msg.usage.totalTokenCount}
                              </span>
                            )}
                            {msg.cost && (
                              <span className="text-[9px] text-slate-400 bg-white/50 px-1.5 py-0.5 rounded border border-slate-100 font-mono">
                                Cost: ${msg.cost}
                              </span>
                            )}
                          </div>
                        )}

                        {msg.sources && msg.sources.length > 0 && (
                          <div className={`mt-4 pt-4 border-t flex flex-wrap gap-2 ${msg.role === 'user' ? 'border-white/20' : 'border-slate-200/50'}`}>
                            <span className={`text-[10px] uppercase font-bold block w-full ${msg.role === 'user' ? 'text-white/60' : 'text-slate-400'}`}>
                              參考來源：
                            </span>
                            {msg.sources.map(src => (
                              <a
                                key={src.id}
                                href={src.url}
                                target="_blank"
                                rel="noreferrer"
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${msg.role === 'user'
                                  ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                                  : 'bg-white border border-slate-200 text-primary hover:border-primary/30 shadow-sm'
                                  }`}
                              >
                                {src.type === 'doc' ? <FileText size={12} /> : <ExternalLink size={12} />}
                                {src.name || (src.type === 'reel' ? 'Reel 原文' : '文件原文')}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl rounded-tl-none flex items-center gap-3">
                      <Loader2 className="animate-spin text-primary" size={20} />
                      <span className="text-sm text-text-muted font-medium italic">閱覽資料庫並思考中...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-6 bg-white border-t border-slate-50">
                <form onSubmit={handleChat} className="relative flex items-center gap-3 max-w-4xl mx-auto w-full">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={currentThreadId ? "繼續討論或是提問..." : "輸入您的問題..."}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:border-primary/40 focus:bg-white transition-all shadow-inner-soft text-slate-700"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isChatLoading}
                    className="absolute right-3 p-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark transition-all disabled:opacity-40 shadow-lg shadow-primary/20"
                  >
                    <Send size={20} />
                  </button>
                </form>
                <p className="text-[10px] text-center text-slate-300 mt-4 uppercase tracking-widest font-bold">
                  Powered by IG-Transcribe Intelligence
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {
        previewDoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setPreviewDoc(null)}></div>
            <div className="relative bg-white w-full max-w-5xl h-full rounded-4xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-primary rounded-xl text-white">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 truncate max-w-md">{previewDoc.name}</h2>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{previewDoc.type}</p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="p-3 hover:bg-slate-200 rounded-2xl text-slate-400 transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-hidden bg-slate-100">
                {previewDoc.type === 'application/pdf' ? (
                  <iframe
                    src={`http://localhost:3001/uploads/${previewDoc.filename}`}
                    className="w-full h-full border-none"
                    title="PDF Preview"
                  />
                ) : (
                  <div className="w-full h-full bg-white p-12 overflow-y-auto">
                    <div className="max-w-3xl mx-auto">
                      <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100">
                        <p className="text-xs text-slate-400 font-bold uppercase mb-8 border-b border-slate-200 pb-4">
                          提取出的文字內容 ({previewDoc.type === 'text/plain' ? 'TXT 預覽' : 'Word 預覽'})
                        </p>
                        <div className="prose prose-slate max-w-none">
                          <p className="text-slate-600 leading-relaxed whitespace-pre-wrap italic">
                            注意：這是從文件中提取出的純文字內容，AI 將依此內容進行學習。
                          </p>
                          <div className="mt-8 text-slate-800 text-lg leading-loose">
                            {previewDoc.type === 'text/plain' ? (
                              <div className="whitespace-pre-wrap font-sans text-base">
                                {previewDoc.content}
                              </div>
                            ) : (
                              <>
                                這是一個 Word 檔案。為了最佳閱讀體驗（含格式、圖表），請點擊右上角「下載」按鈕。
                                <br /><br />
                                AI 目前已完整學習此文件的文字脈絡。
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-slate-100 flex justify-end gap-4 bg-white">
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
                >
                  關閉
                </button>
                <a
                  href={`http://localhost:3001/uploads/${previewDoc.filename}`}
                  download={previewDoc.name}
                  className="btn-primary flex items-center gap-2"
                >
                  <Download size={20} />
                  <span>下載原始檔案</span>
                </a>
              </div>
            </div>
          </div>
        )
      }
      {/* Custom Delete Confirmation Modal */}
      {
        showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setShowDeleteConfirm(false)}></div>
            <div className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-300 border border-slate-100">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2">
                  <Trash2 size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900">確定要刪除嗎？</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    刪除後將無法還原此對話紀錄與相關訊息。
                  </p>
                </div>
                <div className="flex gap-3 w-full pt-4">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmDeleteThread}
                    className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                  >
                    確定刪除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* Custom Document Delete Confirmation Modal */}
      {
        showDocDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setShowDocDeleteConfirm(false)}></div>
            <div className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-300 border border-slate-100">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2">
                  <Trash2 size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900">確定要刪除文件嗎？</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    刪除後 AI 將無法再參考此文件的內容，且無法還原。
                  </p>
                </div>
                <div className="flex gap-3 w-full pt-4">
                  <button
                    onClick={() => setShowDocDeleteConfirm(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmDeleteDoc}
                    className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                  >
                    確定刪除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* Custom Library Delete Confirmation Modal */}
      {
        showLibDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setShowLibDeleteConfirm(false)}></div>
            <div className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-300 border border-slate-100">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2">
                  <Trash2 size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900">確定要刪除這筆紀錄嗎？</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    刪除後將無法從資料庫中還原此逐字稿與摘要紀錄。
                  </p>
                </div>
                <div className="flex gap-3 w-full pt-4">
                  <button
                    onClick={() => setShowLibDeleteConfirm(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmDeleteLib}
                    className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                  >
                    確定刪除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* Error Modal */}
      {errorMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setErrorMessage(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200 border border-slate-100">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <AlertCircle className="text-red-500" size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2 text-center">發生錯誤</h3>
            <p className="text-slate-500 text-center mb-8">{errorMessage}</p>
            <button
              onClick={() => setErrorMessage(null)}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-colors shadow-lg"
            >
              確定
            </button>
          </div>
        </div>
      )}
    </div >
  );
}

export default App;
