import React, { useState, useCallback } from 'react';
import { Upload, X, File, Check, Globe, Lock, ChevronDown, ChevronUp, Tag } from 'lucide-react';

const UploadZone = ({ onFilesSelected, uploading }) => {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);

    // Public/Private book options
    const [isPublic, setIsPublic] = useState(false);
    const [showBookMeta, setShowBookMeta] = useState(false);
    const [bookTitle, setBookTitle] = useState('');
    const [bookAuthor, setBookAuthor] = useState('');
    const [bookDescription, setBookDescription] = useState('');
    const [bookTagsInput, setBookTagsInput] = useState('');

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files).filter(file =>
            file.type === 'application/pdf' ||
            file.name.endsWith('.pdf') ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.docx')
        );

        if (files.length > 0) {
            setSelectedFiles(files);
            // Autofill title from first file name
            if (!bookTitle) {
                setBookTitle(files[0].name.replace(/\.[^.]+$/, ''));
            }
        }
    }, [bookTitle]);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            setSelectedFiles(files);
            if (!bookTitle) {
                setBookTitle(files[0].name.replace(/\.[^.]+$/, ''));
            }
        }
    };

    const removeFile = (index) => {
        setSelectedFiles(files => files.filter((_, i) => i !== index));
    };

    const handleUpload = () => {
        if (selectedFiles.length > 0) {
            const bookOptions = isPublic ? {
                isPublic: true,
                bookTitle: bookTitle || selectedFiles[0]?.name,
                bookAuthor: bookAuthor || undefined,
                bookDescription: bookDescription || undefined,
                bookTags: bookTagsInput || undefined,
            } : {};
            onFilesSelected(selectedFiles, bookOptions);
        }
    };

    const togglePublic = () => {
        setIsPublic(p => !p);
        if (!isPublic) setShowBookMeta(true);
    };

    return (
        <div className="space-y-4">
            {/* Drag & Drop Zone */}
            <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${isDragging
                    ? 'border-[#C8A288] bg-[#FDF6F0]'
                    : 'border-[#E6D5CC] hover:border-[#C8A288]'
                    }`}
            >
                <Upload className={`h-16 w-16 mx-auto mb-4 ${isDragging ? 'text-[#C8A288]' : 'text-[#8a6a5c]'}`} />
                <p className="text-lg font-medium text-[#4A3B32] mb-2">
                    Drag and drop your files here
                </p>
                <p className="text-sm text-[#8a6a5c] mb-4">or</p>
                <label className="inline-block px-6 py-3 bg-[#C8A288] text-white rounded-lg hover:bg-[#B08B72] cursor-pointer transition-colors">
                    Browse Files
                    <input
                        type="file"
                        multiple
                        accept=".pdf,.txt,.docx"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </label>
                <p className="text-xs text-[#8a6a5c] mt-4">Supported: PDF, TXT, DOCX</p>
            </div>

            {/* Selected Files List */}
            {selectedFiles.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-sm font-bold text-[#4A3B32]">
                        Selected Files ({selectedFiles.length})
                    </h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                        {selectedFiles.map((file, index) => (
                            <div
                                key={index}
                                className="flex items-center gap-3 p-3 bg-[#FDF6F0] rounded-lg border border-[#E6D5CC]"
                            >
                                <File className="h-5 w-5 text-[#C8A288] shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-[#4A3B32] truncate">
                                        {file.name}
                                    </p>
                                    <p className="text-xs text-[#8a6a5c]">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                </div>
                                {!uploading && (
                                    <button
                                        onClick={() => removeFile(index)}
                                        className="p-1 hover:bg-red-100 rounded transition-colors"
                                    >
                                        <X className="h-4 w-4 text-red-600" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Public/Private Toggle */}
                    <div className="rounded-xl border border-[#E6D5CC] overflow-hidden">
                        <button
                            type="button"
                            onClick={togglePublic}
                            className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isPublic
                                ? 'bg-gradient-to-r from-[#C8A288]/20 to-[#B08B72]/10 border-b border-[#E6D5CC]'
                                : 'bg-[#FDF6F0] hover:bg-[#F5EBE4]'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                {isPublic ? (
                                    <div className="h-8 w-8 rounded-full bg-[#C8A288] flex items-center justify-center">
                                        <Globe className="h-4 w-4 text-white" />
                                    </div>
                                ) : (
                                    <div className="h-8 w-8 rounded-full bg-[#E6D5CC] flex items-center justify-center">
                                        <Lock className="h-4 w-4 text-[#8a6a5c]" />
                                    </div>
                                )}
                                <div className="text-left">
                                    <p className="text-sm font-semibold text-[#4A3B32]">
                                        {isPublic ? 'Public — Share in Book Store 🌐' : 'Private — Only for you 🔒'}
                                    </p>
                                    <p className="text-xs text-[#8a6a5c]">
                                        {isPublic
                                            ? 'This book will appear in the Book Store for all users'
                                            : 'Only you can use this document in your projects'}
                                    </p>
                                </div>
                            </div>
                            <div className={`w-10 h-6 rounded-full transition-colors relative ${isPublic ? 'bg-[#C8A288]' : 'bg-[#E6D5CC]'}`}>
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isPublic ? 'left-5' : 'left-1'}`} />
                            </div>
                        </button>

                        {/* Public book metadata fields */}
                        {isPublic && (
                            <div className="p-4 bg-white space-y-3">
                                <button
                                    type="button"
                                    onClick={() => setShowBookMeta(p => !p)}
                                    className="flex items-center gap-2 text-xs text-[#8a6a5c] hover:text-[#C8A288] transition-colors"
                                >
                                    {showBookMeta ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    {showBookMeta ? 'Hide book details' : 'Add book details (optional)'}
                                </button>

                                {showBookMeta && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <div>
                                            <label className="block text-xs font-medium text-[#4A3B32] mb-1">
                                                Book Title <span className="text-[#C8A288]">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={bookTitle}
                                                onChange={e => setBookTitle(e.target.value)}
                                                placeholder="e.g., Introduction to Calculus"
                                                className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-lg focus:ring-2 focus:ring-[#C8A288] outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[#4A3B32] mb-1">Author</label>
                                            <input
                                                type="text"
                                                value={bookAuthor}
                                                onChange={e => setBookAuthor(e.target.value)}
                                                placeholder="e.g., John Smith"
                                                className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-lg focus:ring-2 focus:ring-[#C8A288] outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[#4A3B32] mb-1">Description</label>
                                            <textarea
                                                value={bookDescription}
                                                onChange={e => setBookDescription(e.target.value)}
                                                placeholder="Brief description of this book..."
                                                rows={3}
                                                className="w-full px-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-lg focus:ring-2 focus:ring-[#C8A288] outline-none resize-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[#4A3B32] mb-1">
                                                Tags <span className="text-[#8a6a5c] font-normal">(comma-separated)</span>
                                            </label>
                                            <div className="relative">
                                                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a6a5c]" />
                                                <input
                                                    type="text"
                                                    value={bookTagsInput}
                                                    onChange={e => setBookTagsInput(e.target.value)}
                                                    placeholder="e.g., physics, science, textbook"
                                                    className="w-full pl-8 pr-3 py-2 text-sm bg-[#FDF6F0] border border-[#E6D5CC] rounded-lg focus:ring-2 focus:ring-[#C8A288] outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Upload Button */}
                    <button
                        onClick={handleUpload}
                        disabled={uploading || selectedFiles.length === 0}
                        className="w-full py-3 bg-[#C8A288] text-white rounded-xl hover:bg-[#B08B72] font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Check className="h-5 w-5" />
                                {isPublic ? '🌐 Upload & Share' : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''}`}
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};

export default UploadZone;
