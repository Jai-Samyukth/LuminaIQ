import React, { useState, useEffect, useCallback } from 'react';
import {
    Search, Globe, BookOpen, Download, X, Loader2, Tag, Check, ChevronLeft, ChevronRight
} from 'lucide-react';
import { getPublicBooks, importBook } from '../api';
import { useToast } from '../context/ToastContext';

/**
 * BookStoreModal — inline modal for importing public books into the CURRENT project.
 * Used inside ProjectView's upload section.
 *
 * Props:
 *   projectId  — current project to import into
 *   onClose    — close the modal
 *   onImported — called with new document when import starts
 */
const BookStoreModal = ({ projectId, onClose, onImported }) => {
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

    useEffect(() => {
        fetchBooks();
    }, [fetchBooks]);

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
            const msg = err.response?.data?.detail || err.message || 'Import failed';
            // Handle "already imported" gracefully
            if (err.response?.status === 409) {
                toast.info('This book is already in your project');
                setImportedIds(s => new Set([...s, book.id]));
            } else {
                toast.error(msg);
            }
        } finally {
            setImportingId(null);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-[#4A3B32]/30 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="p-6 border-b border-[#E6D5CC] shrink-0">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-xl flex items-center justify-center">
                                <Globe className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-[#4A3B32]">Book Store</h2>
                                <p className="text-xs text-[#8a6a5c]">Import books shared by the community</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-[#FDF6F0] rounded-full transition-colors"
                        >
                            <X className="h-5 w-5 text-[#8a6a5c]" />
                        </button>
                    </div>

                    {/* Search */}
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a6a5c]" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Search books..."
                                className="w-full pl-9 pr-3 py-2.5 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl text-sm focus:ring-2 focus:ring-[#C8A288] outline-none"
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="px-4 py-2.5 bg-[#C8A288] text-white rounded-xl text-sm font-medium hover:bg-[#B08B72] transition-colors">
                            Search
                        </button>
                        {search && (
                            <button
                                type="button"
                                onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                                className="p-2.5 border border-[#E6D5CC] rounded-xl text-[#8a6a5c] hover:bg-[#FDF6F0]"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </form>

                    {!loading && (
                        <p className="text-xs text-[#8a6a5c] mt-2">
                            {search ? `${total} result${total !== 1 ? 's' : ''} for "${search}"` : `${total} books available`}
                        </p>
                    )}
                </div>

                {/* Books grid */}
                <div className="overflow-y-auto flex-1 p-6">
                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="p-4 bg-[#FDF6F0] rounded-xl animate-pulse">
                                    <div className="flex gap-3 mb-3">
                                        <div className="h-10 w-8 bg-[#E6D5CC] rounded-lg" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 bg-[#E6D5CC] rounded w-3/4" />
                                            <div className="h-3 bg-[#E6D5CC] rounded w-1/2" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : books.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="h-12 w-12 text-[#C8A288] mx-auto mb-3 opacity-40" />
                            <p className="text-[#8a6a5c]">{search ? 'No books match your search' : 'No public books available yet'}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {books.map(book => {
                                const isImported = importedIds.has(book.id);
                                const isImporting = importingId === book.id;

                                return (
                                    <div
                                        key={book.id}
                                        className="flex flex-col p-4 bg-[#FDF6F0] border border-[#E6D5CC] rounded-xl hover:border-[#C8A288] transition-all"
                                    >
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className="h-10 w-8 bg-gradient-to-br from-[#C8A288] to-[#B08B72] rounded-lg flex items-center justify-center shrink-0">
                                                <BookOpen className="h-4 w-4 text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-semibold text-sm text-[#4A3B32] line-clamp-1">{book.title}</h4>
                                                {book.author && <p className="text-xs text-[#8a6a5c]">by {book.author}</p>}
                                            </div>
                                        </div>

                                        {book.description && (
                                            <p className="text-xs text-[#8a6a5c] line-clamp-2 mb-3 leading-relaxed">
                                                {book.description}
                                            </p>
                                        )}

                                        {book.tags && book.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mb-3">
                                                {book.tags.slice(0, 3).map((tag, i) => (
                                                    <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-white text-[#8a6a5c] rounded-full text-xs border border-[#E6D5CC]">
                                                        <Tag className="h-2.5 w-2.5" />
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between mt-auto pt-3 border-t border-[#E6D5CC]">
                                            <span className="text-xs text-[#8a6a5c] flex items-center gap-1">
                                                <Download className="h-3 w-3" />
                                                {book.import_count || 0} imports
                                            </span>
                                            <button
                                                onClick={() => handleImport(book)}
                                                disabled={isImporting || isImported}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isImported
                                                    ? 'bg-emerald-50 text-emerald-600 cursor-default'
                                                    : 'bg-[#C8A288] text-white hover:bg-[#B08B72] disabled:opacity-60'
                                                    }`}
                                            >
                                                {isImporting ? (
                                                    <><Loader2 className="h-3 w-3 animate-spin" />Adding...</>
                                                ) : isImported ? (
                                                    <><Check className="h-3 w-3" />Added</>
                                                ) : (
                                                    <><Download className="h-3 w-3" />Import</>
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
                    <div className="p-4 border-t border-[#E6D5CC] flex items-center justify-center gap-3 shrink-0">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-2 border border-[#E6D5CC] rounded-lg hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-sm text-[#8a6a5c]">Page {page} of {totalPages}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-2 border border-[#E6D5CC] rounded-lg hover:bg-[#FDF6F0] disabled:opacity-40 transition-colors"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookStoreModal;
