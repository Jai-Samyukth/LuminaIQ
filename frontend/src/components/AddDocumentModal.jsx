import React, { useState, useCallback, useEffect } from 'react';
import {
    X, Globe, Upload, BookOpen, ArrowLeft, File, Check,
    Lock, ChevronDown, ChevronUp, Tag, Loader2, Search,
    Download, ChevronLeft, ChevronRight
} from 'lucide-react';
import { getPublicBooks, importBook } from '../api';
import { useToast } from '../context/ToastContext';

/* ─────────────────────────────────────────────────────────────
   Step 1 — Source Picker
───────────────────────────────────────────────────────────── */
const SourcePicker = ({ onChoose }) => (
    <div className="p-8">
        <h2 className="text-2xl font-bold text-[#4A3B32] mb-1">Add Document</h2>
        <p className="text-sm text-[#8a6a5c] mb-8">
            How would you like to add content to this project?
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Book Store Option */}
            <button
                onClick={() => onChoose('store')}
                className="group flex flex-col items-center text-center p-7 rounded-2xl border-2 border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0] transition-all duration-200 hover:shadow-lg hover:shadow-[#C8A288]/10"
            >
                <div className="h-16 w-16 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform duration-200">
                    <Globe className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-base font-bold text-[#4A3B32] mb-2">
                    From Book Store
                </h3>
                <p className="text-xs text-[#8a6a5c] leading-relaxed">
                    Browse books shared publicly by other users and add them to your project instantly
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold">
                    <Globe className="h-3 w-3" />
                    Community Books
                </span>
            </button>

            {/* Upload Option */}
            <button
                onClick={() => onChoose('upload')}
                className="group flex flex-col items-center text-center p-7 rounded-2xl border-2 border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0] transition-all duration-200 hover:shadow-lg hover:shadow-[#C8A288]/10"
            >
                <div className="h-16 w-16 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-[#C8A288]/20 group-hover:scale-110 transition-transform duration-200">
                    <Upload className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-base font-bold text-[#4A3B32] mb-2">
                    Upload Your File
                </h3>
                <p className="text-xs text-[#8a6a5c] leading-relaxed">
                    Upload a PDF, DOCX or TXT file — keep it private or share it publicly in the Book Store
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FDF6F0] text-[#C8A288] border border-[#E6D5CC] rounded-full text-xs font-semibold">
                    <Upload className="h-3 w-3" />
                    PDF / DOCX / TXT
                </span>
            </button>
        </div>
    </div>
);

/* ─────────────────────────────────────────────────────────────
   Step 2A — Book Store Browse & Import
───────────────────────────────────────────────────────────── */
const BookStoreStep = ({ projectId, onImported, onBack }) => {
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [importingId, setImportingId] = useState(null);
    const [importedIds, setImportedIds] = useState(new Set());
    const toast = useToast();

    const fetchBooks = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getPublicBooks(page, search);
            setBooks(data.books || []);
            setTotalPages(data.total_pages || 1);
            setTotal(data.total || 0);
        } catch {
            toast.error('Failed to load books');
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => { fetchBooks(); }, [fetchBooks]);

    const handleSearch = (e) => {
        e.preventDefault();
        setSearch(searchInput);
        setPage(1);
    };

    const handleImport = async (book) => {
        if (importingId || importedIds.has(book.id)) return;
        setImportingId(book.id);
        try {
            const result = await importBook(book.id, projectId);
            setImportedIds(s => new Set([...s, book.id]));
            toast.success(`"${book.title}" is being added to your project!`);
            if (onImported) onImported(result.document);
        } catch (err) {
            if (err.response?.status === 409) {
                toast.info('This book is already in your project');
                setImportedIds(s => new Set([...s, book.id]));
            } else {
                toast.error(err.response?.data?.detail || 'Import failed');
            }
        } finally {
            setImportingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[#E6D5CC] shrink-0">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={onBack} className="p-2 hover:bg-[#FDF6F0] rounded-xl transition-colors text-[#8a6a5c] hover:text-[#4A3B32]">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="h-8 w-8 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center">
                        <Globe className="h-4 w-4 text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-[#4A3B32]">Book Store</h3>
                        <p className="text-xs text-[#8a6a5c]">Import a community book into your project</p>
                    </div>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a6a5c]" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Search by title, author, topic..."
                            className="w-full pl-9 pr-3 py-2.5 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl text-sm focus:ring-2 focus:ring-[#C8A288] outline-none"
                            autoFocus
                        />
                    </div>
                    <button type="submit" className="px-4 py-2.5 bg-[#C8A288] text-white rounded-xl text-sm font-medium hover:bg-[#B08B72] transition-colors">
                        Search
                    </button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }} className="p-2.5 border border-[#E6D5CC] rounded-xl text-[#8a6a5c] hover:bg-[#FDF6F0]">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </form>
                {!loading && (
                    <p className="text-xs text-[#8a6a5c] mt-2">
                        {search ? `${total} result${total !== 1 ? 's' : ''} for "${search}"` : `${total} books in the store`}
                    </p>
                )}
            </div>

            {/* Book Grid */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="p-4 bg-[#FDF6F0] rounded-xl animate-pulse">
                                <div className="flex gap-3 mb-3">
                                    <div className="h-10 w-8 bg-[#E6D5CC] rounded-lg shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 bg-[#E6D5CC] rounded w-3/4" />
                                        <div className="h-3 bg-[#E6D5CC] rounded w-1/2" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : books.length === 0 ? (
                    <div className="text-center py-16">
                        <BookOpen className="h-12 w-12 text-[#C8A288] mx-auto mb-3 opacity-40" />
                        <p className="font-medium text-[#4A3B32]">{search ? 'No books match your search' : 'No public books yet'}</p>
                        <p className="text-sm text-[#8a6a5c] mt-1">Be the first to share a book!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {books.map(book => {
                            const isImported = importedIds.has(book.id);
                            const isImporting = importingId === book.id;
                            return (
                                <div key={book.id} className="flex flex-col p-4 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl hover:border-[#C8A288] hover:shadow-md hover:shadow-[#C8A288]/10 transition-all">
                                    <div className="flex items-start gap-3 mb-2">
                                        <div className="h-10 w-8 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                                            <BookOpen className="h-4 w-4 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-sm text-[#4A3B32] line-clamp-1 leading-tight">{book.title}</h4>
                                            {book.author && <p className="text-xs text-[#8a6a5c]">by {book.author}</p>}
                                        </div>
                                    </div>

                                    {book.description && (
                                        <p className="text-xs text-[#8a6a5c] line-clamp-2 mb-2 leading-relaxed">{book.description}</p>
                                    )}

                                    {book.tags?.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {book.tags.slice(0, 3).map((tag, i) => (
                                                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white text-[#8a6a5c] rounded-full text-[10px] border border-[#E6D5CC]">
                                                    <Tag className="h-2 w-2" />{tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-[#E6D5CC]">
                                        <span className="text-[10px] text-[#8a6a5c] flex items-center gap-1">
                                            <Download className="h-2.5 w-2.5" />
                                            {book.import_count || 0} imports
                                        </span>
                                        <button
                                            onClick={() => handleImport(book)}
                                            disabled={isImporting || isImported}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                isImported
                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                                                    : 'bg-[#C8A288] text-white hover:bg-[#B08B72] disabled:opacity-60 shadow-sm hover:shadow-md'
                                            }`}
                                        >
                                            {isImporting ? (
                                                <><Loader2 className="h-3 w-3 animate-spin" />Adding...</>
                                            ) : isImported ? (
                                                <><Check className="h-3 w-3" />Added!</>
                                            ) : (
                                                <><Download className="h-3 w-3" />Add to Project</>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="px-6 py-3 border-t border-[#E6D5CC] flex items-center justify-center gap-3 shrink-0">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="p-2 border border-[#E6D5CC] rounded-lg hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors">
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm text-[#8a6a5c] font-medium">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="p-2 border border-[#E6D5CC] rounded-lg hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors">
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────────────────────────
   Step 2B — Upload File (with Public / Private toggle)
───────────────────────────────────────────────────────────── */
const UploadStep = ({ onUpload, uploading, onBack }) => {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [showMeta, setShowMeta] = useState(false);
    const [bookTitle, setBookTitle] = useState('');
    const [bookAuthor, setBookAuthor] = useState('');
    const [bookDescription, setBookDescription] = useState('');
    const [bookTags, setBookTags] = useState('');

    const accept = ['.pdf', '.docx', '.txt'];

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files).filter(f =>
            accept.some(ext => f.name.toLowerCase().endsWith(ext))
        );
        if (files.length) {
            setSelectedFiles(files);
            if (!bookTitle) setBookTitle(files[0].name.replace(/\.[^.]+$/, ''));
        }
    }, [bookTitle]);

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (files.length) {
            setSelectedFiles(files);
            if (!bookTitle) setBookTitle(files[0].name.replace(/\.[^.]+$/, ''));
        }
    };

    const handleSubmit = () => {
        if (!selectedFiles.length || uploading) return;
        const bookOptions = isPublic ? {
            isPublic: true,
            bookTitle: bookTitle || selectedFiles[0]?.name,
            bookAuthor: bookAuthor || undefined,
            bookDescription: bookDescription || undefined,
            bookTags: bookTags || undefined,
        } : {};
        onUpload(selectedFiles, bookOptions);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[#E6D5CC] shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-[#FDF6F0] rounded-xl transition-colors text-[#8a6a5c] hover:text-[#4A3B32]">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="h-8 w-8 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-xl flex items-center justify-center">
                        <Upload className="h-4 w-4 text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-[#4A3B32]">Upload File</h3>
                        <p className="text-xs text-[#8a6a5c]">Choose visibility after selecting your file</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Drop Zone */}
                <div
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                    className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
                        isDragging ? 'border-[#C8A288] bg-[#FDF6F0] scale-[1.01]' : 'border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0]/50'
                    }`}
                >
                    <div className={`h-14 w-14 mx-auto mb-3 rounded-2xl flex items-center justify-center ${isDragging ? 'bg-[#C8A288]' : 'bg-[#F5EBE4]'}`}>
                        <Upload className={`h-7 w-7 ${isDragging ? 'text-white' : 'text-[#C8A288]'}`} />
                    </div>
                    <p className="text-sm font-semibold text-[#4A3B32] mb-1">
                        {isDragging ? 'Drop it!' : 'Drag & drop your file here'}
                    </p>
                    <p className="text-xs text-[#8a6a5c] mb-3">PDF, DOCX, TXT — up to 10MB</p>
                    <label className="inline-block px-5 py-2.5 bg-[#C8A288] text-white text-sm font-medium rounded-xl hover:bg-[#B08B72] cursor-pointer transition-colors shadow-md shadow-[#C8A288]/20">
                        Browse Files
                        <input type="file" multiple accept=".pdf,.docx,.txt" onChange={handleFileSelect} className="hidden" />
                    </label>
                </div>

                {/* Selected files */}
                {selectedFiles.length > 0 && (
                    <div className="space-y-2">
                        {selectedFiles.map((f, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl">
                                <div className="h-8 w-8 bg-[#C8A288]/10 rounded-lg flex items-center justify-center shrink-0">
                                    <File className="h-4 w-4 text-[#C8A288]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-[#4A3B32] truncate">{f.name}</p>
                                    <p className="text-xs text-[#8a6a5c]">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                                {!uploading && (
                                    <button onClick={() => setSelectedFiles(fs => fs.filter((_, j) => j !== i))} className="p-1 hover:bg-red-100 rounded-lg transition-colors">
                                        <X className="h-3.5 w-3.5 text-red-500" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Public / Private Toggle — shown once file is selected */}
                {selectedFiles.length > 0 && (
                    <div className="rounded-2xl border-2 border-[#E6D5CC] overflow-hidden">
                        {/* Toggle header */}
                        <button
                            type="button"
                            onClick={() => { setIsPublic(p => !p); if (!isPublic) setShowMeta(true); }}
                            className={`w-full flex items-center justify-between px-4 py-4 transition-all ${
                                isPublic
                                    ? 'bg-gradient-to-r from-[#C8A288]/15 to-[#B08B72]/5'
                                    : 'bg-[#FAFAF9] hover:bg-[#FDF6F0]'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${isPublic ? 'bg-[#C8A288] shadow-md shadow-[#C8A288]/30' : 'bg-[#E6D5CC]'}`}>
                                    {isPublic
                                        ? <Globe className="h-5 w-5 text-white" />
                                        : <Lock className="h-5 w-5 text-[#8a6a5c]" />
                                    }
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-bold text-[#4A3B32]">
                                        {isPublic ? '🌐 Public — Visible in Book Store' : '🔒 Private — Only you'}
                                    </p>
                                    <p className="text-xs text-[#8a6a5c]">
                                        {isPublic
                                            ? 'This book will appear in the public Book Store'
                                            : 'Only you can use this document in your projects'}
                                    </p>
                                </div>
                            </div>
                            {/* Toggle pill */}
                            <div className={`w-11 h-6 rounded-full relative shrink-0 transition-colors duration-200 ${isPublic ? 'bg-[#C8A288]' : 'bg-[#D9C8BE]'}`}>
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-200 ${isPublic ? 'left-6' : 'left-1'}`} />
                            </div>
                        </button>

                        {/* Public metadata fields */}
                        {isPublic && (
                            <div className="border-t border-[#E6D5CC] bg-white p-4 space-y-3">
                                <button
                                    type="button"
                                    onClick={() => setShowMeta(p => !p)}
                                    className="flex items-center gap-1.5 text-xs text-[#8a6a5c] hover:text-[#C8A288] transition-colors font-medium"
                                >
                                    {showMeta ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    {showMeta ? 'Hide book info' : 'Add book info (optional but recommended)'}
                                </button>

                                {showMeta && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-[#4A3B32] mb-1.5">
                                                Book Title <span className="text-[#C8A288]">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={bookTitle}
                                                onChange={e => setBookTitle(e.target.value)}
                                                placeholder="e.g., Introduction to Physics"
                                                className="w-full px-3 py-2.5 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-[#4A3B32] mb-1.5">Author</label>
                                                <input
                                                    type="text"
                                                    value={bookAuthor}
                                                    onChange={e => setBookAuthor(e.target.value)}
                                                    placeholder="e.g., Jane Smith"
                                                    className="w-full px-3 py-2.5 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-[#4A3B32] mb-1.5">
                                                    Tags <span className="font-normal text-[#8a6a5c]">(comma sep)</span>
                                                </label>
                                                <div className="relative">
                                                    <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[#8a6a5c]" />
                                                    <input
                                                        type="text"
                                                        value={bookTags}
                                                        onChange={e => setBookTags(e.target.value)}
                                                        placeholder="physics, science"
                                                        className="w-full pl-7 pr-2.5 py-2.5 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-[#4A3B32] mb-1.5">Description</label>
                                            <textarea
                                                value={bookDescription}
                                                onChange={e => setBookDescription(e.target.value)}
                                                placeholder="Brief description to help others discover this book..."
                                                rows={2}
                                                className="w-full px-3 py-2.5 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none resize-none"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Upload CTA */}
            <div className="px-6 pb-6 pt-3 shrink-0 border-t border-[#E6D5CC]">
                <button
                    onClick={handleSubmit}
                    disabled={uploading || !selectedFiles.length}
                    className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-lg ${
                        uploading || !selectedFiles.length
                            ? 'bg-[#E6D5CC] text-[#8a6a5c] cursor-not-allowed shadow-none'
                            : isPublic
                                ? 'bg-gradient-to-r from-[#C8A288] to-[#B08B72] text-white hover:shadow-xl hover:shadow-[#C8A288]/25 hover:scale-[1.01]'
                                : 'bg-gradient-to-r from-[#C8A288] to-[#B08B72] text-white hover:shadow-xl hover:shadow-[#C8A288]/25 hover:scale-[1.01]'
                    }`}
                >
                    {uploading ? (
                        <><Loader2 className="h-5 w-5 animate-spin" />Uploading...</>
                    ) : (
                        <>
                            {isPublic ? <Globe className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                            {isPublic
                                ? `Upload & Share in Book Store`
                                : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''} Privately`}
                        </>
                    )}
                </button>
                {isPublic && (
                    <p className="text-center text-xs text-[#8a6a5c] mt-2">
                        📚 Your book will appear in the public Book Store after processing
                    </p>
                )}
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────────────────────────
   Root — AddDocumentModal
   Props:
     projectId  — current project
     uploading  — from parent
     onUpload   — (files, bookOptions) => void
     onImported — (doc) => void  [after book store import]
     onClose    — close the modal
───────────────────────────────────────────────────────────── */
const AddDocumentModal = ({ projectId, uploading, onUpload, onImported, onClose }) => {
    const [step, setStep] = useState('pick'); // 'pick' | 'store' | 'upload'

    const handleUpload = (files, bookOptions) => {
        onUpload(files, bookOptions);
        // Modal stays open so the user can see the uploading spinner in UploadStep
        // Parent should close it after upload completes
    };

    const handleImported = (doc) => {
        if (onImported) onImported(doc);
        // Stay open so user can import more books; they can close manually
    };

    return (
        <div
            className="fixed inset-0 bg-[#2A1F18]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div
                className="bg-white rounded-3xl shadow-2xl w-full overflow-hidden flex flex-col"
                style={{ maxWidth: '640px', maxHeight: '90vh' }}
            >
                {/* Modal top bar */}
                <div className="flex items-center justify-between px-6 pt-5 pb-0 shrink-0">
                    <div className="flex gap-1.5">
                        {/* Step indicator dots */}
                        {['pick', 'store', 'upload'].map((s, i) => (
                            <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${
                                step === s
                                    ? 'w-6 bg-[#C8A288]'
                                    : 'w-1.5 bg-[#E6D5CC]'
                            }`} />
                        ))}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-[#FDF6F0] rounded-full transition-colors text-[#8a6a5c] hover:text-[#4A3B32]"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Step content */}
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    {step === 'pick' && (
                        <SourcePicker onChoose={setStep} />
                    )}
                    {step === 'store' && (
                        <BookStoreStep
                            projectId={projectId}
                            onImported={handleImported}
                            onBack={() => setStep('pick')}
                        />
                    )}
                    {step === 'upload' && (
                        <UploadStep
                            onUpload={handleUpload}
                            uploading={uploading}
                            onBack={() => setStep('pick')}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddDocumentModal;
