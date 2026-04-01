import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Search, BookOpen, Calendar, ArrowRight, LogOut, Upload, FileText,
    Loader2, X, Trash2, RefreshCw, WifiOff, Globe, Lock, ArrowLeft,
    Tag, ChevronDown, ChevronUp, Check, Download
} from 'lucide-react';
import { createProject, uploadDocument, getProjects, deleteProject, getPublicBooks, importBook } from '../api';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getRotatingLoadingMessage } from '../utils/LoadingMessages';
import { DashboardSkeleton } from '../components/Skeleton';
import { getCachedProjects, setCachedProjects, clearProjectsCache } from '../utils/projectCache';

const Dashboard = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const toast = useToast();
    const [showNewProjectModal, setShowNewProjectModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isCreating, setIsCreating] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [uploadStatus, setUploadStatus] = useState({}); // { fileName: 'pending' | 'uploading' | 'success' | 'error' }
    const [projects, setProjects] = useState(() => getCachedProjects() || []);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [isSlowLoad, setIsSlowLoad] = useState(false);
    // Delete Modal State
    const [deleteTargetId, setDeleteTargetId] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

    const fileInputRef = useRef(null);
    const slowLoadTimerRef = useRef(null);
    const fetchTimeoutRef = useRef(null);

    // New project modal step: 'pick' | 'store' | 'upload'
    const [modalStep, setModalStep] = useState('pick');
    // Book visibility
    const [isPublic, setIsPublic] = useState(false);
    const [showBookMeta, setShowBookMeta] = useState(false);
    const [bookTitle, setBookTitle] = useState('');
    const [bookAuthor, setBookAuthor] = useState('');
    const [bookDescription, setBookDescription] = useState('');
    const [bookTags, setBookTags] = useState('');
    // Book store inline
    const [bsBooks, setBsBooks] = useState([]);
    const [bsLoading, setBsLoading] = useState(false);
    const [bsSearch, setBsSearch] = useState('');
    const [bsSearchInput, setBsSearchInput] = useState('');
    const [bsPage, setBsPage] = useState(1);
    const [bsTotalPages, setBsTotalPages] = useState(1);
    const [bsTotal, setBsTotal] = useState(0);
    const [bsImportingId, setBsImportingId] = useState(null);
    const [bsImportedIds, setBsImportedIds] = useState(new Set());
    const [bsCreatedProjectId, setBsCreatedProjectId] = useState(null);

    useEffect(() => {
        let interval;
        if (isCreating) {
            interval = setInterval(() => {
                setLoadingMsgIdx(i => i + 1);
            }, 5000);
        }
        return () => clearInterval(interval);
    }, [isCreating]);

    useEffect(() => {
        fetchProjects();
        return () => {
            clearTimeout(slowLoadTimerRef.current);
            clearTimeout(fetchTimeoutRef.current);
        };
    }, []);

    const fetchProjects = async () => {
        setFetchError(false);
        setIsLoadingProjects(true);

        // If no cache, start a 5s slow-load warning timer
        const hasCached = (getCachedProjects() || []).length > 0;
        if (!hasCached) {
            slowLoadTimerRef.current = setTimeout(() => setIsSlowLoad(true), 5000);
        }

        // Hard 8s timeout — never show skeleton forever
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 8000)
        );

        try {
            const data = await Promise.race([getProjects(), timeoutPromise]);
            setProjects(data);
            setCachedProjects(data);
            setFetchError(false);
        } catch (error) {
            console.error("Failed to fetch projects:", error);
            // Show cached data if available, otherwise show error
            const cached = getCachedProjects();
            if (cached && cached.length > 0) {
                setProjects(cached);
            } else {
                setFetchError(true);
            }
        } finally {
            clearTimeout(slowLoadTimerRef.current);
            setIsSlowLoad(false);
            setIsLoadingProjects(false);
        }
    };

    // ... handlers ...

    // Show skeleton only when there's no cached data to display
    if (isLoadingProjects && projects.length === 0 && !fetchError) {
        return (
            <div className="relative">
                <DashboardSkeleton />
                {isSlowLoad && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#4A3B32] text-white px-5 py-3 rounded-2xl shadow-xl text-sm">
                        <WifiOff className="h-4 w-4 shrink-0 text-[#C8A288]" />
                        <span>Taking longer than expected… backend may be waking up</span>
                    </div>
                )}
            </div>
        );
    }

    // Error state — no cache available
    if (fetchError) {
        return (
            <div className="min-h-screen bg-[#FDF6F0] flex items-center justify-center p-4">
                <div className="text-center max-w-sm">
                    <div className="h-16 w-16 bg-[#FDF6F0] border-2 border-[#E6D5CC] rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <WifiOff className="h-8 w-8 text-[#C8A288]" />
                    </div>
                    <h2 className="text-xl font-bold text-[#4A3B32] mb-2">The world of LuminaIQ is paused</h2>
                    <p className="text-[#8a6a5c] text-sm mb-6">
                        Your world has been paused, kindly wait for it to spin again...
                    </p>
                    <button
                        onClick={fetchProjects}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-[#C8A288] text-white rounded-xl font-medium hover:bg-[#B08B72] transition-colors shadow-lg shadow-[#C8A288]/20"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const confirmDeleteProject = async () => {
        if (!deleteTargetId) return;
        setIsDeleting(true);
        try {
            await deleteProject(deleteTargetId);
            setProjects(prev => prev.filter(p => p.id !== deleteTargetId));
            setDeleteTargetId(null);
        } catch (error) {
            console.error("Failed to delete project:", error);
            toast.error('Failed to delete project');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteClick = (e, projectId) => {
        e.stopPropagation();
        setDeleteTargetId(projectId);
    };

    const handleLogout = () => {
        clearProjectsCache();
        logout();
        navigate('/login');
    };

    const openNewProjectModal = () => {
        setShowNewProjectModal(true);
        setModalStep('pick');
        setNewProjectName('');
        setSelectedFiles([]);
        setIsPublic(false);
        setShowBookMeta(false);
        setBookTitle('');
        setBookAuthor('');
        setBookDescription('');
        setBookTags('');
        setBsBooks([]);
        setBsSearch('');
        setBsSearchInput('');
        setBsPage(1);
        setBsImportedIds(new Set());
        setBsCreatedProjectId(null);
    };

    const closeNewProjectModal = () => {
        setShowNewProjectModal(false);
        // if the user imported books via store, navigate to that project
        if (bsCreatedProjectId) {
            setTimeout(() => navigate(`/project/${bsCreatedProjectId}`), 300);
        }
    };

    const fetchBsBooks = useCallback(async (page = bsPage, search = bsSearch) => {
        setBsLoading(true);
        try {
            const data = await getPublicBooks(page, search);
            setBsBooks(data.books || []);
            setBsTotalPages(data.total_pages || 1);
            setBsTotal(data.total || 0);
        } catch { /* silent */ } finally {
            setBsLoading(false);
        }
    }, [bsPage, bsSearch]);

    useEffect(() => {
        if (modalStep === 'store') fetchBsBooks(bsPage, bsSearch);
    }, [modalStep, bsPage, bsSearch]);

    const handleBsSearch = (e) => {
        e.preventDefault();
        setBsSearch(bsSearchInput);
        setBsPage(1);
    };

    const handleBsImport = async (book) => {
        if (bsImportingId || bsImportedIds.has(book.id)) return;
        setBsImportingId(book.id);
        try {
            // Lazily create the project on first import
            let projId = bsCreatedProjectId;
            if (!projId) {
                const name = newProjectName.trim() || `My Project — ${new Date().toLocaleDateString()}`;
                const proj = await createProject(name);
                projId = proj.id;
                setBsCreatedProjectId(projId);
                setProjects(prev => [proj, ...prev]);
            }
            await importBook(book.id, projId);
            setBsImportedIds(s => new Set([...s, book.id]));
            toast.success(`"${book.title}" added to your project!`);
        } catch (err) {
            if (err.response?.status === 409) {
                setBsImportedIds(s => new Set([...s, book.id]));
                toast.info('Already in your project');
            } else {
                toast.error(err.response?.data?.detail || 'Import failed');
            }
        } finally {
            setBsImportingId(null);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProjectName.trim() || selectedFiles.length === 0) return;
        setIsCreating(true);
        const initialStatus = {};
        selectedFiles.forEach(f => initialStatus[f.name] = 'pending');
        setUploadStatus(initialStatus);
        try {
            const projectData = await createProject(newProjectName);
            if (projectData?.id) {
                const bookOptions = isPublic ? {
                    isPublic: true,
                    bookTitle: bookTitle || selectedFiles[0]?.name,
                    bookAuthor: bookAuthor || undefined,
                    bookDescription: bookDescription || undefined,
                    bookTags: bookTags || undefined,
                } : {};
                for (const file of selectedFiles) {
                    setUploadStatus(prev => ({ ...prev, [file.name]: 'uploading' }));
                    try {
                        await uploadDocument(projectData.id, file, null, bookOptions);
                        setUploadStatus(prev => ({ ...prev, [file.name]: 'success' }));
                    } catch (err) {
                        setUploadStatus(prev => ({ ...prev, [file.name]: 'error' }));
                    }
                }
                setTimeout(() => navigate(`/project/${projectData.id}`), 1000);
            }
        } catch (error) {
            toast.error('Failed to create project. Please try again.');
            setIsCreating(false);
        }
    };

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setSelectedFiles(prev => [...prev, ...Array.from(e.target.files)]);
        }
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    // Drag and Drop Handlers
    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            // Filter for accepted types
            const files = Array.from(e.dataTransfer.files).filter(file =>
                /\.(pdf|txt|docx)$/i.test(file.name)
            );
            setSelectedFiles(prev => [...prev, ...files]);
        }
    };

    return (
        <div className="min-h-screen bg-[#FDF6F0] font-sans text-[#4A3B32]">
            {/* Header */}
            <header className="bg-white border-b border-[#E6D5CC] sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-[#C8A288] rounded-xl flex items-center justify-center text-white shadow-md shadow-[#C8A288]/20">
                            <BookOpen className="h-6 w-6" />
                        </div>
                        <h1 className="text-2xl font-bold text-[#4A3B32]">Lumina IQ</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#FDF6F0] rounded-full border border-[#E6D5CC]">
                            <div className="h-8 w-8 bg-[#C8A288] rounded-full flex items-center justify-center text-white text-sm font-bold">
                                {user?.full_name ? user.full_name.charAt(0).toUpperCase() : user?.email?.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{user?.full_name || user?.email}</span>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="p-2 text-[#8a6a5c] hover:bg-[#FDF6F0] rounded-full transition-colors"
                        >
                            <LogOut className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                    <div>
                        <h2 className="text-3xl font-bold mb-2">Your Projects</h2>
                        <p className="text-[#8a6a5c]">Manage and organize your learning materials</p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                        <div className="relative w-full md:w-auto">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#8a6a5c]" />
                            <input
                                type="text"
                                placeholder="Search projects..."
                                className="pl-12 pr-4 py-3 bg-white border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none w-full md:w-64"
                            />
                        </div>
                        <button
                            onClick={() => navigate('/bookstore')}
                            className="px-6 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl font-medium hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
                        >
                            <Globe className="h-5 w-5" />
                            <span>Book Store</span>
                        </button>
                        <button
                            onClick={openNewProjectModal}
                            className="px-6 py-3 bg-[#C8A288] text-white rounded-xl font-medium hover:bg-[#B08B72] transition-colors flex items-center justify-center gap-2 shadow-lg shadow-[#C8A288]/20 w-full md:w-auto"
                        >
                            <Plus className="h-5 w-5" />
                            <span>New Project</span>
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            onClick={() => navigate(`/project/${project.id}`)}
                            className="group bg-white p-6 rounded-2xl border border-[#E6D5CC] hover:border-[#C8A288] hover:shadow-lg hover:shadow-[#C8A288]/10 transition-all cursor-pointer relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="h-5 w-5 text-[#C8A288]" />
                            </div>

                            <button
                                onClick={(e) => handleDeleteClick(e, project.id)}
                                className="absolute top-4 right-4 p-2 text-[#8a6a5c] hover:text-red-600 hover:bg-red-50 rounded-full transition-colors z-20 opacity-100"
                                title="Delete Project"
                            >
                                <Trash2 className="h-5 w-5" />
                            </button>

                            <div className="h-12 w-12 bg-[#FDF6F0] rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                                <BookOpen className="h-6 w-6 text-[#C8A288]" />
                            </div>

                            <h3 className="text-xl font-bold mb-2 group-hover:text-[#C8A288] transition-colors">{project.name}</h3>

                            <div className="flex items-center gap-4 text-sm text-[#8a6a5c] mt-4 pt-4 border-t border-[#FDF6F0]">
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(project.created_at).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <BookOpen className="h-4 w-4" />
                                    <span>{project.docs || 0} Docs</span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* New Project Card Placeholder */}
                    <button
                        onClick={openNewProjectModal}
                        className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0]/50 transition-all group h-full min-h-[200px]"
                    >
                        <div className="h-12 w-12 bg-[#FDF6F0] rounded-full flex items-center justify-center mb-4 group-hover:bg-[#C8A288] transition-colors">
                            <Plus className="h-6 w-6 text-[#C8A288] group-hover:text-white transition-colors" />
                        </div>
                        <span className="font-medium text-[#8a6a5c] group-hover:text-[#C8A288]">Create New Project</span>
                    </button>
                </div>
            </main>

            {showNewProjectModal && (
                <div
                    className="fixed inset-0 bg-[#2A1F18]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
                    onClick={e => e.target === e.currentTarget && closeNewProjectModal()}
                >
                    <div className="bg-white rounded-3xl shadow-2xl w-full overflow-hidden flex flex-col" style={{ maxWidth: '600px', maxHeight: '92vh' }}>

                        {/* Top bar */}
                        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#E6D5CC] shrink-0">
                            <div className="flex items-center gap-3">
                                {modalStep !== 'pick' && !isCreating && (
                                    <button onClick={() => setModalStep('pick')} className="p-1.5 hover:bg-[#FDF6F0] rounded-lg transition-colors text-[#8a6a5c]">
                                        <ArrowLeft className="h-4 w-4" />
                                    </button>
                                )}
                                <div>
                                    <h3 className="text-lg font-bold text-[#4A3B32]">
                                        {modalStep === 'pick' ? 'Create New Project' : modalStep === 'store' ? '📚 Import from Book Store' : '📄 Upload Your Files'}
                                    </h3>
                                    <p className="text-xs text-[#8a6a5c]">
                                        {modalStep === 'pick' ? 'Name your project and choose how to add content' : modalStep === 'store' ? 'Browse and import community books' : 'Choose visibility for your uploaded file'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={closeNewProjectModal} className="p-2 hover:bg-[#FDF6F0] rounded-full transition-colors text-[#8a6a5c]">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Step dots */}
                        <div className="flex gap-1.5 px-6 pt-3 shrink-0">
                            {['pick', 'store', 'upload'].map(s => (
                                <div key={s} className={`h-1 rounded-full transition-all duration-300 ${modalStep === s ? 'w-8 bg-[#C8A288]' : 'w-2 bg-[#E6D5CC]'}`} />
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

                            {/* ── STEP: Pick source ── */}
                            {modalStep === 'pick' && (
                                <div className="p-6 space-y-5">
                                    {/* Project Name */}
                                    <div>
                                        <label className="block text-sm font-semibold text-[#4A3B32] mb-1.5">Project Name <span className="text-[#C8A288]">*</span></label>
                                        <input
                                            type="text"
                                            autoFocus
                                            value={newProjectName}
                                            onChange={e => setNewProjectName(e.target.value)}
                                            placeholder="e.g., Biology 101"
                                            className="w-full px-4 py-3 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none text-base"
                                        />
                                    </div>

                                    <p className="text-sm font-semibold text-[#4A3B32]">How would you like to add content?</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Book Store card */}
                                        <button
                                            onClick={() => setModalStep('store')}
                                            className="group flex flex-col items-center text-center p-5 rounded-2xl border-2 border-[#E6D5CC] hover:border-emerald-400 hover:bg-emerald-50/50 transition-all duration-200 hover:shadow-lg"
                                        >
                                            <div className="h-12 w-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center mb-3 shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                                                <Globe className="h-6 w-6 text-white" />
                                            </div>
                                            <p className="font-bold text-sm text-[#4A3B32] mb-1">From Book Store</p>
                                            <p className="text-[11px] text-[#8a6a5c] leading-relaxed">Browse &amp; import community books instantly</p>
                                            <span className="mt-3 px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full text-[10px] font-semibold">Community Books</span>
                                        </button>

                                        {/* Upload card */}
                                        <button
                                            onClick={() => setModalStep('upload')}
                                            className="group flex flex-col items-center text-center p-5 rounded-2xl border-2 border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0] transition-all duration-200 hover:shadow-lg"
                                        >
                                            <div className="h-12 w-12 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-xl flex items-center justify-center mb-3 shadow-md shadow-[#C8A288]/20 group-hover:scale-110 transition-transform">
                                                <Upload className="h-6 w-6 text-white" />
                                            </div>
                                            <p className="font-bold text-sm text-[#4A3B32] mb-1">Upload Your File</p>
                                            <p className="text-[11px] text-[#8a6a5c] leading-relaxed">PDF, DOCX or TXT — private or share publicly</p>
                                            <span className="mt-3 px-2.5 py-1 bg-[#FDF6F0] text-[#C8A288] border border-[#E6D5CC] rounded-full text-[10px] font-semibold">PDF / DOCX / TXT</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* ── STEP: Book Store ── */}
                            {modalStep === 'store' && (
                                <div className="flex flex-col flex-1 min-h-0">
                                    {/* Project name reminder */}
                                    <div className="px-6 pt-4 pb-2 shrink-0">
                                        <input
                                            type="text"
                                            value={newProjectName}
                                            onChange={e => setNewProjectName(e.target.value)}
                                            placeholder="Project name (required before importing)"
                                            className="w-full px-3 py-2.5 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none mb-3"
                                        />
                                        <form onSubmit={handleBsSearch} className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a6a5c]" />
                                                <input
                                                    type="text"
                                                    value={bsSearchInput}
                                                    onChange={e => setBsSearchInput(e.target.value)}
                                                    placeholder="Search by title, author, topic..."
                                                    autoFocus
                                                    className="w-full pl-8 pr-3 py-2 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl text-sm focus:ring-2 focus:ring-[#C8A288] outline-none"
                                                />
                                            </div>
                                            <button type="submit" className="px-3 py-2 bg-[#C8A288] text-white rounded-xl text-sm font-medium hover:bg-[#B08B72] transition-colors">Search</button>
                                        </form>
                                        {!bsLoading && <p className="text-xs text-[#8a6a5c] mt-1.5">{bsTotal} books available</p>}
                                    </div>

                                    <div className="flex-1 overflow-y-auto px-6 pb-4">
                                        {bsLoading ? (
                                            <div className="grid grid-cols-2 gap-3">
                                                {[...Array(4)].map((_, i) => (
                                                    <div key={i} className="p-3 bg-[#FDF6F0] rounded-xl animate-pulse h-28" />
                                                ))}
                                            </div>
                                        ) : bsBooks.length === 0 ? (
                                            <div className="text-center py-10">
                                                <BookOpen className="h-10 w-10 text-[#C8A288] mx-auto mb-2 opacity-40" />
                                                <p className="text-sm text-[#8a6a5c]">{bsSearch ? 'No results found' : 'No public books yet'}</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-3">
                                                {bsBooks.map(book => {
                                                    const imported = bsImportedIds.has(book.id);
                                                    const importing = bsImportingId === book.id;
                                                    return (
                                                        <div key={book.id} className="flex flex-col p-3 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl hover:border-[#C8A288] transition-all">
                                                            <div className="flex items-start gap-2 mb-2">
                                                                <div className="h-8 w-6 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded flex items-center justify-center shrink-0">
                                                                    <BookOpen className="h-3 w-3 text-white" />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-semibold text-xs text-[#4A3B32] line-clamp-2 leading-tight">{book.title}</p>
                                                                    {book.author && <p className="text-[10px] text-[#8a6a5c]">{book.author}</p>}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleBsImport(book)}
                                                                disabled={importing || imported || !newProjectName.trim()}
                                                                className={`mt-auto w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                                                    imported ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                                                                    : !newProjectName.trim() ? 'bg-[#E6D5CC] text-[#8a6a5c] cursor-not-allowed'
                                                                    : 'bg-[#C8A288] text-white hover:bg-[#B08B72]'
                                                                }`}
                                                                title={!newProjectName.trim() ? 'Enter a project name first' : ''}
                                                            >
                                                                {importing ? <><Loader2 className="h-3 w-3 animate-spin" />Adding...</>
                                                                : imported ? <><Check className="h-3 w-3" />Added!</>
                                                                : <><Download className="h-3 w-3" />Add to Project</>}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {bsTotalPages > 1 && (
                                        <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-[#E6D5CC] shrink-0">
                                            <button onClick={() => setBsPage(p => Math.max(1, p - 1))} disabled={bsPage === 1} className="px-3 py-1.5 rounded-lg border border-[#E6D5CC] text-xs disabled:opacity-40 hover:bg-[#FDF6F0] transition-colors">← Prev</button>
                                            <span className="text-xs text-[#8a6a5c]">Page {bsPage} of {bsTotalPages}</span>
                                            <button onClick={() => setBsPage(p => Math.min(bsTotalPages, p + 1))} disabled={bsPage === bsTotalPages} className="px-3 py-1.5 rounded-lg border border-[#E6D5CC] text-xs disabled:opacity-40 hover:bg-[#FDF6F0] transition-colors">Next →</button>
                                        </div>
                                    )}

                                    <div className="px-6 pb-5 pt-2 shrink-0 border-t border-[#E6D5CC]">
                                        <button
                                            onClick={closeNewProjectModal}
                                            disabled={bsImportedIds.size === 0}
                                            className="w-full py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#C8A288] to-[#B08B72] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all flex items-center justify-center gap-2"
                                        >
                                            <Check className="h-4 w-4" />
                                            Done — Go to Project ({bsImportedIds.size} book{bsImportedIds.size !== 1 ? 's' : ''} added)
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* ── STEP: Upload ── */}
                            {modalStep === 'upload' && !isCreating && (
                                <form onSubmit={handleCreateProject} className="flex flex-col flex-1 min-h-0">
                                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                        {/* Project name */}
                                        <div>
                                            <label className="block text-sm font-semibold text-[#4A3B32] mb-1.5">Project Name <span className="text-[#C8A288]">*</span></label>
                                            <input
                                                type="text"
                                                value={newProjectName}
                                                onChange={e => setNewProjectName(e.target.value)}
                                                placeholder="e.g., Biology 101"
                                                className="w-full px-4 py-3 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none"
                                            />
                                        </div>

                                        {/* Drop zone */}
                                        <div>
                                            <label className="block text-sm font-semibold text-[#4A3B32] mb-1.5">Upload Documents <span className="text-[#C8A288]">*</span></label>
                                            <div
                                                onClick={() => fileInputRef.current?.click()}
                                                onDragEnter={handleDrag}
                                                onDragLeave={handleDrag}
                                                onDragOver={handleDrag}
                                                onDrop={handleDrop}
                                                className={`w-full py-8 bg-[#FDF6F0] border-2 border-dashed rounded-2xl cursor-pointer transition-all flex flex-col items-center gap-2 text-[#8a6a5c] ${
                                                    dragActive ? 'border-[#C8A288] bg-[#FDF6F0] scale-[1.01]' : 'border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0]/80'
                                                }`}
                                            >
                                                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${dragActive ? 'bg-[#C8A288]' : 'bg-[#F5EBE4]'}`}>
                                                    <Upload className={`h-6 w-6 ${dragActive ? 'text-white' : 'text-[#C8A288]'}`} />
                                                </div>
                                                <p className="font-semibold text-sm text-[#4A3B32]">{dragActive ? 'Drop it!' : 'Click or drag files here'}</p>
                                                <p className="text-xs">PDF, TXT, DOCX — multiple allowed</p>
                                                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.txt,.docx" multiple onChange={handleFileSelect} />
                                            </div>

                                            {selectedFiles.length > 0 && (
                                                <div className="mt-3 space-y-2 max-h-36 overflow-y-auto">
                                                    {selectedFiles.map((file, idx) => (
                                                        <div key={idx} className="flex items-center justify-between p-2.5 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl">
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <FileText className="h-4 w-4 text-[#C8A288] shrink-0" />
                                                                <span className="text-sm truncate">{file.name}</span>
                                                            </div>
                                                            <button type="button" onClick={() => removeFile(idx)} className="p-1 hover:bg-red-100 rounded-lg transition-colors">
                                                                <X className="h-3.5 w-3.5 text-red-500" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Public/Private Toggle — shown once file selected */}
                                        {selectedFiles.length > 0 && (
                                            <div className="rounded-2xl border-2 border-[#E6D5CC] overflow-hidden">
                                                <button
                                                    type="button"
                                                    onClick={() => { setIsPublic(p => !p); if (!isPublic) setShowBookMeta(true); }}
                                                    className={`w-full flex items-center justify-between px-4 py-3.5 transition-all ${
                                                        isPublic ? 'bg-gradient-to-r from-[#C8A288]/15 to-[#B08B72]/5' : 'bg-[#FAFAF9] hover:bg-[#FDF6F0]'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${isPublic ? 'bg-[#C8A288] shadow-md shadow-[#C8A288]/30' : 'bg-[#E6D5CC]'}`}>
                                                            {isPublic ? <Globe className="h-4 w-4 text-white" /> : <Lock className="h-4 w-4 text-[#8a6a5c]" />}
                                                        </div>
                                                        <div className="text-left">
                                                            <p className="text-sm font-bold text-[#4A3B32]">
                                                                {isPublic ? '🌐 Public — Share in Book Store' : '🔒 Private — Only you'}
                                                            </p>
                                                            <p className="text-xs text-[#8a6a5c]">
                                                                {isPublic ? 'Visible to all users in the Book Store' : 'Only accessible within your projects'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className={`w-10 h-5 rounded-full relative shrink-0 transition-colors ${isPublic ? 'bg-[#C8A288]' : 'bg-[#D9C8BE]'}`}>
                                                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${isPublic ? 'left-5' : 'left-0.5'}`} />
                                                    </div>
                                                </button>

                                                {isPublic && (
                                                    <div className="border-t border-[#E6D5CC] bg-white p-4 space-y-3">
                                                        <button type="button" onClick={() => setShowBookMeta(p => !p)} className="flex items-center gap-1.5 text-xs text-[#8a6a5c] hover:text-[#C8A288] font-medium transition-colors">
                                                            {showBookMeta ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                            {showBookMeta ? 'Hide book info' : 'Add book info (optional but recommended)'}
                                                        </button>
                                                        {showBookMeta && (
                                                            <div className="space-y-3">
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-[#4A3B32] mb-1">Book Title</label>
                                                                    <input type="text" value={bookTitle} onChange={e => setBookTitle(e.target.value)} placeholder="e.g., Introduction to Physics" className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none" />
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-[#4A3B32] mb-1">Author</label>
                                                                        <input type="text" value={bookAuthor} onChange={e => setBookAuthor(e.target.value)} placeholder="Jane Smith" className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-[#4A3B32] mb-1">Tags</label>
                                                                        <div className="relative">
                                                                            <Tag className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#8a6a5c]" />
                                                                            <input type="text" value={bookTags} onChange={e => setBookTags(e.target.value)} placeholder="physics, science" className="w-full pl-6 pr-2 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none" />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-[#4A3B32] mb-1">Description</label>
                                                                    <textarea value={bookDescription} onChange={e => setBookDescription(e.target.value)} placeholder="Brief description..." rows={2} className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none resize-none" />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Footer CTAs */}
                                    <div className="px-6 pb-6 pt-3 border-t border-[#E6D5CC] shrink-0 flex gap-3">
                                        <button type="button" onClick={() => setModalStep('pick')} className="px-5 py-3 rounded-xl font-medium text-[#8a6a5c] hover:bg-[#FDF6F0] transition-colors">
                                            Back
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={!newProjectName.trim() || selectedFiles.length === 0}
                                            className="flex-1 py-3 bg-gradient-to-r from-[#C8A288] to-[#B08B72] text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#C8A288]/20 hover:shadow-xl transition-all flex items-center justify-center gap-2"
                                        >
                                            {isPublic ? <Globe className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                                            {isPublic ? 'Create & Share in Book Store' : 'Create & Start'}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {/* ── Creating / Uploading progress ── */}
                            {isCreating && (
                                <div className="p-6 space-y-4">
                                    <div className="text-center py-4">
                                        <div className="relative w-16 h-16 mx-auto mb-4">
                                            <div className="absolute inset-0 border-4 border-[#E6D5CC] rounded-full" />
                                            <div className="absolute inset-0 border-4 border-[#C8A288] rounded-full border-t-transparent animate-spin" />
                                            <BookOpen className="absolute inset-0 m-auto h-6 w-6 text-[#C8A288] animate-pulse" />
                                        </div>
                                        <h4 className="font-bold text-lg text-[#C8A288] mb-1">Synthesizing Project</h4>
                                        <p className="text-sm italic text-[#4A3B32] min-h-[40px]">{getRotatingLoadingMessage(loadingMsgIdx)}</p>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto border-t border-[#E6D5CC] pt-4 space-y-2">
                                        {selectedFiles.map((file, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-sm p-2 rounded-xl bg-[#FDF6F0]">
                                                <span className="truncate max-w-[70%]">{file.name}</span>
                                                <span className={`font-bold text-xs px-2 py-1 rounded-lg ${
                                                    uploadStatus[file.name] === 'success' ? 'bg-green-100 text-green-700'
                                                    : uploadStatus[file.name] === 'error' ? 'bg-red-100 text-red-700'
                                                    : uploadStatus[file.name] === 'uploading' ? 'bg-blue-100 text-blue-700'
                                                    : 'bg-gray-100 text-gray-500'
                                                }`}>
                                                    {uploadStatus[file.name] === 'uploading' ? 'Uploading…' : uploadStatus[file.name] === 'success' ? '✓ Done' : uploadStatus[file.name] === 'error' ? '✗ Failed' : 'Pending'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Delete Confirmation Modal */}
            {deleteTargetId && (
                <div className="fixed inset-0 bg-[#4A3B32]/20 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200 text-center">
                        <div className="h-16 w-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-4">
                            <Trash2 className="h-8 w-8" />
                        </div>
                        <h3 className="text-xl font-bold mb-2 text-[#4A3B32]">Delete Project?</h3>
                        <p className="text-[#8a6a5c] mb-6 text-sm">
                            This action cannot be undone. All documents and chats associated with this project will be permanently removed.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteTargetId(null)}
                                disabled={isDeleting}
                                className="flex-1 py-3 px-4 rounded-xl font-medium text-[#8a6a5c] hover:bg-[#FDF6F0] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteProject}
                                disabled={isDeleting}
                                className="flex-1 py-3 px-4 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2"
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>Deleting...</span>
                                    </>
                                ) : (
                                    <span>Delete</span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;