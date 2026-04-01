import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    MessageSquare,
    FileText,
    CheckSquare,
    Upload,
    Send,
    BookOpen,
    Loader2,
    Plus,
    User,
    Settings,
    HelpCircle,
    LogOut,
    X,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    Trash2,
    Menu,
    Calendar,
    Brain,
    Target,
    Search,
    Timer,
    GraduationCap,
    Bookmark,
    Network,
    BarChart3,
    Trophy,
    Maximize2,
    Minimize2,
    Layers,
    Zap,
    PanelRight,
    Check,
    Eye,
    EyeOff,
    WifiOff
} from 'lucide-react';
import {
    uploadDocument,
    getDocuments,
    getChatHistory, // Imported
    chatMessage,
    chatMessageStream, // Imported
    generateMCQ,
    submitEvaluation,
    getTopics,
    getProjectSummary,
    generateSubjectiveTest,
    submitSubjectiveTest,
    deleteDocument,
    generateNotes,
    getLearningProgress,
    saveLearningProgress,
    generateMindmap,
    generateFlashcardsWithAI,
    subscribeDocumentProgress,
} from '../api';
import { useToast } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import { useGamification } from '../context/GamificationContext';
import { recordActivity } from '../utils/studyActivity';
import { supabase } from '../supabaseClient';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import UploadZone from '../components/UploadZone';
import { getRotatingLoadingMessage, getRandomLoadingMessage } from '../utils/LoadingMessages';

// View Components
import QuizView from '../components/views/QuizView';
import QAView from '../components/views/QAView';
import NotesView from '../components/views/NotesView';
import StudyDashboard from '../components/views/StudyDashboard';
import LearningPathView from '../components/views/LearningPathView';
import AdvancedAnalytics from '../components/views/AdvancedAnalytics';
import KnowledgeGraphView from '../components/views/KnowledgeGraphView';
import TopicMindmap from '../components/views/TopicMindmap';
import TopicFlashcards from '../components/views/TopicFlashcards';
import FlashcardsView from '../components/views/FlashcardsView';
import MindmapView from '../components/views/MindmapView';


// Utility Components
import PomodoroTimer from '../components/PomodoroTimer';
import AITutorChat from '../components/AITutorChat';
import BookmarksPanel from '../components/BookmarksPanel';
import GlobalSearch from '../components/GlobalSearch';
import GamificationPanel from '../components/GamificationPanel';
import { ProjectViewSkeleton } from '../components/Skeleton';
import AddDocumentModal from '../components/AddDocumentModal';


// Chat Agentic Components
import { CommandPicker, CommandParamForm } from '../components/chat/ChatCommands';
import PDFViewer from '../components/chat/PDFViewer';
import ErrorBoundary from '../components/ErrorBoundary';

const ProjectView = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { settings } = useSettings();
    const { data: gamificationData } = useGamification();
    const [showGamification, setShowGamification] = useState(false);
    const [activeTab, setActiveTab] = useState(() => {
        return sessionStorage.getItem(`lumina_tab_${projectId}`) || 'path';
    });
    const [messages, setMessages] = useState([]);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (activeTab === 'chat') {
            // Use a slight delay to ensure DOM has updated before scrolling
            setTimeout(() => {
                scrollToBottom();
            }, 50);
        }
    }, [messages, activeTab]);

    // Session cache keys
    const chatCacheKey = `lumina_chat_${projectId}`;

    // Persist activeTab to sessionStorage
    useEffect(() => {
        sessionStorage.setItem(`lumina_tab_${projectId}`, activeTab);
        // Dismiss mindmap/flashcard overlays when switching tabs
        setMindmapTopic(null);
        setMindmapDocs([]);
        setFlashcardTopic(null);
        setFlashcardDocs([]);
    }, [activeTab, projectId]);

    // Persist chat messages to sessionStorage
    useEffect(() => {
        if (messages.length > 0) {
            sessionStorage.setItem(chatCacheKey, JSON.stringify(messages));
        }
    }, [messages, chatCacheKey]);
    const [inputMessage, setInputMessage] = useState('');
    const [documents, setDocuments] = useState([]);
    const [selectedDocuments, setSelectedDocuments] = useState([]);
    const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
    const [deleteConfirmDoc, setDeleteConfirmDoc] = useState(null);
    const [deletingDocIds, setDeletingDocIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [isProcessingDocs, setIsProcessingDocs] = useState(true);
    // Per-document SSE stage: { [docId]: 'extracting'|'chunking'|'embedding'|'topics'|'graph'|'completed'|'failed' }
    const [docStages, setDocStages] = useState({});
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
    const [showRightSidebarUpload, setShowRightSidebarUpload] = useState(false);
    const [isMobileDocsOpen, setIsMobileDocsOpen] = useState(false);
    const [isRightCollapsed, setIsRightCollapsed] = useState(false);

    // Derived: force expanded when mobile drawers open
    const leftCollapsed = isLeftCollapsed && !isMobileMenuOpen;

    // New Feature States
    const [showSearch, setShowSearch] = useState(false);
    const [showPomodoro, setShowPomodoro] = useState(false);
    const [showAITutor, setShowAITutor] = useState(false);
    const [showBookmarks, setShowBookmarks] = useState(false);
    const [showAddDocModal, setShowAddDocModal] = useState(false);
    const [zenMode, setZenMode] = useState(false);
    const [tutorTopic, setTutorTopic] = useState(null);
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    // Topics State
    const [availableTopics, setAvailableTopics] = useState([]);
    const [allProjectTopics, setAllProjectTopics] = useState([]);
    const [documentTopics, setDocumentTopics] = useState({});

    // Learning Path Integration State
    const [preSelectedTopic, setPreSelectedTopic] = useState(null);
    const [preSelectedQuizMode, setPreSelectedQuizMode] = useState(null);
    const [cameFromPath, setCameFromPath] = useState(false);

    // Pre-generated data from chat @ commands (passed to views via "Open" button)
    const [preGeneratedNotes, setPreGeneratedNotes] = useState(null);
    const [preGeneratedQA, setPreGeneratedQA] = useState(null);
    const [preGeneratedQuiz, setPreGeneratedQuiz] = useState(null);

    // Mindmap & Flashcards State (shown inline, only from learning path)
    const [mindmapTopic, setMindmapTopic] = useState(null);
    const [mindmapDocs, setMindmapDocs] = useState([]);
    const [flashcardTopic, setFlashcardTopic] = useState(null);
    const [flashcardDocs, setFlashcardDocs] = useState([]);

    // Learning Progress (persisted in Supabase)
    const [learningProgress, setLearningProgress] = useState(new Set());

    // Load learning progress from API
    useEffect(() => {
        const loadProgress = async () => {
            try {
                const data = await getLearningProgress(projectId);
                if (data.completed_topics && data.completed_topics.length > 0) {
                    setLearningProgress(new Set(data.completed_topics));
                }
            } catch (err) {
                console.warn('Failed to load learning progress:', err);
            }
        };
        loadProgress();
    }, [projectId]);

    // PDF Viewer State
    const [activePDF, setActivePDF] = useState(null);

    // Quiz/Q&A Active State (hides sidebars during generation/active)
    const [isQuizActive, setIsQuizActive] = useState(false);
    const [isQAActive, setIsQAActive] = useState(false);

    // Combined sidebar hidden state
    const isSidebarHidden = isQuizActive || isQAActive || zenMode;

    // File Upload Ref
    const fileInputRef = useRef(null);

    // @ Command System State
    const [showCommandPicker, setShowCommandPicker] = useState(false);
    const [commandFilter, setCommandFilter] = useState('');
    const [activeCommand, setActiveCommand] = useState(null); // command object when param form is shown
    const [toolLoading, setToolLoading] = useState(false);

    // Add loading state for ProjectView
    const [projectViewLoading, setProjectViewLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);

    // Ref to ensure fetchTopics is only called once per mount, not on every tab change
    const topicsFetchedRef = useRef(false);

    useEffect(() => {
        let intervalId;
        
        const rotationInterval = setInterval(() => {
            setLoadingMsgIdx(i => i + 1);
        }, 3000);

        // Helper to check if any document is still processing
        const isAnyDocProcessing = (docs) => {
            if (!docs || docs.length === 0) return false;
            return docs.some(d =>
                d.upload_status === 'pending' ||
                d.upload_status === 'processing' ||
                d.upload_status === 'embedding' ||
                d.upload_status === 'queued'
            );
        };

        // Helper to check if any document has failed
        const isAnyDocFailed = (docs) => {
            if (!docs || docs.length === 0) return false;
            return docs.some(d => d.upload_status === 'failed');
        };

        const initialLoad = async () => {
            // 10s hard timeout — skeleton must never hang forever
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 10000)
            );

            let docData = null;
            try {
                docData = await Promise.race([fetchDocuments(), timeoutPromise]);
            } catch (err) {
                console.warn('Initial document load failed or timed out:', err.message);
                setFetchError(true);
                setProjectViewLoading(false);
                clearInterval(rotationInterval);
                return;
            }

            // Restore chat messages from session cache, or start fresh
            const cachedMessages = sessionStorage.getItem(`lumina_chat_${projectId}`);
            if (cachedMessages) {
                try {
                    const parsed = JSON.parse(cachedMessages);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        setMessages(parsed);
                    } else {
                        setMessages([{ role: 'system', content: 'Ready to chat! Ask me anything about your documents.' }]);
                    }
                } catch {
                    setMessages([{ role: 'system', content: 'Ready to chat! Ask me anything about your documents.' }]);
                }
            } else {
                setMessages([{ role: 'system', content: 'Ready to chat! Ask me anything about your documents.' }]);
            }

            const docs = docData?.documents || [];
            const processingDocs = docs.filter(d =>
                d.upload_status === 'pending' ||
                d.upload_status === 'processing' ||
                d.upload_status === 'embedding' ||
                d.upload_status === 'queued'
            );
            const docsProcessing = processingDocs.length > 0;
            setIsProcessingDocs(docsProcessing);
            setProjectViewLoading(false);

            if (!docsProcessing) {
                fetchTopics();
                topicsFetchedRef.current = true;
                return;
            }

            // Open one SSE connection per processing document.
            // Each stream delivers live stage events: extracting → chunking → embedding → topics → graph → completed/failed.
            // Topics are fetched exactly once when the FIRST doc completes.
            const sseCleanups = [];

            processingDocs.forEach((doc) => {
                const cleanup = subscribeDocumentProgress(
                    doc.id,
                    async (event) => {
                        const { stage } = event;

                        // Update per-doc stage label in real time
                        setDocStages(prev => ({ ...prev, [doc.id]: stage }));

                        if (stage === 'completed' || stage === 'failed') {
                            // Refresh this document's status from DB to get error_message etc.
                            const refreshed = await fetchDocuments();
                            const remaining = (refreshed?.documents || []).filter(d =>
                                d.upload_status === 'pending' ||
                                d.upload_status === 'processing' ||
                                d.upload_status === 'embedding' ||
                                d.upload_status === 'queued'
                            );
                            if (remaining.length === 0) {
                                setIsProcessingDocs(false);
                                if (!topicsFetchedRef.current) {
                                    fetchTopics();
                                    topicsFetchedRef.current = true;
                                }
                            }
                        }
                    },
                    (err) => {
                        // SSE failed (network drop etc.) — fall back to one-time poll
                        console.warn(`SSE connection lost for doc ${doc.id}, falling back to poll`);
                        setTimeout(() => fetchDocuments(), 5000);
                    }
                );
                sseCleanups.push(cleanup);
            });

            // Store cleanups so the outer return() can close all SSE connections on unmount
            intervalId = { close: () => sseCleanups.forEach(fn => fn()) };
        };

        initialLoad();

        return () => {
            if (intervalId?.close) intervalId.close();
            else clearInterval(intervalId);
            clearInterval(rotationInterval);
        };
    }, [projectId]);

    const fetchDocuments = async () => {
        try {
            const data = await getDocuments(projectId);
            setDocuments(data.documents || []);
            return data;
        } catch (error) {
            console.error("Failed to fetch documents", error);
            return null;
        }
    };

    const fetchTopics = async () => {
        try {
            const data = await getTopics(projectId);
            if (data.all && data.by_doc) {
                setAllProjectTopics(data.all);
                setDocumentTopics(data.by_doc);
            } else if (Array.isArray(data)) {
                setAvailableTopics(data);
                setAllProjectTopics(data);
            }
        } catch (error) {
            console.error('Failed to fetch topics', error);
        }
    };

    // fetchTopics on tab change — only if topics haven't been loaded yet
    useEffect(() => {
        if (!isProcessingDocs && !topicsFetchedRef.current) {
            if (activeTab === 'chat' || activeTab === 'quiz' || activeTab === 'qa' || activeTab === 'notes' || activeTab === 'path') {
                fetchTopics();
                topicsFetchedRef.current = true;
            }
        }
    }, [activeTab, projectId, isProcessingDocs]);

    // Filter topics based on selected documents
    useEffect(() => {
        // Only filter if we actually have document-topic mappings
        // This handles the fallback case where API returns just an array (no by_doc mapping)
        const hasMappings = Object.keys(documentTopics).length > 0;

        if (selectedDocuments.length > 0 && hasMappings) {
            const filtered = new Set();
            selectedDocuments.forEach(docId => {
                const docSpecific = documentTopics[docId];
                if (docSpecific && docSpecific.length > 0) {
                    docSpecific.forEach(t => filtered.add(t));
                }
            });
            // If we have selected docs but no topics found for them yet, 
            // filtered set is empty. 
            // Logic: "Only show topics of selected". So show empty (or maybe show all if empty? No, empty is correct for strict filtering).
            setAvailableTopics(Array.from(filtered).sort());
        } else {
            // If nothing selected (Global) OR we don't have mappings, show ALL.
            setAvailableTopics(allProjectTopics);
        }
    }, [selectedDocuments, documentTopics, allProjectTopics]);

    // Default Selection: If only 1 document, select it.
    useEffect(() => {
        if (documents.length === 1 && selectedDocuments.length === 0) {
            // Need to pass array to setSelectedDocuments?
            // Wait, setSelectedDocuments is passed from context or protected route?
            // No, it's not defined in ProjectView props usually.
            // Let's check where selectedDocuments comes from.
            // It's likely state in ProjectView.
            // Lines 70-80 usually define it.
            if (typeof setSelectedDocuments === 'function') {
                setSelectedDocuments([documents[0].id]);
            }
        }
    }, [documents]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ctrl+K or Cmd+K for search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setShowSearch(true);
            }
            // Ctrl+Shift+Z or Cmd+Shift+Z for zen mode toggle
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                setZenMode(prev => !prev);
            }
            // Escape to close modals or exit zen mode
            if (e.key === 'Escape') {
                if (zenMode) { setZenMode(false); return; }
                if (showSearch) setShowSearch(false);
                if (showPomodoro) setShowPomodoro(false);
                if (showAITutor) setShowAITutor(false);
                if (showBookmarks) setShowBookmarks(false);
                if (showGamification) setShowGamification(false);
                if (showProfileMenu) setShowProfileMenu(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [showSearch, showPomodoro, showAITutor, showBookmarks, zenMode]);

    // Close profile menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (showProfileMenu && !e.target.closest('.profile-dropdown')) {
                setShowProfileMenu(false);
            }
        };

        if (showProfileMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showProfileMenu]);

    const [showSummary, setShowSummary] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [summaryLoading, setSummaryLoading] = useState(false);

    const toggleSummary = async () => {
        if (!showSummary) {
            // Show the popup immediately with loading state
            setShowSummary(true);
            // Then fetch the summary
            await fetchSummary();
        } else {
            setShowSummary(false);
        }
    };

    const fetchSummary = async () => {
        setSummaryLoading(true);
        // Clear previous content to avoid confusion
        setSummaryContent('');
        try {
            const response = await getProjectSummary(projectId, selectedDocuments);
            setSummaryContent(response.answer);
        } catch (error) {
            console.error("Summary error", error);
            setSummaryContent("Could not retrieve summary. Please try again.");
        } finally {
            setSummaryLoading(false);
        }
    };

    const handleNewSession = () => {
        setMessages([{ role: 'system', content: 'Ready to chat! Ask me anything about your documents.' }]);
        setInputMessage('');
        setActiveCommand(null);
        setShowCommandPicker(false);
        sessionStorage.removeItem(chatCacheKey);
    };

    // --- @ Command: Input change handler ---
    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputMessage(val);

        // Detect @ at start of input or after space
        const atMatch = val.match(/(?:^|\s)@(\w*)$/);
        if (atMatch) {
            setCommandFilter(atMatch[1]);
            setShowCommandPicker(true);
        } else {
            setShowCommandPicker(false);
            setCommandFilter('');
        }
    };

    // --- @ Command: Select a command from picker ---
    const handleCommandSelect = (command) => {
        setShowCommandPicker(false);
        setCommandFilter('');
        setInputMessage('');
        setActiveCommand(command);
    };

    // --- @ Command: Execute a tool command ---
    const handleToolExecute = async (toolType, params) => {
        if (selectedDocuments.length === 0) {
            toast.warning('Please select at least one document from the sidebar first.');
            return;
        }

        setActiveCommand(null);
        setToolLoading(true);

        // Build a user-facing label for what was requested
        const labels = {
            notes: `@Notes — ${params.noteType || 'Summary'}${params.topic ? ` about "${params.topic}"` : ''}`,
            qa: `@Q&A${params.topic ? ` about "${params.topic}"` : ''} — ${params.numQuestions || 5} questions (${params.answerSize || 'medium'})`,
            quiz: `@Quiz${params.topic ? ` about "${params.topic}"` : ''} — ${params.numQuestions || 5} MCQs (${params.difficulty || 'medium'})`,
            mindmap: `@Mindmap — "${params.topic}"`,
            flashcards: `@Flashcards — "${params.topic}" (${params.numCards || 8} cards)`,
        };

        // Add user command message
        setMessages(prev => [...prev,
        { role: 'user', content: labels[toolType] || `@${toolType}`, type: 'tool_command' },
        { role: 'assistant', type: 'tool_loading', toolType, toolParams: params }
        ]);

        try {
            let result;
            switch (toolType) {
                case 'notes':
                    result = await generateNotes(projectId, params.noteType, params.topic || '', selectedDocuments);
                    break;
                case 'qa':
                    result = await generateSubjectiveTest(projectId, params.topic || '', parseInt(params.numQuestions) || 5, selectedDocuments, params.answerSize || 'medium');
                    break;
                case 'quiz':
                    result = await generateMCQ(projectId, params.topic || '', parseInt(params.numQuestions) || 5, selectedDocuments, params.difficulty || 'medium');
                    break;
                case 'mindmap':
                    result = await generateMindmap(
                        projectId,
                        params.title || `${params.topic} - Mindmap`,
                        params.topic,
                        selectedDocuments
                    );
                    break;
                case 'flashcards':
                    result = await generateFlashcardsWithAI(
                        projectId,
                        params.topic,
                        parseInt(params.numCards) || 10,
                        selectedDocuments
                    );
                    break;
                default:
                    throw new Error(`Unknown tool: ${toolType}`);
            }

            // Replace loading card with result card
            setMessages(prev => {
                const updated = [...prev];
                const loadingIdx = updated.findLastIndex(m => m.type === 'tool_loading' && m.toolType === toolType);
                if (loadingIdx !== -1) {
                    updated[loadingIdx] = {
                        role: 'assistant',
                        type: 'tool_result',
                        toolType,
                        toolParams: params,
                        toolData: result,
                    };
                }
                return updated;
            });

            recordActivity(projectId, toolType === 'notes' ? 'notes' : toolType === 'qa' ? 'qa' : 'chat');
        } catch (error) {
            console.error(`Tool ${toolType} error:`, error);
            // Replace loading card with error card
            setMessages(prev => {
                const updated = [...prev];
                const loadingIdx = updated.findLastIndex(m => m.type === 'tool_loading' && m.toolType === toolType);
                if (loadingIdx !== -1) {
                    updated[loadingIdx] = {
                        role: 'assistant',
                        type: 'tool_error',
                        toolType,
                        toolParams: params,
                        error: error?.response?.data?.detail || error.message || 'Generation failed',
                    };
                }
                return updated;
            });
        } finally {
            setToolLoading(false);
        }
    };

    // --- @ Command: Open result in its dedicated view ---
    const handleToolOpen = (toolType, toolParams, toolData) => {
        const topic = toolParams?.topic || '';
        switch (toolType) {
            case 'notes':
                if (topic) setPreSelectedTopic(topic);
                // Pass pre-generated notes content + noteType so the view displays it directly
                setPreGeneratedNotes({
                    content: toolData?.content || '',
                    noteType: toolParams?.noteType || 'Comprehensive Summary',
                    topic: topic,
                });
                setActiveTab('notes');
                break;
            case 'qa':
                if (topic) setPreSelectedTopic(topic);
                // Pass pre-generated Q&A data so the view displays it directly
                setPreGeneratedQA(toolData);
                setActiveTab('qa');
                break;
            case 'quiz':
                if (topic) setPreSelectedTopic(topic);
                // Pass pre-generated quiz data so the view displays it directly
                setPreGeneratedQuiz(toolData);
                setActiveTab('quiz');
                break;
            case 'mindmap':
                setActiveTab('mindmap');
                toast.success('Mindmap generated! Opening Mindmaps view...');
                break;
            case 'flashcards':
                setActiveTab('flashcards');
                toast.success('Flashcards generated! Opening Flashcards view...');
                break;
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputMessage.trim() || loading) return;

        if (selectedDocuments.length === 0) {
            toast.warning('Please select at least one document from the sidebar to start chatting.');
            return;
        }

        const userMsg = inputMessage;
        // Add user message immediately
        const newMessages = [...messages, { role: 'user', content: userMsg }];
        setMessages(newMessages);
        setInputMessage('');
        setLoading(true);

        // Create a placeholder for the assistant's response
        setMessages(prev => [...prev, { role: 'assistant', content: '', sources: [] }]);

        try {
            const history = newMessages
                .filter(m => m.role !== 'system' && (!m.type || m.type === 'tool_command'))
                .map(m => ({
                    role: m.role,
                    content: m.content || ''
                }));

            await chatMessageStream(
                projectId,
                userMsg,
                history,
                selectedDocuments,
                (chunkText) => {
                    // Update the last message (assistant's placeholder) with current chunk text
                    setMessages(prev => {
                        const updated = [...prev];
                        const lastMsg = updated[updated.length - 1];
                        if (lastMsg.role === 'assistant') {
                            lastMsg.content = chunkText;
                        }
                        return updated;
                    });
                },
                (finalResult) => {
                    // Final update with sources
                    setMessages(prev => {
                        const updated = [...prev];
                        const lastMsg = updated[updated.length - 1];
                        if (lastMsg.role === 'assistant') {
                            lastMsg.content = finalResult.answer;
                            lastMsg.sources = finalResult.sources;
                        }
                        return updated;
                    });

                    // Track chat activity for heatmap
                    recordActivity(projectId, 'chat');
                    setLoading(false);
                }
            );
        } catch (error) {
            console.error("Chat error", error);
            setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                lastMsg.content = "Sorry, I encountered an error processing your request.";
                return updated;
            });
            setLoading(false);
        }
    };

    const handleFileUpload = async (files, bookOptions = {}) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            // Upload files in parallel for better performance
            await Promise.all(
                Array.from(files).map(file => uploadDocument(projectId, file, null, bookOptions))
            );
            await fetchDocuments();
            setShowUploadModal(false);
        } catch (error) {
            console.error("Upload error", error);
            toast.error('Failed to upload document(s)');
        } finally {
            setUploading(false);
        }
    };

    const requestDelete = (doc) => {
        setDeleteConfirmDoc(doc);
    };

    const confirmDelete = async () => {
        if (!deleteConfirmDoc) return;
        const docId = deleteConfirmDoc.id;

        // Add to deleting set
        setDeletingDocIds(prev => new Set(prev).add(docId));
        setDeleteConfirmDoc(null); // Close modal

        try {
            await deleteDocument(projectId, docId);
            // Success: Remove from documents list
            setDocuments(prev => prev.filter(d => d.id !== docId));
            setSelectedDocuments(prev => prev.filter(id => id !== docId));
            fetchDocuments();
        } catch (error) {
            console.error("Delete failed", error);
            toast.error('Failed to delete document');
            fetchDocuments();
            // Remove from deleting set on error so user can retry
            setDeletingDocIds(prev => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    };



    // Sidebar Navigation Item
    const NavItem = ({ id, icon: Icon, label }) => (
        <button
            onClick={() => {
                setActiveTab(id);
                setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center ${leftCollapsed ? 'justify-center px-3 py-4' : 'gap-4 px-5 py-4'} rounded-xl transition-colors ${activeTab === id
                ? 'bg-[#C8A288] text-white font-semibold shadow-md shadow-[#C8A288]/20'
                : 'text-[#4A3B32] hover:bg-[#E6D5CC] hover:shadow-sm'
                }`}
            title={leftCollapsed ? label : undefined}
        >
            <Icon className="h-6 w-6 shrink-0" />
            {!leftCollapsed && <span className="text-base">{label}</span>}
        </button>
    );

    const handleOpenSource = async (source) => {
        if (!source.doc_id) return;
        const doc = documents.find(d => d.id === source.doc_id || d.filename === source.doc_name);
        // Fallback to source.doc_name directly if not found in current documents list
        const filename = doc ? doc.filename : source.doc_name;
        
        try {
            toast.info(`Loading document: ${filename}`);
            const { url } = await getDocumentUrl(projectId, source.doc_id);
            
            setActivePDF({
                url: url,
                title: filename,
                highlightText: source.chunk_text,
                initialPage: source.page || 1
            });
        } catch (error) {
            console.error("Failed to generate or fetch document URL", error);
            toast.error("Could not load the document. It may have been deleted or there is an issue with the server.");
        }
    };

    if (projectViewLoading && documents.length === 0) {
        return <ProjectViewSkeleton />;
    }

    // Error fallback — initial load timed out and no docs
    if (fetchError) {
        return (
            <div className="min-h-screen bg-[#FDF6F0] flex items-center justify-center p-4">
                <div className="text-center max-w-sm">
                    <div className="h-16 w-16 bg-[#FDF6F0] border-2 border-[#E6D5CC] rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <WifiOff className="h-8 w-8 text-[#C8A288]" />
                    </div>
                    <h2 className="text-xl font-bold text-[#4A3B32] mb-2">Couldn't load project</h2>
                    <p className="text-[#8a6a5c] text-sm mb-6">
                        Your world has been paused, kindly wait for it to spin again...
                    </p>
                    <button
                        onClick={() => {
                            setFetchError(false);
                            setProjectViewLoading(true);
                            // Trigger remount by navigating to same route (or just re-run)
                            window.location.reload();
                        }}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-[#C8A288] text-white rounded-xl font-medium hover:bg-[#B08B72] transition-colors shadow-lg shadow-[#C8A288]/20"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[100dvh] flex bg-[#FDF6F0] overflow-hidden font-sans text-[#4A3B32]">

            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar - Desktop & Mobile - Hidden when quiz/qa is active */}
            {!isSidebarHidden && (
                <div className={`
                fixed inset-y-0 left-0 z-50 ${leftCollapsed ? 'w-20' : 'w-80'} bg-[#FDF6F0]/95 backdrop-blur-xl border-r border-white/20 flex flex-col transition-all duration-300 ease-in-out md:translate-x-0 md:static md:shrink-0 shadow-2xl md:shadow-none
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                    <div className={`flex-1 flex flex-col min-h-0 ${leftCollapsed ? 'p-3' : 'p-6'}`}>
                        <div className={`flex items-center ${leftCollapsed ? 'justify-center' : 'justify-between'} mb-8`}>
                            {!leftCollapsed && (
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-gradient-to-br from-[#C8A288] to-[#A08072] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#C8A288]/20">
                                        <BookOpen className="h-6 w-6" />
                                    </div>
                                    <h1 className="text-2xl font-bold text-[#4A3B32] tracking-tight">Lumina IQ</h1>
                                </div>
                            )}
                            <div className="flex items-center gap-1">
                                {/* Desktop collapse toggle */}
                                <button
                                    onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
                                    className="hidden md:block p-2 hover:bg-[#E6D5CC]/30 rounded-full text-[#8a6a5c] transition-colors"
                                    title={isLeftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                                >
                                    {leftCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                                </button>
                                {/* Close button for mobile */}
                                <button
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="md:hidden p-2 hover:bg-[#E6D5CC]/30 rounded-full text-[#8a6a5c] transition-colors"
                                >
                                    <X className="h-6 w-6" />
                                </button>
                            </div>
                        </div>

                        <nav className={`flex-1 overflow-y-auto min-h-0 custom-scrollbar ${leftCollapsed ? 'space-y-2' : 'space-y-4'}`}>
                            {/* Main Navigation Items */}
                            <NavItem id="chat" icon={MessageSquare} label="Chat" />
                            <NavItem id="path" icon={Target} label="Learning Path" />

                            {/* General Section - Expandable */}
                            <div className={leftCollapsed ? '' : ''}>
                                <button
                                    onClick={() => setActiveTab(activeTab === 'general' ? 'chat' : 'general')}
                                    className={`w-full flex items-center ${leftCollapsed ? 'justify-center px-3 py-4' : 'gap-4 px-5 py-4'} rounded-xl transition-colors ${activeTab === 'general' || activeTab === 'qa' || activeTab === 'quiz' || activeTab === 'notes' || activeTab === 'flashcards' || activeTab === 'mindmap'
                                        ? 'bg-[#C8A288] text-white font-semibold shadow-md shadow-[#C8A288]/20'
                                        : 'text-[#4A3B32] hover:bg-[#E6D5CC] hover:shadow-sm'
                                        }`}
                                    title={leftCollapsed ? 'General' : undefined}
                                >
                                    <FileText className="h-6 w-6 shrink-0" />
                                    {!leftCollapsed && (
                                        <>
                                            <span className="flex-1 text-left text-base">General</span>
                                            <ChevronDown className={`h-5 w-5 transition-transform ${activeTab === 'general' || activeTab === 'qa' || activeTab === 'quiz' || activeTab === 'notes' || activeTab === 'flashcards' || activeTab === 'mindmap' ? 'rotate-180' : ''}`} />
                                        </>
                                    )}
                                </button>

                                {/* General Sub-items */}
                                {!leftCollapsed && (activeTab === 'general' || activeTab === 'qa' || activeTab === 'quiz' || activeTab === 'notes' || activeTab === 'flashcards' || activeTab === 'mindmap') && (
                                    <div className="ml-6 mt-2 space-y-2 border-l-2 border-[#E6D5CC] pl-4">
                                        <button
                                            onClick={() => {
                                                setActiveTab('qa');
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${activeTab === 'qa' ? 'text-[#C8A288] font-semibold bg-[#FDF6F0]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/50'
                                                }`}
                                        >
                                            <HelpCircle className="h-5 w-5" />
                                            <span>Q&A</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setActiveTab('quiz');
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${activeTab === 'quiz' ? 'text-[#C8A288] font-semibold bg-[#FDF6F0]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/50'
                                                }`}
                                        >
                                            <CheckSquare className="h-5 w-5" />
                                            <span>Answer Quiz</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setActiveTab('notes');
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${activeTab === 'notes' ? 'text-[#C8A288] font-semibold bg-[#FDF6F0]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/50'
                                                }`}
                                        >
                                            <FileText className="h-5 w-5" />
                                            <span>Notes</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setActiveTab('flashcards');
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${activeTab === 'flashcards' ? 'text-[#C8A288] font-semibold bg-[#FDF6F0]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/50'
                                                }`}
                                        >
                                            <Layers className="h-5 w-5" />
                                            <span>Flashcards</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setActiveTab('mindmap');
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${activeTab === 'mindmap' ? 'text-[#C8A288] font-semibold bg-[#FDF6F0]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/50'
                                                }`}
                                        >
                                            <Zap className="h-5 w-5" />
                                            <span>Mindmap</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <NavItem id="knowledge" icon={Network} label="Knowledge Graph" />


                        </nav>

                        {/* Profile Section - Fixed at Bottom of Sidebar */}
                        <div className={`shrink-0 ${leftCollapsed ? 'p-3' : 'p-4'} border-t border-[#E6D5CC]/50 bg-[#FDF6F0]/95 backdrop-blur-sm`}>
                            <button
                                onClick={() => setShowProfileMenu(!showProfileMenu)}
                                className={`profile-dropdown w-full flex items-center ${leftCollapsed ? 'justify-center px-3 py-3' : 'gap-3 px-4 py-3'} rounded-xl transition-all hover:bg-[#E6D5CC] hover:shadow-sm group`}
                                title={leftCollapsed ? 'Profile' : undefined}
                            >
                                <div className="h-10 w-10 bg-gradient-to-br from-[#C8A288] to-[#A08072] rounded-full flex items-center justify-center text-white shadow-md group-hover:shadow-lg transition-shadow shrink-0">
                                    <User className="h-5 w-5" />
                                </div>
                                {!leftCollapsed && (
                                    <div className="flex-1 text-left">
                                        <p className="text-sm font-bold text-[#4A3B32]">Profile</p>
                                        <p className="text-xs text-[#8a6a5c]">Settings & More</p>
                                    </div>
                                )}
                                {!leftCollapsed && (
                                    <Settings className="h-5 w-5 text-[#8a6a5c] group-hover:text-[#C8A288] transition-colors" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className={`flex-1 flex flex-col min-w-0 overflow-hidden backdrop-blur-sm ${zenMode
                ? 'bg-white m-0 rounded-none border-0 shadow-none'
                : 'bg-white/50 md:bg-white md:m-4 md:rounded-3xl shadow-sm border-x md:border-y border-[#E6D5CC]/50 md:border-[#E6D5CC]'
                }`}>

                {/* Header (Context) - Hidden in Zen Mode */}
                {!zenMode && (
                    <div className="px-3 md:px-5 py-2.5 border-b border-[#E6D5CC]/50 bg-white/50 backdrop-blur-md sticky top-0 z-30">
                        {/* Single-row header with proper spacing */}
                        <div className="flex items-center gap-2 h-11">
                            {/* Mobile Menu Button */}
                            <button
                                onClick={() => setIsMobileMenuOpen(true)}
                                className="md:hidden p-2 -ml-1 hover:bg-[#E6D5CC]/30 rounded-lg text-[#4A3B32] transition-colors shrink-0"
                            >
                                <Menu className="h-5 w-5" />
                            </button>

                            {/* Left: Tab name + Summary */}
                            <div className="flex items-center gap-2 min-w-0 shrink-0">
                                <h2 className="text-base font-bold text-[#4A3B32] whitespace-nowrap">
                                    {activeTab === 'chat' && 'Chat'}
                                    {activeTab === 'qa' && 'Q&A'}
                                    {activeTab === 'quiz' && 'Quiz'}
                                    {activeTab === 'notes' && 'Notes'}
                                    {activeTab === 'flashcards' && 'Flashcards'}
                                    {activeTab === 'mindmap' && 'Mindmap'}
                                    {activeTab === 'path' && 'Learning Path'}
                                    {activeTab === 'study' && 'Study'}
                                    {activeTab === 'analytics' && 'Analytics'}
                                    {activeTab === 'knowledge' && 'Knowledge Graph'}
                                </h2>

                                {/* Summary Dropdown - compact pill */}
                                {documents.length > 0 && (
                                    <button
                                        onClick={toggleSummary}
                                        className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all shrink-0 ${showSummary
                                            ? 'bg-[#C8A288] text-white'
                                            : 'bg-[#FDF6F0] text-[#C8A288] border border-[#E6D5CC] hover:border-[#C8A288]/40'
                                            }`}
                                    >
                                        <FileText className="h-3 w-3" />
                                        Summary
                                        {showSummary ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                )}
                            </div>

                            {/* Spacer for mobile */}
                            <div className="flex-1" />

                            {/* Right: Toolbar - grouped with subtle dividers */}
                            <div className="flex items-center shrink-0">
                                {/* Core tools group */}
                                <div className="flex items-center">
                                    <button
                                        onClick={() => setShowSearch(true)}
                                        className="p-2.5 rounded-lg text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30 transition-colors"
                                        title="Search (Ctrl+K)"
                                    >
                                        <Search className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => setShowAITutor(!showAITutor)}
                                        className={`p-2.5 rounded-lg transition-colors ${showAITutor ? 'bg-[#C8A288] text-white' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'}`}
                                        title="AI Tutor"
                                    >
                                        <Brain className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => setShowPomodoro(!showPomodoro)}
                                        className={`p-2.5 rounded-lg transition-colors ${showPomodoro ? 'bg-[#C8A288] text-white' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'}`}
                                        title="Pomodoro Timer"
                                    >
                                        <Timer className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => setShowBookmarks(!showBookmarks)}
                                        className={`p-2.5 rounded-lg transition-colors ${showBookmarks ? 'bg-[#C8A288] text-white' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'}`}
                                        title="Bookmarks & Highlights"
                                    >
                                        <Bookmark className="h-5 w-5" />
                                    </button>
                                </div>

                                {/* Divider */}
                                <div className="w-px h-6 bg-[#E6D5CC]/60 mx-1 hidden sm:block" />

                                {/* Secondary tools */}
                                <div className="hidden sm:flex items-center">
                                    <button
                                        onClick={() => setZenMode(true)}
                                        className="p-2.5 rounded-lg text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30 transition-colors"
                                        title="Focus Mode (Ctrl+Shift+Z)"
                                    >
                                        <Maximize2 className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsRightCollapsed(!isRightCollapsed)}
                                        className={`p-2.5 rounded-lg transition-colors ${!isRightCollapsed ? 'bg-[#C8A288]/10 text-[#C8A288]' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'}`}
                                        title={isRightCollapsed ? 'Show Documents Panel' : 'Hide Documents Panel'}
                                    >
                                        <PanelRight className="h-5 w-5" />
                                    </button>
                                </div>

                                {/* Divider */}
                                <div className="w-px h-6 bg-[#E6D5CC]/60 mx-0.5 hidden sm:block" />

                                {/* Gamification Button */}
                                <button
                                    onClick={() => setShowGamification(!showGamification)}
                                    className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all ${showGamification
                                        ? 'bg-[#C8A288] text-white'
                                        : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'
                                        }`}
                                    title="Progress & XP"
                                >
                                    <Trophy className="h-5 w-5" />
                                    {gamificationData && (
                                        <span className="text-xs font-bold tabular-nums">
                                            {gamificationData.total_xp?.toLocaleString()} XP
                                        </span>
                                    )}
                                </button>

                                {/* Documents Sidebar Toggle (Mobile) */}
                                <button
                                    onClick={() => setIsMobileDocsOpen(!isMobileDocsOpen)}
                                    className={`md:hidden p-2.5 rounded-lg transition-colors ${isMobileDocsOpen ? 'bg-[#C8A288] text-white' : 'text-[#8a6a5c] hover:text-[#4A3B32] hover:bg-[#E6D5CC]/30'}`}
                                    title="Documents"
                                >
                                    <PanelRight className="h-5 w-5" />
                                </button>

                                {/* Exit */}
                                <button
                                    onClick={() => navigate('/dashboard')}
                                    className="p-2.5 rounded-lg text-[#8a6a5c]/50 hover:bg-red-50 hover:text-red-500 transition-colors ml-0.5"
                                    title="Back to Dashboard"
                                >
                                    <LogOut className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Summary Content Area - positioned below header */}
                        {showSummary && (
                            <div className="absolute top-full left-4 right-4 md:left-auto md:right-4 md:w-96 mt-1 p-5 bg-white/95 backdrop-blur-xl rounded-2xl border border-[#E6D5CC] shadow-2xl animate-in slide-in-from-top-2 z-50">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="font-bold text-sm text-[#4A3B32] uppercase tracking-wide">
                                        {selectedDocuments.length > 0 ? (selectedDocuments.length === 1 ? 'Document Summary' : 'Selection Summary') : 'Project Summary'}
                                    </h4>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={fetchSummary}
                                            disabled={summaryLoading}
                                            title="Regenerate Summary"
                                            className="p-1.5 hover:bg-[#FDF6F0] rounded-full transition-colors disabled:opacity-50"
                                        >
                                            <RefreshCw className={`h-3.5 w-3.5 ${summaryLoading ? 'animate-spin' : ''}`} />
                                        </button>
                                        <button
                                            onClick={() => setShowSummary(false)}
                                            className="p-1.5 hover:bg-[#FDF6F0] rounded-full transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                {summaryLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                                        <div className="relative">
                                            <div className="h-16 w-16 border-4 border-[#E6D5CC] rounded-full"></div>
                                            <div className="absolute inset-0 h-16 w-16 border-4 border-[#C8A288] rounded-full border-t-transparent animate-spin"></div>
                                            <FileText className="absolute inset-0 m-auto h-6 w-6 text-[#C8A288]" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-bold text-[#4A3B32]">Generating Summary</p>
                                            <p className="text-xs text-[#8a6a5c] mt-1">Analyzing your documents...</p>
                                        </div>
                                        <div className="flex gap-1">
                                            <div className="h-2 w-2 bg-[#C8A288] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                            <div className="h-2 w-2 bg-[#C8A288] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                            <div className="h-2 w-2 bg-[#C8A288] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="prose prose-sm max-w-none text-sm text-[#4A3B32] max-h-[60vh] overflow-y-auto overflow-x-auto pr-2 custom-scrollbar">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryContent}</ReactMarkdown>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Zen Mode Floating Controls */}
                {zenMode && (
                    <div className="absolute top-3 right-3 z-50 flex items-center gap-2 animate-in fade-in duration-300">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#4A3B32]/80 backdrop-blur-md text-white/90 rounded-full text-xs font-medium shadow-lg">
                            <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse" />
                            Focus Mode
                        </div>
                        <button
                            onClick={() => setZenMode(false)}
                            className="p-2 bg-[#4A3B32]/80 backdrop-blur-md text-white/90 rounded-full hover:bg-[#4A3B32] transition-colors shadow-lg"
                            title="Exit Focus Mode (Esc)"
                        >
                            <Minimize2 className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* Content Body */}
                <div className="flex-1 overflow-hidden relative">

                    {/* Chat View */}
                    {activeTab === 'chat' && (
                        <div className="h-full flex flex-col relative">
                            {activePDF && (
                                <ErrorBoundary>
                                    <PDFViewer
                                        url={activePDF.url}
                                        title={activePDF.title}
                                        highlightText={activePDF.highlightText}
                                        onClose={() => setActivePDF(null)}
                                    />
                                </ErrorBoundary>
                            )}
                            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 md:p-6 space-y-6">
                                {messages.map((msg, idx) => (
                                    <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        {/* Tool Loading Card */}
                                        {msg.type === 'tool_loading' && (
                                            <ToolLoadingCard toolType={msg.toolType} toolParams={msg.toolParams} />
                                        )}

                                        {/* Tool Result Card */}
                                        {msg.type === 'tool_result' && (
                                            <ToolResultCard
                                                toolType={msg.toolType}
                                                toolParams={msg.toolParams}
                                                toolData={msg.toolData}
                                                onOpen={handleToolOpen}
                                            />
                                        )}

                                        {/* Tool Error Card */}
                                        {msg.type === 'tool_error' && (
                                            <ToolErrorCard
                                                toolType={msg.toolType}
                                                error={msg.error}
                                                onRetry={() => handleToolExecute(msg.toolType, msg.toolParams)}
                                            />
                                        )}

                                        {/* Regular message (no type or tool_command) */}
                                        {(!msg.type || msg.type === 'tool_command') && (
                                            <div className={`max-w-[95%] md:max-w-[85%] break-words rounded-2xl px-4 py-3 md:px-6 md:py-4 ${msg.role === 'user'
                                                ? 'bg-[#C8A288] text-white rounded-br-none'
                                                : 'bg-[#FDF6F0] text-[#4A3B32] rounded-bl-none'
                                                }`}>
                                                {msg.content ? (
                                                    <div className={`text-sm leading-relaxed ${msg.role === 'assistant' ? 'prose prose-sm max-w-none overflow-x-auto prose-p:my-2 prose-headings:text-[#4A3B32] prose-a:text-[#C8A288]' : ''}`}>
                                                        <ReactMarkdown 
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                a: ({node, ...props}) => {
                                                                    // Check for inline citation links (e.g. href="1")
                                                                    if (props.href && !isNaN(props.href) && msg.sources) {
                                                                        const sourceIdx = parseInt(props.href) - 1;
                                                                        const source = msg.sources[sourceIdx];
                                                                        if (source) {
                                                                            return (
                                                                                <button 
                                                                                    onClick={(e) => {
                                                                                        e.preventDefault();
                                                                                        handleOpenSource(source);
                                                                                    }}
                                                                                    className="inline-flex items-center justify-center gap-0.5 min-w-[32px] h-[20px] px-1.5 mx-0.5 text-[10px] font-bold text-white bg-[#C8A288]/90 hover:bg-[#A08072] rounded shadow-sm transition-all cursor-pointer align-text-top"
                                                                                    title={`Source ${props.href}: ${source.doc_name}`}
                                                                                >
                                                                                    <FileText className="h-2.5 w-2.5 opacity-80 shrink-0" />
                                                                                    <span>{props.href}</span>
                                                                                </button>
                                                                            );
                                                                        }
                                                                    }

                                                                    if (props.href && props.href.startsWith('http') && !props.href.includes(window.location.origin)) {
                                                                        return <a {...props} target="_blank" rel="noopener noreferrer" className="text-[#C8A288] hover:underline" />;
                                                                    }
                                                                    return (
                                                                        <button 
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                handleOpenSource({ doc_name: String(props.children) });
                                                                            }}
                                                                            className="text-[#C8A288] hover:underline hover:text-[#A08072] cursor-pointer bg-transparent border-none p-0 inline font-medium"
                                                                            title={`Open document: ${props.children}`}
                                                                        >
                                                                            {props.children}
                                                                        </button>
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            {msg.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                ) : (
                                                    <Loader2 className="h-5 w-5 animate-spin text-[#8a6a5c]" />
                                                )}

                                                {/* Citations are now rendered inline within ReactMarkdown */}
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                                {isProcessingDocs && (
                                    <div className="flex justify-center my-4 animate-in fade-in slide-in-from-bottom-2">
                                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 px-5 py-4 rounded-xl text-sm flex items-start gap-3 border border-amber-200 shadow-md max-w-lg w-full">
                                            <div className="relative shrink-0 mt-0.5">
                                                <div className="h-8 w-8 border-2 border-amber-300 rounded-full"></div>
                                                <div className="absolute inset-0 h-8 w-8 border-2 border-amber-500 rounded-full border-t-transparent animate-spin"></div>
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-bold text-amber-800 tracking-wide text-xs uppercase mb-1.5">Processing Documents</p>
                                                <div className="text-[11px] leading-relaxed italic text-amber-700/90 whitespace-pre-line transition-opacity duration-300 font-medium">
                                                    {getRotatingLoadingMessage(loadingMsgIdx)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Failed doc banner — shown when any doc fails */}
                                {!isProcessingDocs && documents.some(d => d.upload_status === 'failed' || d.upload_status === 'error') && (
                                    <div className="flex justify-center my-4 animate-in fade-in slide-in-from-bottom-2">
                                        <div className="bg-red-50 text-red-700 px-5 py-4 rounded-xl text-sm flex items-start gap-3 border border-red-200 shadow-md max-w-lg w-full">
                                            <div className="shrink-0 mt-0.5 h-8 w-8 bg-red-100 rounded-full flex items-center justify-center">
                                                <X className="h-4 w-4 text-red-500" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-bold text-red-800 tracking-wide text-xs uppercase mb-1.5">Document Processing Failed</p>
                                                <p className="text-[11px] leading-relaxed text-red-700/90">
                                                    {documents.filter(d => d.upload_status === 'failed' || d.upload_status === 'error').length === 1
                                                        ? `"${documents.find(d => d.upload_status === 'failed' || d.upload_status === 'error')?.filename}" couldn't be processed. This usually means it's a scanned image PDF with no readable text, encrypted, or corrupted. Delete it and try a different file.`
                                                        : `${documents.filter(d => d.upload_status === 'failed' || d.upload_status === 'error').length} documents couldn't be processed — likely scanned image PDFs, encrypted, or corrupted. Delete them and try different files.`
                                                    }
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                            </div>

                            <div className="p-4 border-t border-[#E6D5CC] bg-white">
                                <div className="max-w-4xl mx-auto relative">
                                    {/* Command Picker Dropdown */}
                                    <CommandPicker
                                        filter={commandFilter}
                                        onSelect={handleCommandSelect}
                                        onClose={() => { setShowCommandPicker(false); setCommandFilter(''); }}
                                        visible={showCommandPicker && !activeCommand}
                                    />

                                    {/* Command Parameter Form */}
                                    {activeCommand && (
                                        <CommandParamForm
                                            command={activeCommand}
                                            availableTopics={availableTopics}
                                            onExecute={handleToolExecute}
                                            onCancel={() => setActiveCommand(null)}
                                            loading={toolLoading}
                                        />
                                    )}

                                    <form onSubmit={handleSendMessage} className="flex gap-2 md:gap-3">
                                        <div className="flex-1 relative">
                                            <input
                                                type="text"
                                                value={inputMessage}
                                                onChange={handleInputChange}
                                                placeholder="Ask a question or type @ for AI tools..."
                                                className="w-full pl-4 md:pl-6 pr-12 py-3 bg-[#FDF6F0] border-none rounded-full focus:ring-2 focus:ring-[#C8A288] outline-none text-[#4A3B32] placeholder-[#8a6a5c] text-sm md:text-base"
                                                disabled={loading || toolLoading}
                                            />
                                            <button
                                                type="submit"
                                                disabled={loading || toolLoading || !inputMessage.trim()}
                                                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-[#C8A288] text-white rounded-full hover:bg-[#B08B72] transition-colors disabled:opacity-50"
                                            >
                                                <Send className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'quiz' && (
                        <QuizView
                            projectId={projectId}
                            availableTopics={availableTopics}
                            selectedDocuments={selectedDocuments}
                            preSelectedTopic={preSelectedTopic}
                            preSelectedMode={preSelectedQuizMode}
                            preGeneratedData={preGeneratedQuiz}
                            onConsumePreGenerated={() => setPreGeneratedQuiz(null)}
                            cameFromPath={cameFromPath}
                            onReturnToPath={() => {
                                setActiveTab('path');
                                setPreSelectedTopic(null);
                                setPreSelectedQuizMode(null);
                                setCameFromPath(false);
                            }}
                            onQuizComplete={(topic, score, passed) => {
                                if (passed) {
                                    const newProgress = new Set(learningProgress);
                                    newProgress.add(topic);
                                    setLearningProgress(newProgress);
                                    saveLearningProgress(projectId, [...newProgress]).catch(err =>
                                        console.warn('Failed to save progress:', err)
                                    );
                                }
                                // Clear pre-selection after quiz complete
                                setPreSelectedTopic(null);
                                setPreSelectedQuizMode(null);
                            }}
                            onQuizActiveChange={setIsQuizActive}
                            onBack={() => {
                                setActiveTab('chat');
                                setIsQuizActive(false);
                            }}
                        />
                    )}

                    {/* Q&A Generation View (Study Mode) */}
                    {activeTab === 'qa' && (
                        <QAView
                            projectId={projectId}
                            availableTopics={availableTopics}
                            selectedDocuments={selectedDocuments}
                            preSelectedTopic={preSelectedTopic}
                            preGeneratedData={preGeneratedQA}
                            onConsumePreGenerated={() => setPreGeneratedQA(null)}
                            onQAActiveChange={setIsQAActive}
                            autoGenerate={qaAutoGenerate}
                            onBack={() => {
                                setActiveTab('chat');
                                setIsQAActive(false);
                            }}
                        />
                    )}

                    {/* Notes Generation View */}
                    {activeTab === 'notes' && (
                        <NotesView
                            projectId={projectId}
                            availableTopics={availableTopics}
                            selectedDocuments={selectedDocuments}
                            preSelectedTopic={preSelectedTopic}
                            preGeneratedData={preGeneratedNotes}
                            onConsumePreGenerated={() => setPreGeneratedNotes(null)}
                            autoGenerate={notesAutoGenerate}
                        />
                    )}

                    {/* Flashcards View */}
                    {activeTab === 'flashcards' && (
                        <FlashcardsView
                            projectId={projectId}
                            availableTopics={availableTopics}
                            selectedDocuments={selectedDocuments}
                        />
                    )}

                    {/* Mindmap View */}
                    {activeTab === 'mindmap' && (
                        <MindmapView
                            projectId={projectId}
                            availableTopics={availableTopics}
                            selectedDocuments={selectedDocuments}
                        />
                    )}

                    {/* Study Dashboard View */}
                    {activeTab === 'study' && (
                        <StudyDashboard
                            projectId={projectId}
                            availableTopics={allProjectTopics}
                        />
                    )}

                    {/* Learning Path View */}
                    {activeTab === 'path' && (
                        <LearningPathView
                            projectId={projectId}
                            availableTopics={allProjectTopics}
                            selectedDocuments={selectedDocuments}
                            setSelectedDocuments={setSelectedDocuments}
                            documentTopics={documentTopics}
                            documents={documents}
                            completedTopics={learningProgress}
                            onStartQuiz={(topic, mode, docsToSelect) => {
                                // Set documents for context
                                if (docsToSelect && docsToSelect.length > 0) {
                                    setSelectedDocuments(docsToSelect);
                                }
                                // Set pre-selected topic and mode
                                setPreSelectedTopic(topic);
                                setPreSelectedQuizMode(mode || 'both');
                                setCameFromPath(true);
                                // Navigate to quiz tab
                                setActiveTab('quiz');
                            }}
                            onTopicComplete={(topic) => {
                                const newProgress = new Set(learningProgress);
                                newProgress.add(topic);
                                setLearningProgress(newProgress);
                                saveLearningProgress(projectId, [...newProgress]).catch(err =>
                                    console.warn('Failed to save progress:', err)
                                );
                            }}
                            onGenerateNotes={(topic, docsToSelect) => {
                                if (docsToSelect && docsToSelect.length > 0) {
                                    setSelectedDocuments(docsToSelect);
                                }
                                setPreSelectedTopic(topic);
                                setNotesAutoGenerate(true);
                                setActiveTab('notes');
                            }}
                            onStartQA={(topic, docsToSelect) => {
                                if (docsToSelect && docsToSelect.length > 0) {
                                    setSelectedDocuments(docsToSelect);
                                }
                                setPreSelectedTopic(topic);
                                setQAAutoGenerate(true);
                                setActiveTab('qa');
                            }}
                            onOpenTutor={(topic) => {
                                setTutorTopic(topic);
                                setShowAITutor(true);
                            }}
                            onOpenKnowledgeGraph={() => {
                                setActiveTab('knowledge');
                            }}
                            onOpenMindmap={(topic, docsToSelect) => {
                                if (docsToSelect && docsToSelect.length > 0) {
                                    setSelectedDocuments(docsToSelect);
                                }
                                setMindmapTopic(topic);
                                setMindmapDocs(docsToSelect || []);
                            }}
                            onOpenFlashcards={(topic, docsToSelect) => {
                                if (docsToSelect && docsToSelect.length > 0) {
                                    setSelectedDocuments(docsToSelect);
                                }
                                setFlashcardTopic(topic);
                                setFlashcardDocs(docsToSelect || []);
                            }}
                        />
                    )}

                    {/* Advanced Analytics View */}
                    {activeTab === 'analytics' && (
                        <AdvancedAnalytics
                            projectId={projectId}
                            documents={documents}
                            selectedDocuments={selectedDocuments}
                            documentTopics={documentTopics}
                        />
                    )}

                    {/* Knowledge Graph View */}
                    {activeTab === 'knowledge' && (
                        <KnowledgeGraphView projectId={projectId} />
                    )}

                    {/* Mindmap Overlay (only from Learning Path) */}
                    {mindmapTopic && (
                        <div className="absolute inset-0 z-20 bg-white">
                            <TopicMindmap
                                projectId={projectId}
                                topic={mindmapTopic}
                                selectedDocuments={mindmapDocs}
                                onClose={() => {
                                    setMindmapTopic(null);
                                    setMindmapDocs([]);
                                }}
                            />
                        </div>
                    )}

                    {/* Flashcards Overlay (only from Learning Path) */}
                    {flashcardTopic && (
                        <div className="absolute inset-0 z-20 bg-white">
                            <TopicFlashcards
                                projectId={projectId}
                                topic={flashcardTopic}
                                selectedDocuments={flashcardDocs}
                                onClose={() => {
                                    setFlashcardTopic(null);
                                    setFlashcardDocs([]);
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* ===== RIGHT SIDEBAR — Document Management ===== */}
            {!isSidebarHidden && (
                <>
                    {/* Mobile Overlay */}
                    {isMobileDocsOpen && (
                        <div
                            className="fixed inset-0 bg-black/50 z-40 md:hidden"
                            onClick={() => setIsMobileDocsOpen(false)}
                        />
                    )}
                    <div className={`
                    fixed inset-y-0 right-0 z-50 w-80 bg-[#FDF6F0]/98 backdrop-blur-xl border-l border-[#E6D5CC]/60 flex flex-col transition-all duration-300 ease-in-out
                    md:translate-x-0 md:static md:shrink-0
                    ${isRightCollapsed ? 'md:w-0 md:border-0 md:overflow-hidden md:p-0' : 'md:w-80'}
                    ${isMobileDocsOpen ? 'translate-x-0' : 'translate-x-full'}
                    shadow-2xl md:shadow-none
                `}>
                        {/* Right Sidebar Header */}
                        <div className="shrink-0 px-5 py-4 border-b border-[#E6D5CC]/50 bg-gradient-to-br from-[#FDF6F0] to-white/80">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-8 w-8 bg-gradient-to-br from-[#C8A288] to-[#A08072] rounded-lg flex items-center justify-center text-white shadow-sm">
                                        <FileText className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-[#4A3B32] leading-tight">Documents</h3>
                                        <p className="text-[10px] text-[#8a6a5c]">
                                            {selectedDocuments.length > 0
                                                ? `${selectedDocuments.length} of ${documents.length} selected`
                                                : `${documents.length} document${documents.length !== 1 ? 's' : ''}`
                                            }
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {/* Collapse toggle (desktop) */}
                                    <button
                                        onClick={() => setIsRightCollapsed(!isRightCollapsed)}
                                        className="hidden md:block p-1.5 hover:bg-[#E6D5CC]/40 rounded-lg text-[#8a6a5c] transition-colors"
                                        title={isRightCollapsed ? 'Expand' : 'Collapse'}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                    {/* Close (mobile) */}
                                    <button
                                        onClick={() => setIsMobileDocsOpen(false)}
                                        className="md:hidden p-1.5 hover:bg-[#E6D5CC]/40 rounded-lg text-[#8a6a5c] transition-colors"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Upload Section */}
                        <div className="shrink-0 px-4 pt-3 pb-2">
                            <button
                                onClick={() => setShowAddDocModal(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#C8A288] to-[#B08B72] text-white shadow-md hover:shadow-lg hover:scale-[1.01] transition-all"
                            >
                                <Plus className="h-4 w-4" />
                                Add Document
                            </button>
                        </div>

                        {/* Select All / Deselect All Controls */}
                        {documents.length > 0 && (
                            <div className="shrink-0 px-4 py-2 flex items-center gap-2 border-b border-[#E6D5CC]/30">
                                <button
                                    onClick={() => {
                                        const readyDocs = documents.filter(d => d.upload_status === 'completed' || d.upload_status === 'ready');
                                        setSelectedDocuments(readyDocs.map(d => d.id));
                                    }}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#C8A288]/10 text-[#C8A288] hover:bg-[#C8A288]/20 transition-colors"
                                >
                                    <Eye className="h-3 w-3" />
                                    Select All
                                </button>
                                <button
                                    onClick={() => setSelectedDocuments([])}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FDF6F0] text-[#8a6a5c] hover:bg-[#E6D5CC]/50 transition-colors"
                                >
                                    <EyeOff className="h-3 w-3" />
                                    Deselect All
                                </button>
                            </div>
                        )}

                        {/* Document List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1.5">
                            {/* Processing Banner (Only show if > 1 document processing) */}
                            {documents.filter(d => d.upload_status === 'pending' || d.upload_status === 'processing' || d.upload_status === 'embedding' || d.upload_status === 'queued').length > 1 && (
                                <div className="flex items-center gap-2.5 p-3 mb-2 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200/80">
                                    <div className="relative shrink-0">
                                        <div className="h-6 w-6 border-2 border-amber-300 rounded-full"></div>
                                        <div className="absolute inset-0 h-6 w-6 border-2 border-amber-500 rounded-full border-t-transparent animate-spin"></div>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-amber-800">
                                            Processing {documents.filter(d => d.upload_status === 'pending' || d.upload_status === 'processing' || d.upload_status === 'embedding' || d.upload_status === 'queued').length} Documents
                                        </p>
                                        <p className="text-[10px] text-amber-600">{getRotatingLoadingMessage(loadingMsgIdx)}</p>
                                    </div>
                                </div>
                            )}

                            {documents.length > 0 ? (
                                documents.map((doc) => {
                                    const isSelected = selectedDocuments.includes(doc.id);
                                    const isDeleting = deletingDocIds.has(doc.id);
                                    const isProcessing = doc.upload_status === 'pending' || doc.upload_status === 'processing' || doc.upload_status === 'embedding' || doc.upload_status === 'queued';
                                    const isReady = doc.upload_status === 'completed' || doc.upload_status === 'ready';
                                    const isFailed = doc.upload_status === 'failed' || doc.upload_status === 'error';

                                    return (
                                        <div
                                            key={doc.id}
                                            className={`group relative flex items-start gap-2.5 p-3 rounded-xl cursor-pointer transition-all duration-200 ${isDeleting
                                                ? 'opacity-40 pointer-events-none scale-95'
                                                : isFailed
                                                    ? 'bg-red-50/60 border border-red-200/70 opacity-80'
                                                    : isSelected
                                                        ? 'bg-[#C8A288]/15 border border-[#C8A288]/40 shadow-sm'
                                                        : 'bg-white/60 border border-transparent hover:bg-[#FDF6F0] hover:border-[#E6D5CC]/60'
                                                }`}
                                            onClick={() => {
                                                if (isDeleting || !isReady) return;
                                                // Toggle multi-select
                                                setSelectedDocuments(prev =>
                                                    prev.includes(doc.id)
                                                        ? prev.filter(id => id !== doc.id)
                                                        : [...prev, doc.id]
                                                );
                                            }}
                                        >
                                            {/* Checkbox */}
                                            <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${isSelected
                                                ? 'bg-[#C8A288] border-[#C8A288] text-white shadow-sm'
                                                : isReady
                                                    ? 'border-[#d2bab0] group-hover:border-[#C8A288]'
                                                    : 'border-[#E6D5CC] opacity-50'
                                                }`}>
                                                {isSelected && <Check className="h-3 w-3" />}
                                            </div>

                                            {/* Document Info */}
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate leading-tight ${isSelected ? 'text-[#4A3B32]' : 'text-[#5a4a42]'
                                                    }`}>
                                                    {doc.filename}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {isProcessing && (
                                                        <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                                                            <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                                                            <span className="truncate" key={loadingMsgIdx}>{getRandomLoadingMessage()}</span>
                                                        </span>
                                                    )}
                                                    {isReady && (
                                                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                                                            <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full" />
                                                            Ready
                                                        </span>
                                                    )}
                                                    {isFailed && (
                                                        <span
                                                            className="flex items-center gap-1 text-[10px] text-red-500 font-medium cursor-help"
                                                            title={doc.error_message || 'This PDF could not be processed. Try a different file.'}
                                                        >
                                                            <div className="h-1.5 w-1.5 bg-red-500 rounded-full shrink-0" />
                                                            Can’t be processed
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Delete Button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    requestDelete(doc);
                                                }}
                                                className="shrink-0 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 text-[#8a6a5c]/50 transition-all"
                                                title="Delete document"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <div className="h-16 w-16 bg-[#E6D5CC]/30 rounded-2xl flex items-center justify-center mb-4">
                                        <Upload className="h-7 w-7 text-[#C8A288]/60" />
                                    </div>
                                    <p className="text-sm font-medium text-[#8a6a5c]">No documents yet</p>
                                    <p className="text-xs text-[#8a6a5c]/60 mt-1">Upload PDF, TXT, or DOCX files</p>
                                    <button
                                        onClick={() => setShowRightSidebarUpload(true)}
                                        className="mt-4 px-4 py-2 bg-[#C8A288] text-white text-xs font-semibold rounded-lg hover:bg-[#B08B72] transition-colors shadow-sm"
                                    >
                                        Upload First Document
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}


            {/* Delete Confirmation Modal */}
            {
                deleteConfirmDoc && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                            <h3 className="text-xl font-bold text-[#4A3B32] mb-2">Delete Document?</h3>
                            <p className="text-[#8a6a5c] mb-6">
                                Are you sure you want to delete <span className="font-semibold text-[#4A3B32]">{deleteConfirmDoc.filename}</span>?
                                This action cannot be undone.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setDeleteConfirmDoc(null)}
                                    className="px-4 py-2 rounded-lg text-[#4A3B32] hover:bg-[#FDF6F0] font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium transition-colors shadow-sm"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Floating Pomodoro Timer */}
            {showPomodoro && (
                <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-auto z-50 animate-in slide-in-from-bottom-4">
                    <PomodoroTimer
                        projectId={projectId}
                        documentId={selectedDocuments.length === 1 ? selectedDocuments[0] : null}
                        onClose={() => setShowPomodoro(false)}
                    />
                </div>
            )}

            {/* AI Tutor Chat Panel - self-positioned, draggable */}
            {showAITutor && (
                <AITutorChat
                    projectId={projectId}
                    selectedDocuments={selectedDocuments}
                    topic={tutorTopic}
                    onClose={() => {
                        setShowAITutor(false);
                        setTutorTopic(null);
                    }}
                />
            )}

            {/* Bookmarks Panel */}
            {showBookmarks && (
                <div className="fixed top-20 right-4 left-4 md:left-auto md:right-4 md:w-96 z-50 animate-in slide-in-from-right-4">
                    <BookmarksPanel
                        projectId={projectId}
                        documents={documents}
                        onClose={() => setShowBookmarks(false)}
                        onNavigate={(docId, topic) => {
                            if (docId) {
                                setSelectedDocuments([docId]);
                            }
                            if (topic) {
                                setTutorTopic(topic);
                                setShowAITutor(true);
                            }
                        }}
                    />
                </div>
            )}



            {/* Gamification Panel — Floating Popup */}
            {showGamification && (
                <div className="fixed top-14 right-4 left-4 md:left-auto md:w-96 z-50 animate-in slide-in-from-top-2 duration-200">
                    <GamificationPanel onClose={() => setShowGamification(false)} />
                </div>
            )}

            {/* Profile Dropdown - Floating Popup */}
            {showProfileMenu && (
                <>
                    {/* Mobile: Full-screen overlay */}
                    <div
                        className="fixed inset-0 bg-black/50 z-[60] md:hidden"
                        onClick={() => setShowProfileMenu(false)}
                    />

                    {/* Profile Menu */}
                    <div className={`profile-dropdown fixed z-[70] animate-in duration-200 slide-in-from-bottom-4 md:slide-in-from-left-2 left-0 right-0 bottom-0 md:left-auto md:right-auto md:bottom-6 ${leftCollapsed ? 'md:left-24' : 'md:left-[340px]'}`}>
                        <div className="bg-white rounded-t-3xl md:rounded-xl shadow-xl border-t md:border border-[#E6D5CC] overflow-hidden min-w-[200px] max-w-full md:max-w-sm">
                            <div className="bg-gradient-to-r from-[#C8A288] to-[#A08072] p-4 md:p-4 text-white">
                                <div className="flex items-center justify-between md:justify-start gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 md:h-10 md:w-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md">
                                            <User className="h-6 w-6 md:h-5 md:w-5" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-base md:text-sm">User</p>
                                            <p className="text-xs opacity-80">Free Plan</p>
                                        </div>
                                    </div>
                                    {/* Close button for mobile */}
                                    <button
                                        onClick={() => setShowProfileMenu(false)}
                                        className="md:hidden p-2 hover:bg-white/20 rounded-full transition-colors"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                            <div className="py-2">
                                <button
                                    onClick={() => {
                                        setActiveTab('study');
                                        setShowProfileMenu(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-4 md:py-3 text-[#4A3B32] hover:bg-[#FDF6F0] transition-colors active:bg-[#E6D5CC]"
                                >
                                    <Brain className="h-6 w-6 md:h-5 md:w-5 text-[#C8A288]" />
                                    <span className="font-medium text-base md:text-sm">Study Dashboard</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setActiveTab('analytics');
                                        setShowProfileMenu(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-4 md:py-3 text-[#4A3B32] hover:bg-[#FDF6F0] transition-colors active:bg-[#E6D5CC]"
                                >
                                    <BarChart3 className="h-6 w-6 md:h-5 md:w-5 text-[#C8A288]" />
                                    <span className="font-medium text-base md:text-sm">Analytics</span>
                                </button>
                                <div className="border-t border-[#E6D5CC]/50 my-1" />
                                <button
                                    onClick={() => {
                                        navigate('/settings');
                                        setShowProfileMenu(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-4 md:py-3 text-[#4A3B32] hover:bg-[#FDF6F0] transition-colors active:bg-[#E6D5CC]"
                                >
                                    <Settings className="h-6 w-6 md:h-5 md:w-5 text-[#C8A288]" />
                                    <span className="font-medium text-base md:text-sm">Settings</span>
                                </button>
                                {/* Safe area padding for mobile */}
                                <div className="h-4 md:hidden" />
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Global Search Modal */}
            <GlobalSearch
                isOpen={showSearch}
                onClose={() => setShowSearch(false)}
                projectId={projectId}
                documents={documents}
                documentTopics={documentTopics}
                onSelectDocument={(docId) => {
                    setSelectedDocuments([docId]);
                    setShowSearch(false);
                }}
                onSelectTopic={(topic) => {
                    setTutorTopic(topic);
                    setShowAITutor(true);
                    setShowSearch(false);
                }}
            />

            {/* Add Document Modal — unified source picker (Book Store + Upload) */}
            {showAddDocModal && (
                <AddDocumentModal
                    projectId={projectId}
                    uploading={uploading}
                    onUpload={async (files, bookOptions) => {
                        await handleFileUpload(files, bookOptions);
                        setShowAddDocModal(false);
                    }}
                    onImported={(doc) => {
                        fetchDocuments();
                    }}
                    onClose={() => setShowAddDocModal(false)}
                />
            )}
        </div >

    );
};

export default ProjectView;
