import React, { useState, useEffect, useCallback } from 'react';
import {
    Search, Globe, BookOpen, Download, Users, Tag, Star,
    Loader2, X, ChevronLeft, ChevronRight, AlertCircle, Check
} from 'lucide-react';
import { getPublicBooks, importBook, getProjects } from '../api';
import { useToast } from '../context/ToastContext';

const BookCard = ({ book, onImport, onPreview }) => {
    const [importing, setImporting] = useState(false);
    const [imported, setImported] = useState(false);

    const handleImport = async (projectId) => {
        setImporting(true);
        try {
            await onImport(book.id, projectId);
            setImported(true);
        } finally {
            setImporting(false);
        }
    };

    return (
        <div
            onClick={() => onPreview(book)}
            className="group bg-white border border-[#E6D5CC] rounded-2xl p-5 hover:border-[#C8A288] hover:shadow-lg hover:shadow-[#C8A288]/10 transition-all cursor-pointer"
        >
            {/* Book header */}
            <div className="flex items-start gap-3 mb-4">
                <div className="h-12 w-10 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-lg flex items-center justify-center shrink-0 shadow-md shadow-[#C8A288]/20">
                    <BookOpen className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-[#4A3B32] text-sm leading-tight line-clamp-2 group-hover:text-[#C8A288] transition-colors">
                        {book.title}
                    </h3>
                    {book.author && (
                        <p className="text-xs text-[#8a6a5c] mt-0.5">by {book.author}</p>
                    )}
                </div>
            </div>

            {/* Description */}
            {book.description && (
                <p className="text-xs text-[#8a6a5c] leading-relaxed line-clamp-3 mb-4">
                    {book.description}
                </p>
            )}

            {/* Tags */}
            {book.tags && book.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                    {book.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-[#FDF6F0] text-[#8a6a5c] rounded-full text-xs border border-[#E6D5CC]">
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                        </span>
                    ))}
                    {book.tags.length > 3 && (
                        <span className="px-2 py-0.5 bg-[#FDF6F0] text-[#8a6a5c] rounded-full text-xs">
                            +{book.tags.length - 3}
                        </span>
                    )}
                </div>
            )}

            {/* Footer stats */}
            <div className="flex items-center justify-between pt-3 border-t border-[#F5EBE4]">
                <div className="flex items-center gap-3 text-xs text-[#8a6a5c]">
                    <span className="flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        {book.import_count || 0}
                    </span>
                    <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3 text-emerald-500" />
                        Public
                    </span>
                </div>
                {imported ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <Check className="h-3.5 w-3.5" />
                        Added
                    </span>
                ) : (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onPreview(book);
                        }}
                        disabled={importing}
                        className="px-3 py-1.5 bg-[#C8A288] text-white rounded-lg text-xs font-medium hover:bg-[#B08B72] transition-colors flex items-center gap-1.5"
                    >
                        {importing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Download className="h-3 w-3" />
                        )}
                        Import
                    </button>
                )}
            </div>
        </div>
    );
};

const ImportModal = ({ book, onClose, onImport }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState('');
    const [importing, setImporting] = useState(false);
    const [done, setDone] = useState(false);
    const toast = useToast();

    useEffect(() => {
        getProjects().then(data => {
            setProjects(data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const handleImport = async () => {
        if (!selectedProject) return;
        setImporting(true);
        try {
            await onImport(book.id, selectedProject);
            setDone(true);
            toast.success(`"${book.title}" is being added to your project!`);
            setTimeout(onClose, 1500);
        } catch (err) {
            toast.error(err.response?.data?.detail || err.message || 'Import failed');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-[#4A3B32]/30 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-[#4A3B32]">Import Book</h3>
                        <p className="text-sm text-[#8a6a5c] mt-1">Select a project to add this book to</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[#FDF6F0] rounded-full transition-colors">
                        <X className="h-5 w-5 text-[#8a6a5c]" />
                    </button>
                </div>

                {/* Book info */}
                <div className="flex items-center gap-3 p-4 bg-[#FDF6F0] rounded-xl mb-6">
                    <div className="h-10 w-8 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-lg flex items-center justify-center">
                        <BookOpen className="h-4 w-4 text-white" />
                    </div>
                    <div>
                        <p className="font-semibold text-[#4A3B32] text-sm">{book.title}</p>
                        {book.author && <p className="text-xs text-[#8a6a5c]">by {book.author}</p>}
                    </div>
                </div>

                {done ? (
                    <div className="text-center py-6">
                        <div className="h-14 w-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Check className="h-7 w-7 text-emerald-500" />
                        </div>
                        <p className="font-bold text-[#4A3B32]">Import started!</p>
                        <p className="text-sm text-[#8a6a5c] mt-1">Processing in background...</p>
                    </div>
                ) : (
                    <>
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-[#C8A288]" />
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="text-center py-6 text-[#8a6a5c]">
                                <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">No projects yet. Create a project first.</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto mb-6">
                                {projects.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setSelectedProject(p.id)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${selectedProject === p.id
                                            ? 'border-[#C8A288] bg-[#FDF6F0]'
                                            : 'border-[#E6D5CC] hover:border-[#C8A288] hover:bg-[#FDF6F0]/50'
                                            }`}
                                    >
                                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${selectedProject === p.id ? 'bg-[#C8A288]' : 'bg-[#F5EBE4]'}`}>
                                            <BookOpen className={`h-4 w-4 ${selectedProject === p.id ? 'text-white' : 'text-[#C8A288]'}`} />
                                        </div>
                                        <span className="text-sm font-medium text-[#4A3B32] truncate">{p.name}</span>
                                        {selectedProject === p.id && (
                                            <Check className="h-4 w-4 text-[#C8A288] ml-auto shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={handleImport}
                            disabled={!selectedProject || importing}
                            className="w-full py-3 bg-[#C8A288] text-white rounded-xl font-medium hover:bg-[#B08B72] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-[#C8A288]/20"
                        >
                            {importing ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Importing...
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    Add to Project
                                </>
                            )}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

const BookStore = () => {
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [previewBook, setPreviewBook] = useState(null);
    const toast = useToast();

    const fetchBooks = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getPublicBooks(page, search);
            setBooks(data.books || []);
            setTotalPages(data.total_pages || 1);
            setTotal(data.total || 0);
        } catch (err) {
            setError('Failed to load books. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        fetchBooks();
    }, [fetchBooks]);

    const handleSearch = (e) => {
        e.preventDefault();
        setSearch(searchInput);
        setPage(1);
    };

    const handleImport = async (bookId, projectId) => {
        await importBook(bookId, projectId);
    };

    return (
        <div className="min-h-screen bg-[#FDF6F0] font-sans">
            {/* Hero header */}
            <div className="bg-white border-b border-[#E6D5CC]">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="h-12 w-12 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-2xl flex items-center justify-center shadow-lg shadow-[#C8A288]/20">
                            <Globe className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-[#4A3B32]">Book Store</h1>
                            <p className="text-[#8a6a5c]">Discover and import books shared by the community</p>
                        </div>
                    </div>

                    {/* Search bar */}
                    <form onSubmit={handleSearch} className="flex gap-3 mt-6">
                        <div className="relative flex-1 max-w-xl">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#8a6a5c]" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Search by title, author, or description..."
                                className="w-full pl-12 pr-4 py-3 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl focus:ring-2 focus:ring-[#C8A288] outline-none text-sm"
                            />
                        </div>
                        <button
                            type="submit"
                            className="px-6 py-3 bg-[#C8A288] text-white rounded-xl font-medium hover:bg-[#B08B72] transition-colors shadow-lg shadow-[#C8A288]/20"
                        >
                            Search
                        </button>
                        {search && (
                            <button
                                type="button"
                                onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                                className="px-4 py-3 border border-[#E6D5CC] rounded-xl text-[#8a6a5c] hover:bg-[#FDF6F0] transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </form>

                    {!loading && (
                        <p className="text-sm text-[#8a6a5c] mt-3">
                            {search
                                ? `${total} result${total !== 1 ? 's' : ''} for "${search}"`
                                : `${total} book${total !== 1 ? 's' : ''} available`}
                        </p>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                {error && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl mb-6 text-red-700">
                        <AlertCircle className="h-5 w-5 shrink-0" />
                        <p className="text-sm">{error}</p>
                        <button onClick={fetchBooks} className="ml-auto text-xs underline">Retry</button>
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="bg-white border border-[#E6D5CC] rounded-2xl p-5 animate-pulse">
                                <div className="flex gap-3 mb-4">
                                    <div className="h-12 w-10 bg-[#E6D5CC] rounded-lg" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 bg-[#E6D5CC] rounded w-3/4" />
                                        <div className="h-3 bg-[#E6D5CC] rounded w-1/2" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="h-3 bg-[#E6D5CC] rounded" />
                                    <div className="h-3 bg-[#E6D5CC] rounded w-5/6" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : books.length === 0 ? (
                    <div className="text-center py-24">
                        <div className="h-20 w-20 bg-[#FDF6F0] border-2 border-[#E6D5CC] rounded-3xl flex items-center justify-center mx-auto mb-4">
                            <BookOpen className="h-10 w-10 text-[#C8A288]" />
                        </div>
                        <h3 className="text-xl font-bold text-[#4A3B32] mb-2">No books found</h3>
                        <p className="text-[#8a6a5c]">
                            {search ? 'Try a different search term' : 'Be the first to share a book!'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {books.map(book => (
                            <BookCard
                                key={book.id}
                                book={book}
                                onImport={handleImport}
                                onPreview={setPreviewBook}
                            />
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3 mt-10">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="flex items-center gap-2 px-4 py-2 border border-[#E6D5CC] rounded-xl text-sm text-[#8a6a5c] hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                        </button>
                        <span className="text-sm text-[#8a6a5c]">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="flex items-center gap-2 px-4 py-2 border border-[#E6D5CC] rounded-xl text-sm text-[#8a6a5c] hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors"
                        >
                            Next
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* Import Modal */}
            {previewBook && (
                <ImportModal
                    book={previewBook}
                    onClose={() => setPreviewBook(null)}
                    onImport={handleImport}
                />
            )}
        </div>
    );
};

export default BookStore;
